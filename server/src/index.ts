import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import express, { type Request, type Response } from 'express';
import helmet from 'helmet';
import { acb, AcbApiError } from './acb.js';
import { clearSession, requireAuth, setSession, verifyLogin } from './auth.js';
import { acbClientSecret, config, isProduction } from './config.js';
import { migrate, pool } from './db.js';
import { classifyEvent, enqueueWebhook, runInboxOnce, startInboxWorker, stopInboxWorker, type InboxEventType } from './inbox.js';

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: config.ACB_CALLBACK_MAX_BODY_BYTES }));
app.use(cookieParser());

const safeEqual = (a: string, b: string) => {
  const aa = Buffer.from(a); const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
};

function webhookAuthenticated(req: Request) {
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const token = String(req.headers['x-webhook-token'] || req.headers['x-api-key'] || bearer);
  const suppliedClient = String(req.headers['x-client-id'] || '');
  const suppliedSecret = String(req.headers['x-client-secret'] || '');
  return Boolean(
    (config.ACB_WEBHOOK_TOKEN && safeEqual(token, config.ACB_WEBHOOK_TOKEN)) ||
    (config.CLIENT_ID && acbClientSecret && safeEqual(suppliedClient, config.CLIENT_ID) && safeEqual(suppliedSecret, acbClientSecret))
  );
}

async function receiveWebhook(req: Request, res: Response, forcedType?: InboxEventType, allowPublic = false) {
  const pathTokenOk = req.params.token ? safeEqual(String(req.params.token), config.ACB_CALLBACK_TOKEN) : false;
  const headerAuth = webhookAuthenticated(req);
  if (!allowPublic && !pathTokenOk && config.ACB_WEBHOOK_AUTH_REQUIRED === 'true' && !headerAuth) {
    return res.status(401).json({ errorCode: '01', errorMessage: 'Unauthorized' });
  }
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ errorCode: '02', errorMessage: 'Invalid JSON body' });
  }
  try {
    // Chỉ một INSERT inbox trước ACK: dữ liệu đã bền vững, xử lý nghiệp vụ chạy nền.
    const result = await enqueueWebhook({
      body, headers: req.headers, remoteIp: req.ip || null,
      authenticated: pathTokenOk || headerAuth,
      eventType: forcedType || classifyEvent(body)
    });
    res.status(200).json({ errorCode: '00', errorMessage: 'Success', ...(result.duplicate ? { duplicate: true } : {}) });
    if (!result.duplicate) setImmediate(() => { void runInboxOnce(); });
  } catch (error) {
    console.error('Không thể ghi callback vào durable inbox', error);
    // Trả lỗi để ACB retry, tránh ACK rồi mất dữ liệu.
    return res.status(503).json({ errorCode: '99', errorMessage: 'Temporary unavailable' });
  }
}

function receivePublicCallbackImmediate(req: Request, res: Response) {
  const body = req.body;
  const headers = req.headers;
  const remoteIp = req.ip || null;
  const authenticated = webhookAuthenticated(req);

  // ACB cần ACK ngay; việc ghi durable inbox và xử lý nghiệp vụ diễn ra sau response.
  res.status(200).json({ errorCode: '00', errorMessage: 'Success' });

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    console.warn('Callback công khai đã ACK nhưng body không phải JSON object');
    return;
  }

  setImmediate(() => {
    void enqueueWebhook({
      body,
      headers,
      remoteIp,
      authenticated,
      eventType: classifyEvent(body)
    }).then((result) => {
      if (!result.duplicate) return runInboxOnce();
    }).catch((error) => {
      console.error('Callback đã ACK 200 nhưng không thể ghi durable inbox', error);
    });
  });
}
app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected', worker: 'running', timestamp: new Date().toISOString() });
  } catch { res.status(503).json({ status: 'error', database: 'disconnected' }); }
});
app.post('/api/auth/login', (req, res) => {
  if (!verifyLogin(String(req.body?.username || ''), String(req.body?.password || ''))) return res.status(401).json({ message: 'Thông tin đăng nhập không hợp lệ' });
  setSession(res); res.json({ ok: true });
});
app.post('/api/auth/logout', (_req, res) => { clearSession(res); res.json({ ok: true }); });
app.get('/api/auth/session', requireAuth, (_req, res) => res.json({ authenticated: true, username: config.ADMIN_USERNAME }));

