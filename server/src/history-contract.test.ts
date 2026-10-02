import test from 'node:test';
import assert from 'node:assert/strict';
import { historyTransaction } from './history-contract.js';
import { normalizeTransaction } from './normalize.js';

const raw = { account: 50557457, transaction_code: 2826, transaction_amount: 630000,
  debit_or_credit: 'Credit', transaction_date: '2026-10-02', transaction_status: 'Completed',
  transaction_description: 'ACB;50557457;Xuan Nghi-GD-238426-021026-10:51:40' };

test('history fallback and late realtime webhook share the dedupe key', () => {
  const history = normalizeTransaction(historyTransaction(raw, '50557457')!);
  const webhook = normalizeTransaction({ accountNumber: 50557457, transactionCode: '2826', amount: 630000,
    debitOrCredit: 'credit', transactionDate: '2026-10-02T03:51:40.000Z' });
  assert.equal(history.dedupeKey, webhook.dedupeKey);
  assert.equal(history.transactionTime.toISOString(), webhook.transactionTime.toISOString());
  assert.equal(history.accountNumber, '50557457');
});

test('history preserves booking date when an exact time is unavailable', () => {
  const txn = historyTransaction({ ...raw, transaction_description: 'deposit' }, '50557457')!;
  assert.equal(txn.historyDateOnly, true);
  assert.equal(normalizeTransaction(txn).transactionTime.toISOString().slice(0, 10), '2026-10-02');
});

test('pending or malformed history must not create financial transactions', () => {
  assert.equal(historyTransaction({ ...raw, transaction_status: 'Pending' }, '50557457'), null);
  assert.throws(() => historyTransaction(raw, 'different-account'));
  assert.throws(() => historyTransaction({ ...raw, transaction_amount: 'invalid' }, '50557457'));
});
