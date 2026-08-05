import { createHash, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import express, { type Request } from 'express';
import helmet from 'helmet';
import { clearSession, requireAuth, setSession, verifyLogin } from './auth.js';
import { config, isProduction } from './config.js';
import { migrate, pool } from './db.js';
import { normalizeTransaction, transactionObjects } from './normalize.js';

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

const safeEqual = (a: string, b: string) => { const aa = Buffer.from(a); const bb = Buffer.from(b); return aa.length === bb.length && timingSafeEqual(aa, bb); };
function webhookAuthenticated(req: Request) {
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const token = String(req.headers['x-webhook-token'] || req.headers['x-api-key'] || bearer);
  const suppliedClient = String(req.headers['x-client-id'] || '');
  const suppliedSecret = String(req.headers['x-client-secret'] || '');
  const expectedSecret = config.ACB_CLIENT_SECRET || config.SCRECET_ID || '';
  return Boolean((config.ACB_WEBHOOK_TOKEN && safeEqual(token, config.ACB_WEBHOOK_TOKEN)) || (config.CLIENT_ID && expectedSecret && safeEqual(suppliedClient, config.CLIENT_ID) && safeEqual(suppliedSecret, expectedSecret)));
}
function publicHeaders(headers: Request['headers']) {
  const blocked = new Set(['authorization', 'cookie', 'x-api-key', 'x-webhook-token', 'x-client-secret']);
  return Object.fromEntries(Object.entries(headers).filter(([key]) => !blocked.has(key.toLowerCase())));
}

type WebhookInput = {
  body: Record<string, unknown>;
  headers: Request['headers'];
  remoteIp: string | null;
  authenticated: boolean;
};

async function persistWebhook(input: WebhookInput) {
  const hash = createHash('sha256').update(JSON.stringify(input.body)).digest('hex');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const delivery = await client.query(`INSERT INTO webhook_deliveries (request_id, raw_body, raw_body_sha256, request_headers, remote_ip, authenticated)
      VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (raw_body_sha256) DO NOTHING RETURNING id`,
      [String(input.headers['x-request-id'] || input.headers['x-correlation-id'] || '') || null, input.body, hash, publicHeaders(input.headers), input.remoteIp, input.authenticated]);
    if (!delivery.rowCount) { await client.query('ROLLBACK'); return { duplicate: true }; }
    let count = 0;
    for (const raw of transactionObjects(input.body)) {
      const txn = normalizeTransaction(raw);
      const inserted = await client.query(`INSERT INTO transactions (source_delivery_id, bank_reference, account_number, counterparty_account, counterparty_name, direction, amount, currency, description, transaction_time, balance_after, raw_payload, dedupe_key)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (dedupe_key) DO NOTHING`,
        [delivery.rows[0].id, txn.bankReference, txn.accountNumber, txn.counterpartyAccount, txn.counterpartyName, txn.direction, txn.amount, txn.currency, txn.description, txn.transactionTime, txn.balanceAfter, txn.rawPayload, txn.dedupeKey]);
      count += inserted.rowCount || 0;
    }
    await client.query('UPDATE webhook_deliveries SET transaction_count=$1 WHERE id=$2', [count, delivery.rows[0].id]);
    await client.query('COMMIT');
    return { duplicate: false, transactionCount: count };
  } catch (error) {
    await client.query('ROLLBACK'); console.error('Webhook processing failed', error);
    throw error;
  } finally { client.release(); }
}

async function receiveWebhook(req: Request, res: express.Response) {
  const pathTokenOk = req.params.token ? safeEqual(String(req.params.token), config.ACB_CALLBACK_TOKEN) : false;
  const headerAuth = webhookAuthenticated(req);
  if (!pathTokenOk && config.ACB_WEBHOOK_AUTH_REQUIRED === 'true' && !headerAuth) return res.status(401).json({ errorCode: '01', errorMessage: 'Unauthorized' });
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ errorCode: '02', errorMessage: 'Invalid JSON body' });
  try {
    const result = await persistWebhook({ body, headers: req.headers, remoteIp: req.ip || null, authenticated: pathTokenOk || headerAuth });
    return res.status(200).json({ errorCode: '00', errorMessage: 'Success', ...(result.duplicate && { duplicate: true }) });
  } catch {
    return res.status(500).json({ errorCode: '99', errorMessage: 'Internal processing error' });
  }
}

function acknowledgeCallback(req: Request, res: express.Response) {
  const body = req.body;
  const input = body && typeof body === 'object' && !Array.isArray(body)
    ? { body: body as Record<string, unknown>, headers: { ...req.headers }, remoteIp: req.ip || null, authenticated: webhookAuthenticated(req) }
    : null;

  // ACB receives the acknowledgement before any database I/O is started.
  res.status(200).json({ errorCode: '00', errorMessage: 'Success' });
  if (input) setImmediate(() => { void persistWebhook(input).catch(error => console.error('Async callback persistence failed', error)); });
}

app.get('/api/health', async (_req, res) => { try { await pool.query('SELECT 1'); res.json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString() }); } catch { res.status(503).json({ status: 'error', database: 'disconnected' }); } });
app.post('/api/auth/login', (req, res) => { if (!verifyLogin(String(req.body?.username || ''), String(req.body?.password || ''))) return res.status(401).json({ message: 'Thông tin đăng nhập không hợp lệ' }); setSession(res); res.json({ ok: true }); });
app.post('/api/auth/logout', (_req, res) => { clearSession(res); res.json({ ok: true }); });
app.get('/api/auth/session', requireAuth, (_req, res) => res.json({ authenticated: true, username: config.ADMIN_USERNAME }));
app.post('/api/webhooks/acb/rtxn-notification/:token', receiveWebhook);
app.post('/api/webhooks/acb/rtxn-notification', receiveWebhook);
app.post('/api/acb/callback/:token', receiveWebhook);
app.post('/api/callback', acknowledgeCallback);
app.post('/rtxn-notification/:token', receiveWebhook);