// URL đã khai báo với ACB: ACK 200 ngay, sau đó mới ghi inbox/xử lý nền.
app.post('/api/callback', receivePublicCallbackImmediate);
app.post('/api/callback/statement', (req, res) => receiveWebhook(req, res, 'STATEMENT_RESULT'));
app.post('/api/webhooks/acb/rtxn-notification/:token', (req, res) => receiveWebhook(req, res, 'TRANSACTION_NOTIFICATION'));
app.post('/api/webhooks/acb/rtxn-notification', (req, res) => receiveWebhook(req, res, 'TRANSACTION_NOTIFICATION'));
app.post('/api/acb/callback/:token', (req, res) => receiveWebhook(req, res));
app.post('/rtxn-notification/:token', (req, res) => receiveWebhook(req, res, 'TRANSACTION_NOTIFICATION'));

app.use('/api', requireAuth);

app.get('/api/config', (_req, res) => {
  const root = config.PUBLIC_URL.replace(/\/$/, '');
  res.json({
    callbackUrl: `${root}/api/callback`,
    statementCallbackUrl: `${root}/api/callback/statement`,
    acbConfigured: acb.configured(),
    postgresSsl: config.POSTGRES_SSL === 'true',
    environment: config.NODE_ENV
  });
});

app.get('/api/summary', async (_req, res, next) => { try {
  const totals = await pool.query(`SELECT COALESCE(SUM(amount) FILTER (WHERE direction='CREDIT'),0)::float AS credit,
    COALESCE(SUM(amount) FILTER (WHERE direction='DEBIT'),0)::float AS debit, COUNT(*)::int AS count
    FROM transactions WHERE transaction_time >= now() - interval '30 days'`);
  const daily = await pool.query(`WITH days AS (SELECT generate_series(current_date - 13, current_date, interval '1 day')::date AS report_day)
    SELECT report_day::text AS date, COALESCE(SUM(t.amount) FILTER (WHERE t.direction='CREDIT'),0)::float AS credit,
    COALESCE(SUM(t.amount) FILTER (WHERE t.direction='DEBIT'),0)::float AS debit FROM days
    LEFT JOIN transactions t ON t.transaction_time >= days.report_day AND t.transaction_time < days.report_day + interval '1 day'
    GROUP BY report_day ORDER BY report_day`);
  const delivery = await pool.query(`SELECT COUNT(*) FILTER (WHERE received_at >= now() - interval '24 hours')::int count,
    MAX(received_at) last_at FROM webhook_deliveries`);
  const row = totals.rows[0];
  res.json({ totalCredit: row.credit, totalDebit: row.debit, net: row.credit - row.debit, count: row.count,
    recentDeliveries: delivery.rows[0].count, lastWebhookAt: delivery.rows[0].last_at, daily: daily.rows });
} catch (error) { next(error); } });

function transactionFilter(req: Request) {
  const conditions: string[] = []; const values: unknown[] = [];
  const add = (sql: string, item: unknown) => { values.push(item); conditions.push(sql.replaceAll('?', `$${values.length}`)); };
  if (req.query.direction && ['CREDIT', 'DEBIT', 'UNKNOWN'].includes(String(req.query.direction))) add('direction = ?', req.query.direction);
  if (req.query.from) add('transaction_time >= ?::date', req.query.from);
  if (req.query.to) add("transaction_time < ?::date + interval '1 day'", req.query.to);
  if (req.query.q) {
    values.push(String(req.query.q).slice(0, 100));
    const p = `$${values.length}`;
    conditions.push(`(COALESCE(bank_reference,'') ILIKE '%' || ${p} || '%' OR COALESCE(description,'') ILIKE '%' || ${p} || '%'
      OR COALESCE(account_number,'') ILIKE '%' || ${p} || '%' OR COALESCE(counterparty_name,'') ILIKE '%' || ${p} || '%')`);
  }
  return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', values };
}

app.get('/api/transactions', async (req, res, next) => { try {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
  const filter = transactionFilter(req);
  const count = await pool.query(`SELECT COUNT(*)::int total FROM transactions ${filter.where}`, filter.values);
  const items = await pool.query(`SELECT id,bank_reference,account_number,counterparty_account,counterparty_name,direction,amount,currency,
    description,transaction_time,balance_after,received_at FROM transactions ${filter.where}
    ORDER BY transaction_time DESC,received_at DESC LIMIT $${filter.values.length + 1} OFFSET $${filter.values.length + 2}`,
    [...filter.values, pageSize, (page - 1) * pageSize]);
  res.json({ items: items.rows, total: count.rows[0].total, page, pageSize });
} catch (error) { next(error); } });

