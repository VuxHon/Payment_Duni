import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeTransaction, transactionObjects } from './normalize.js';

test('normalizes common ACB-like credit payload', () => {
  const txn = normalizeTransaction({ transactionNumber: 'ACB123', accountNumber: '123456', amount: '1,250,000', transactionType: 'ghi co', content: 'THANH TOAN DON 99', transactionDate: '05/08/2026 14:20:10' });
  assert.equal(txn.bankReference, 'ACB123'); assert.equal(txn.amount, 1_250_000); assert.equal(txn.direction, 'CREDIT'); assert.equal(txn.description, 'THANH TOAN DON 99');
});
test('extracts transaction list from nested data', () => {
  assert.equal(transactionObjects({ data: { transactions: [{ id: 1 }, { id: 2 }] } }).length, 2);
});
test('normalizes debit and European number format', () => {
  const txn = normalizeTransaction({ refNo: 'D1', txnAmount: '1.234.567,89', drCr: 'DR' });
  assert.equal(txn.amount, 1_234_567.89); assert.equal(txn.direction, 'DEBIT');
});

