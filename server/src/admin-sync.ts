import { createHmac } from 'node:crypto';
import { adminSyncConfigured, config } from './config.js';
import { pool } from './db.js';
import { isPermanentAdminSyncStatus, retryDelaySeconds } from './acb-contract.js';

let running = false;

async function deliver(row: { id: string; payload: Record<string, unknown>; attempts: number }) {
  const body = JSON.stringify(row.payload);
  const timestamp = String(Date.now());
  const signature = createHmac('sha256', config.ADMIN_SYNC_SHARED_SECRET || '')
    .update(`${timestamp}.`)
    .update(body)
    .digest('hex');
  const response = await fetch(config.ADMIN_SYNC_URL || '', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-acb-timestamp': timestamp,
      'x-acb-signature': signature,
      'x-payment-event-id': row.id
    },
    body,
    signal: AbortSignal.timeout(config.ADMIN_SYNC_TIMEOUT_MS)
  });
  if (!response.ok) throw Object.assign(new Error(`ADMIN_SYNC_HTTP_${response.status}`), { status: response.status });
  await pool.query(`UPDATE admin_sync_outbox SET status='SENT',sent_at=now(),locked_at=NULL,
    response_status=$2,error_message=NULL,updated_at=now() WHERE id=$1`, [row.id, response.status]);
}

export async function runAdminSyncOnce() {
  if (!adminSyncConfigured || running) return 0;
  running = true;
  try {
    await pool.query(`UPDATE admin_sync_outbox SET status='RETRY',locked_at=NULL,next_attempt_at=now(),updated_at=now()
      WHERE status='PROCESSING' AND locked_at < now() - interval '5 minutes'`);
    const claimed = await pool.query(`WITH ready AS (
      SELECT id FROM admin_sync_outbox
      WHERE status IN ('PENDING','RETRY') AND next_attempt_at <= now()
      ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $1
    ) UPDATE admin_sync_outbox o SET status='PROCESSING',locked_at=now(),attempts=o.attempts+1,updated_at=now()
      FROM ready WHERE o.id=ready.id RETURNING o.id,o.payload,o.attempts`, [config.INBOX_BATCH_SIZE]);
    for (const row of claimed.rows as Array<{ id: string; payload: Record<string, unknown>; attempts: number }>) {
      try {
        await deliver(row);
      } catch (error) {
        const status = Number((error as { status?: number })?.status) || null;
        // Mất mạng, AdminDuni dừng hoặc HTTP 5xx phải retry vô hạn để không làm
        // mất giao dịch. Chỉ lỗi 4xx mang tính cấu hình/payload mới dead-letter
        // sau ngưỡng, để người vận hành sửa rồi chủ động requeue.
        const permanentClientError = isPermanentAdminSyncStatus(status);
        const dead = permanentClientError && row.attempts >= config.ADMIN_SYNC_MAX_ATTEMPTS;
        await pool.query(`UPDATE admin_sync_outbox SET status=$2,locked_at=NULL,response_status=$3,
          error_message=$4,next_attempt_at=now()+($5*interval '1 second'),updated_at=now() WHERE id=$1`, [
          row.id, dead ? 'DEAD_LETTER' : 'RETRY', status,
          error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000),
          retryDelaySeconds(row.attempts)
        ]);
      }
    }
    return claimed.rowCount || 0;
  } finally {
    running = false;
  }
}

let timer: NodeJS.Timeout | null = null;

export function startAdminSyncWorker() {
  if (timer || !adminSyncConfigured) return;
  const tick = () => { void runAdminSyncOnce().catch(error => console.error('Admin sync worker failed', error)); };
  tick();
  timer = setInterval(tick, config.ADMIN_SYNC_POLL_INTERVAL_MS);
  timer.unref();
}

export function stopAdminSyncWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}