app.get('/api/transactions/export.csv', async (req, res, next) => { try {
  const filter = transactionFilter(req);
  const result = await pool.query(`SELECT transaction_time,direction,amount,currency,account_number,counterparty_account,
    counterparty_name,description,bank_reference FROM transactions ${filter.where} ORDER BY transaction_time DESC LIMIT 10000`, filter.values);
  const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = ['Thời gian,Loại,Số tiền,Tiền tệ,Tài khoản,TK đối tác,Tên đối tác,Nội dung,Mã tham chiếu',
    ...result.rows.map(row => Object.values(row).map(cell).join(','))].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="acb-transactions-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(`\uFEFF${csv}`);
} catch (error) { next(error); } });

app.get('/api/transactions/:id', async (req, res, next) => { try {
  const result = await pool.query('SELECT * FROM transactions WHERE id=$1', [req.params.id]);
  if (!result.rowCount) return res.status(404).json({ message: 'Không tìm thấy giao dịch' });
  res.json(result.rows[0]);
} catch (error) { next(error); } });

const queryObject = (req: Request) => Object.fromEntries(Object.entries(req.query).map(([key, val]) => [key, Array.isArray(val) ? val[0] : val]));
const acbRoute = (handler: (data: Record<string, unknown>) => Promise<unknown>, source: 'query' | 'body' = 'query') =>
  async (req: Request, res: Response, next: express.NextFunction) => {
    try { res.json(await handler(source === 'query' ? queryObject(req) : (req.body || {}))); } catch (error) { next(error); }
  };

app.get('/api/acb/accounts', acbRoute(acb.accounts));
app.get('/api/acb/balances', acbRoute(acb.balances));
app.get('/api/acb/transaction-history', acbRoute(acb.history));
app.get('/api/acb/statements', acbRoute(acb.statements));
app.get('/api/acb/transaction-detail', acbRoute(acb.transactionDetail));
app.get('/api/acb/statement/retrieve', acbRoute(acb.statementRetrieve));
app.get('/api/acb/statement/inquiry', acbRoute(acb.statementInquiry));
app.post('/api/acb/e-statement/registration', acbRoute(acb.registerEStatement, 'body'));

app.get('/api/ops/status', async (_req, res, next) => { try {
  const queues = await pool.query(`SELECT status,COUNT(*)::int count FROM webhook_deliveries GROUP BY status`);
  const latest = await pool.query(`SELECT id,event_type,status,attempts,transaction_count,error_message,authenticated,received_at,processed_at
    FROM webhook_deliveries ORDER BY received_at DESC LIMIT 30`);
  const apiRequests = await pool.query(`SELECT id,operation,method,path,request_id,response_status,duration_ms,error_message,created_at
    FROM acb_api_requests ORDER BY created_at DESC LIMIT 20`);
  const statements = await pool.query(`SELECT id,request_reference,account_number,result_status,file_url,received_at
    FROM statement_results ORDER BY received_at DESC LIMIT 20`);
  res.json({ queues: Object.fromEntries(queues.rows.map(row => [row.status, row.count])), latest: latest.rows,
    apiRequests: apiRequests.rows, statementResults: statements.rows });
} catch (error) { next(error); } });

app.post('/api/ops/deliveries/:id/requeue', async (req, res, next) => { try {
  const result = await pool.query(`UPDATE webhook_deliveries SET status='PENDING',attempts=0,next_attempt_at=now(),locked_at=NULL,error_message=NULL
    WHERE id=$1 AND status IN ('DEAD_LETTER','RETRY') RETURNING id`, [req.params.id]);
  if (!result.rowCount) return res.status(409).json({ message: 'Delivery không ở trạng thái có thể chạy lại' });
  setImmediate(() => { void runInboxOnce(); });
  res.json({ ok: true });
} catch (error) { next(error); } });

if (isProduction) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
  app.use(express.static(root, { maxAge: '1d' }));
  app.get('*splat', (_req, res) => res.sendFile(path.join(root, 'index.html')));
}

app.use((error: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
  console.error(error);
  if (error instanceof AcbApiError) return res.status(error.status >= 400 && error.status < 600 ? error.status : 502).json({ message: error.message, acb: error.data });
  if (error instanceof SyntaxError) return res.status(400).json({ message: 'JSON không hợp lệ' });
  res.status(500).json({ message: 'Lỗi máy chủ nội bộ' });
});

await migrate();
startInboxWorker();
const server = app.listen(config.PORT, '127.0.0.1', () => console.log(`Payment Duni listening on 127.0.0.1:${config.PORT}`));

async function shutdown() {
  stopInboxWorker();
  server.close();
  await pool.end();
  process.exit(0);
}
process.on('SIGTERM', () => { void shutdown(); });
process.on('SIGINT', () => { void shutdown(); });
