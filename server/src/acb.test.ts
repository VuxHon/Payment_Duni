import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyEvent, historyQueryError, retryDelaySeconds, statementsQueryError } from './acb-contract.js';

test('statements chỉ cho phép truy vấn trong cùng một ngày', () => {
  assert.equal(statementsQueryError({ account: '123', from_date: '2026-08-11', to_date: '2026-08-11' }), null);
  assert.ok(statementsQueryError({ account: '123', from_date: '2026-08-10', to_date: '2026-08-11' }));
});

test('transaction history giới hạn 100 gần nhất và 500 trong ngày', () => {
  assert.equal(historyQueryError({ account: '123', from_date: '2026-08-11', to_date: '2026-08-11', limit: 500 }), null);
  assert.equal(historyQueryError({ account: '123', from_transaction_number: 1, to_transaction_number: 500, from_date: '2026-08-11', to_date: '2026-08-11' }), null);
  assert.equal(historyQueryError({ account: '123', limit: 100 }), null);
  assert.ok(historyQueryError({ account: '123' }));
  assert.ok(historyQueryError({ account: '123', limit: 101 }));
  assert.ok(historyQueryError({ account: '123', from_date: '2026-08-10', to_date: '2026-08-11' }));
  assert.ok(historyQueryError({ account: '123', from_date: '2026-08-11', to_date: '2026-08-11', limit: 501 }));
  assert.ok(historyQueryError({ account: '123', from_transaction_number: 1, to_transaction_number: 501, from_date: '2026-08-11', to_date: '2026-08-11' }));
});

test('phân loại callback sổ phụ và backoff có giới hạn', () => {
  assert.equal(classifyEvent({ statementId: 'abc', fileUrl: 'https://example.test/a.pdf' }), 'STATEMENT_RESULT');
  assert.equal(classifyEvent({ transactionId: 'abc', amount: 1000 }), 'TRANSACTION_NOTIFICATION');
  assert.equal(retryDelaySeconds(1), 5);
  assert.equal(retryDelaySeconds(20), 900);
});