app.use('/api', requireAuth);
app.get('/api/config', (_req, res) => res.json({ callbackUrl: `${config.PUBLIC_URL.replace(/\/$/, '')}/api/callback` }));
app.get('/api/summary', async (_req, res, next) => { try {
  const totals = await pool.query(`SELECT COALESCE(SUM(amount) FILTER (WHERE direction='CREDIT'),0)::float AS credit, COALESCE(SUM(amount) FILTER (WHERE direction='DEBIT'),0)::float AS debit, COUNT(*)::int AS count FROM transactions WHERE transaction_time >= now() - interval '30 days'`);
  const daily = await pool.query(`WITH days AS (SELECT generate_series(current_date - 13, current_date, interval '1 day')::date AS report_day) SELECT report_day::text AS date, COALESCE(SUM(t.amount) FILTER (WHERE t.direction='CREDIT'),0)::float AS credit, COALESCE(SUM(t.amount) FILTER (WHERE t.direction='DEBIT'),0)::float AS debit FROM days LEFT JOIN transactions t ON t.transaction_time >= days.report_day AND t.transaction_time < days.report_day + interval '1 day' GROUP BY report_day ORDER BY report_day`);
  const delivery = await pool.query(`SELECT COUNT(*) FILTER (WHERE received_at >= now() - interval '24 hours')::int count, MAX(received_at) last_at FROM webhook_deliveries`);
  const row = totals.rows[0]; res.json({ totalCredit: row.credit, totalDebit: row.debit, net: row.credit - row.debit, count: row.count, recentDeliveries: delivery.rows[0].count, lastWebhookAt: delivery.rows[0].last_at, daily: daily.rows });
} catch (error) { next(error); } });

function transactionFilter(req: Request) {
  const conditions: string[] = []; const values: unknown[] = [];
  const add = (sql: string, value: unknown) => { values.push(value); conditions.push(sql.replace('?', `$${values.length}`)); };
  if (req.query.direction && ['CREDIT','DEBIT','UNKNOWN'].includes(String(req.query.direction))) add('direction = ?', req.query.direction);
  if (req.query.from) add('transaction_time >= ?::date', req.query.from);
  if (req.query.to) add("transaction_time < ?::date + interval '1 day'", req.query.to);
  if (req.query.q) add(`(COALESCE(bank_reference,'') ILIKE '%' || ? || '%' OR COALESCE(description,'') ILIKE '%' || $${values.length + 1} || '%' OR COALESCE(account_number,'') ILIKE '%' || $${values.length + 1} || '%' OR COALESCE(counterparty_name,'') ILIKE '%' || $${values.length + 1} || '%')`, String(req.query.q).slice(0, 100));
  return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', values };
}
app.get('/api/transactions', async (req, res, next) => { try {
  const page = Math.max(1, Number(req.query.page) || 1); const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20)); const filter = transactionFilter(req);
  const count = await pool.query(`SELECT COUNT(*)::int total FROM transactions ${filter.where}`, filter.values);
  const items = await pool.query(`SELECT id,bank_reference,account_number,counterparty_account,counterparty_name,direction,amount,currency,description,transaction_time,balance_after,received_at FROM transactions ${filter.where} ORDER BY transaction_time DESC,received_at DESC LIMIT $${filter.values.length + 1} OFFSET $${filter.values.length + 2}`, [...filter.values, pageSize, (page - 1) * pageSize]);
  res.json({ items: items.rows, total: count.rows[0].total, page, pageSize });
} catch (error) { next(error); } });
app.get('/api/transactions/export.csv', async (req, res, next) => { try {
  const filter = transactionFilter(req); const result = await pool.query(`SELECT transaction_time,direction,amount,currency,account_number,counterparty_account,counterparty_name,description,bank_reference FROM transactions ${filter.where} ORDER BY transaction_time DESC LIMIT 10000`, filter.values);
  const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = ['Thời gian,Loại,Số tiền,Tiền tệ,Tài khoản,TK đối tác,Tên đối tác,Nội dung,Mã tham chiếu', ...result.rows.map(row => Object.values(row).map(cell).join(','))].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="acb-transactions-${new Date().toISOString().slice(0,10)}.csv"`); res.send(`\uFEFF${csv}`);
} catch (error) { next(error); } });
app.get('/api/transactions/:id', async (req, res, next) => { try { const result = await pool.query('SELECT * FROM transactions WHERE id=$1', [req.params.id]); if (!result.rowCount) return res.status(404).json({ message: 'Không tìm thấy giao dịch' }); res.json(result.rows[0]); } catch (error) { next(error); } });

if (isProduction) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
  app.use(express.static(root, { maxAge: '1d' })); app.get('*splat', (_req, res) => res.sendFile(path.join(root, 'index.html')));
}
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { console.error(error); res.status(500).json({ message: 'Lỗi máy chủ nội bộ' }); });

await migrate();
app.listen(config.PORT, '127.0.0.1', () => console.log(`Payment Duni listening on 127.0.0.1:${config.PORT}`));

process.on('SIGTERM', async () => { await pool.end(); process.exit(0); });
