import { createHash } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { classifyEvent, retryDelaySeconds, type InboxEventType } from './acb-contract.js';
import { config } from './config.js';
import { pool } from './db.js';
import { normalizeTransaction, transactionObjects } from './normalize.js';

export { classifyEvent, retryDelaySeconds, type InboxEventType } from './acb-contract.js';

export function publicHeaders(headers: IncomingHttpHeaders) {
  const blocked = new Set(['authorization', 'cookie', 'x-api-key', 'x-webhook-token', 'x-client-secret']);
  return Object.fromEntries(Object.entries(headers).filter(([key]) => !blocked.has(key.toLowerCase())));
}

export async function enqueueWebhook(input: {
  body: Record<string, unknown>;
  headers: IncomingHttpHeaders;
  remoteIp: string | null;
  authenticated: boolean;
  eventType?: InboxEventType;
}) {
  const hash = createHash('sha256').update(JSON.stringify(input.body)).digest('hex');
  const result = await pool.query(`INSERT INTO webhook_deliveries
    (event_type,request_id,raw_body,raw_body_sha256,request_headers,remote_ip,authenticated,status,next_attempt_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,'PENDING',now())
    ON CONFLICT (raw_body_sha256) DO NOTHING RETURNING id`, [
    input.eventType || classifyEvent(input.body),
    String(input.headers['x-global-transaction-id'] || input.headers['x-request-id'] || input.headers['x-correlation-id'] || '') || null,
    input.body, hash, publicHeaders(input.headers), input.remoteIp, input.authenticated
  ]);
  return { duplicate: !result.rowCount, deliveryId: result.rows[0]?.id as string | undefined };
}

const value = (raw: Record<string, unknown>, ...keys: string[]) => {
  for (const key of keys) if (raw[key] !== undefined && raw[key] !== null) return String(raw[key]);
  return null;
};

async function processStatement(client: import('pg').PoolClient, delivery: { id: string; raw_body: Record<string, unknown> }) {
  const body = delivery.raw_body;
  await client.query(`INSERT INTO statement_results
    (source_delivery_id,request_reference,account_number,result_status,file_url,raw_payload)
    VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (source_delivery_id) DO NOTHING`, [
    delivery.id,
    value(body, 'request_reference', 'requestReference', 'reference', 'requestId'),
    value(body, 'account', 'account_number', 'accountNumber'),
    value(body, 'status', 'result_status', 'resultStatus'),
    value(body, 'file_url', 'fileUrl', 'download_url', 'document_url', 'report_url'),
    body
  ]);
  return 0;
}

async function processTransactions(client: import('pg').PoolClient, delivery: { id: string; raw_body: Record<string, unknown> }) {
  let count = 0;
  for (const raw of transactionObjects(delivery.raw_body)) {
    const txn = normalizeTransaction(raw);
    const inserted = await client.query(`INSERT INTO transactions
      (source_delivery_id,bank_reference,account_number,counterparty_account,counterparty_name,direction,amount,currency,description,transaction_time,balance_after,raw_payload,dedupe_key)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`, [
      delivery.id, txn.bankReference, txn.accountNumber, txn.counterpartyAccount, txn.counterpartyName,
      txn.direction, txn.amount, txn.currency, txn.description, txn.transactionTime, txn.balanceAfter,
      txn.rawPayload, txn.dedupeKey
    ]);
    if (inserted.rows[0]?.id && txn.accountNumber && txn.amount > 0 && txn.direction !== 'UNKNOWN') {
      const transactionId = String(inserted.rows[0].id);
      const transactionDate = txn.transactionTime.toISOString().slice(0, 10);
      const documentNumber = txn.bankReference || `ACB-${txn.dedupeKey.slice(0, 24)}`;
      const payload = {
        requestId: transactionId,
        sourceEnvironment: config.ACB_ENVIRONMENT,
        accountNumber: txn.accountNumber,
        observedAt: new Date().toISOString(),
        transactions: [{
          paymentTransactionId: transactionId,
          transactionDate,
          effectiveDate: transactionDate,
          documentNumber,
          debitAmount: txn.direction === 'DEBIT' ? txn.amount : 0,
          creditAmount: txn.direction === 'CREDIT' ? txn.amount : 0,
          runningBalance: txn.balanceAfter,
          description: txn.description || documentNumber,
          currency: txn.currency,
          counterpartyAccount: txn.counterpartyAccount,
          counterpartyName: txn.counterpartyName
        }]
      };
      await client.query(`INSERT INTO admin_sync_outbox (transaction_id,payload)
        VALUES ($1,$2) ON CONFLICT (transaction_id) DO NOTHING`, [transactionId, payload]);
    }
    count += inserted.rowCount || 0;
  }
  return count;
}

async function processDelivery(delivery: { id: string; event_type: InboxEventType; raw_body: Record<string, unknown>; attempts: number }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const count = delivery.event_type === 'STATEMENT_RESULT'
      ? await processStatement(client, delivery)
      : await processTransactions(client, delivery);
    await client.query(`UPDATE webhook_deliveries SET status='PROCESSED', transaction_count=$2,
      processed_at=now(), locked_at=NULL, error_message=NULL WHERE id=$1`, [delivery.id, count]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    const dead = delivery.attempts >= config.INBOX_MAX_ATTEMPTS;
    await pool.query(`UPDATE webhook_deliveries SET status=$2, locked_at=NULL, error_message=$3,
      next_attempt_at=now() + ($4 * interval '1 second') WHERE id=$1`, [
      delivery.id, dead ? 'DEAD_LETTER' : 'RETRY', error instanceof Error ? error.message.slice(0, 2000) : String(error), retryDelaySeconds(delivery.attempts)
    ]);
    console.error(`Inbox delivery ${delivery.id} failed`, error);
  } finally { client.release(); }
}

let running = false;
let timer: NodeJS.Timeout | null = null;

export async function runInboxOnce() {
  if (running) return 0;
  running = true;
  try {
    await pool.query(`UPDATE webhook_deliveries SET status='RETRY', locked_at=NULL, next_attempt_at=now()
      WHERE status='PROCESSING' AND locked_at < now() - interval '5 minutes'`);
    const claimed = await pool.query(`WITH ready AS (
      SELECT id FROM webhook_deliveries
      WHERE status IN ('PENDING','RETRY') AND next_attempt_at <= now()
      ORDER BY received_at FOR UPDATE SKIP LOCKED LIMIT $1
    ) UPDATE webhook_deliveries d SET status='PROCESSING', locked_at=now(), attempts=d.attempts+1
      FROM ready WHERE d.id=ready.id RETURNING d.id,d.event_type,d.raw_body,d.attempts`, [config.INBOX_BATCH_SIZE]);
    for (const row of claimed.rows) await processDelivery(row);
    return claimed.rowCount || 0;
  } finally { running = false; }
}

export function startInboxWorker() {
  if (timer) return;
  const tick = () => { void runInboxOnce().catch(error => console.error('Inbox worker failed', error)); };
  tick();
  timer = setInterval(tick, config.INBOX_POLL_INTERVAL_MS);
  timer.unref();
}

export function stopInboxWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}
