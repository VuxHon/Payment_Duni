import { acb } from './acb.js';
import { acbConfigured, config } from './config.js';
import { pool } from './db.js';
import { historyTransaction } from './history-contract.js';
import { enqueueWebhook, runInboxOnce } from './inbox.js';

const enabled = config.ACB_HISTORY_POLL_ENABLED === 'true' && acbConfigured && Boolean(config.ACB_ACCOUNT_NUMBER);
const state = { enabled, intervalMs: config.ACB_HISTORY_POLL_INTERVAL_MS, running: false,
  lastAttemptAt: null as string | null, lastSuccessAt: null as string | null,
  lastError: null as string | null, fetched: 0, queued: 0 };
export const historyPollStatus = () => ({ ...state });

export async function runHistoryPollOnce() {
  if (!enabled || state.running) return;
  state.running = true;
  state.lastAttemptAt = new Date().toISOString();
  try {
    const response = await acb.history({ account: config.ACB_ACCOUNT_NUMBER, limit: 100 }) as {
      status?: { code?: string }; data?: { transactions?: Array<Record<string, unknown>> }
    };
    if (String(response?.status?.code) !== '200' || !Array.isArray(response?.data?.transactions)) {
      throw new Error('INVALID_ACB_HISTORY_RESPONSE');
    }
    // Validate the whole response before enqueueing any records.
    const transactions = response.data.transactions.map(raw => historyTransaction(raw, config.ACB_ACCOUNT_NUMBER!)).filter(t => t !== null);
    state.fetched = response.data.transactions.length;
    state.queued = 0;
    for (const txn of transactions) {
      const existing = await pool.query('SELECT id FROM transactions WHERE bank_reference=$1 AND account_number=$2',
        [txn.transactionCode, txn.accountNumber]);
      if (existing.rowCount) continue;
      const result = await enqueueWebhook({
        body: { reconciliationSource: 'ACB_HISTORY_POLL', sourceEnvironment: config.ACB_ENVIRONMENT, transactions: [txn] },
        headers: { 'x-request-id': `history-poll-${config.ACB_ENVIRONMENT}-${txn.accountNumber}-${txn.transactionCode}` },
        remoteIp: null, authenticated: true, eventType: 'TRANSACTION_NOTIFICATION'
      });
      if (!result.duplicate) state.queued += 1;
    }
    if (state.queued) await runInboxOnce();
    state.lastSuccessAt = new Date().toISOString();
    state.lastError = null;
    if (state.queued) console.log('ACB history fallback queued', { fetched: state.fetched, queued: state.queued });
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : String(error);
    console.error('ACB history fallback failed', state.lastError);
  } finally { state.running = false; }
}

let timer: NodeJS.Timeout | null = null;
export function startHistoryPollWorker() {
  if (timer || !enabled) return;
  void runHistoryPollOnce();
  timer = setInterval(() => { void runHistoryPollOnce(); }, config.ACB_HISTORY_POLL_INTERVAL_MS);
  timer.unref();
}
export function stopHistoryPollWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}
