import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyEvent, historyQueryError, retryDelaySeconds, statementsQueryError } from './acb-contract.js';
import { normalizeTransaction, transactionObjects } from './normalize.js';

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

test('đọc đúng callback realtime chính thức của ACB', () => {
  const body = {
    masterMeta: { clientId: '00000000-0000-0000-0000-000000000000' },
    requests: [{
      requestMeta: { requestType: 'NOTIFICATION', requestCode: 'TRANSACTION_UPDATE' },
      requestParams: { transactions: [{
        transactionStatus: 'COMPLETED', transactionChannel: 'IBFT', transactionCode: '56327',
        accountNumber: 4810329, transactionDate: '2026-08-25T03:28:51.000Z', effectiveDate: '2026-08-24T17:00:00.000Z',
        debitOrCredit: 'credit', amount: 282801, transactionContent: 'THANH TOAN DON 99',
        transactionEntityAttribute: { remitterName: 'NGUYEN VAN A', remitterAccountNumber: '123456789' }
      }] }
    }]
  };
  const rows = transactionObjects(body);
  assert.equal(rows.length, 1);
  const txn = normalizeTransaction(rows[0]);
  assert.equal(txn.bankReference, '56327');
  assert.equal(txn.accountNumber, '4810329');
  assert.equal(txn.direction, 'CREDIT');
  assert.equal(txn.amount, 282801);
  assert.equal(txn.counterpartyName, 'NGUYEN VAN A');
  assert.equal(txn.counterpartyAccount, '123456789');
  assert.equal(txn.description, 'THANH TOAN DON 99');
});

test('callback không có transactions không tạo giao dịch rỗng', () => {
  assert.deepEqual(transactionObjects({ masterMeta: {}, requests: [] }), []);
});
