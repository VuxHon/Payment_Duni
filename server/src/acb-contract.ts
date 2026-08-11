export type InboxEventType = 'TRANSACTION_NOTIFICATION' | 'STATEMENT_RESULT';

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export function statementsQueryError(input: Record<string, unknown>) {
  const account = String(input.account || input.account_number || '');
  const fromDate = String(input.from_date || input.fromdate || '');
  const toDate = String(input.to_date || input.todate || '');
  if (!account || !datePattern.test(fromDate) || fromDate !== toDate) return 'ACB yêu cầu account hợp lệ và from_date = to_date theo YYYY-MM-DD';
  const page = input.page === undefined ? undefined : Number(input.page);
  const size = input.size === undefined ? undefined : Number(input.size);
  if ((page !== undefined && (!Number.isInteger(page) || page < 0)) || (size !== undefined && (!Number.isInteger(size) || size < 1 || size > 1000))) return 'page phải >= 0 và size phải từ 1 đến 1000';
  return null;
}

export function historyQueryError(input: Record<string, unknown>) {
  const account = String(input.account || '');
  if (!account) return 'account là bắt buộc';
  const fromNumber = input.from_transaction_number;
  const toNumber = input.to_transaction_number;
  const fromDate = input.from_date;
  const toDate = input.to_date;
  const limit = input.limit;
  const rangeNumberMode = fromNumber !== undefined || toNumber !== undefined;
  const dateMode = fromDate !== undefined || toDate !== undefined;
  if (rangeNumberMode && (fromNumber === undefined || toNumber === undefined || !fromDate || !toDate)) return 'Khoảng số giao dịch cần đủ from/to_transaction_number và from/to_date';
  if (!rangeNumberMode && dateMode && (!fromDate || !toDate)) return 'Khoảng ngày cần đủ from_date và to_date';
  if (!rangeNumberMode && !dateMode && (limit === undefined || Number(limit) < 1)) return 'Cần khoảng giao dịch, khoảng ngày hoặc limit';
  if ((fromDate && !datePattern.test(String(fromDate))) || (toDate && !datePattern.test(String(toDate)))) return 'Ngày phải theo định dạng YYYY-MM-DD';
  return null;
}

export function classifyEvent(body: Record<string, unknown>): InboxEventType {
  const text = JSON.stringify(body).toLowerCase();
  return /statement|e-statement|file_url|fileurl|download_url|document_url|report_url/.test(text) ? 'STATEMENT_RESULT' : 'TRANSACTION_NOTIFICATION';
}

export function retryDelaySeconds(attempts: number) {
  return Math.min(900, 2 ** Math.max(0, attempts - 1) * 5);
}
