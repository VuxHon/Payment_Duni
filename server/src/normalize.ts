import { createHash } from 'node:crypto';

export type NormalizedTransaction = {
  bankReference: string | null; accountNumber: string | null; counterpartyAccount: string | null;
  counterpartyName: string | null; direction: 'CREDIT' | 'DEBIT' | 'UNKNOWN'; amount: number;
  currency: string; description: string | null; transactionTime: Date; balanceAfter: number | null;
  rawPayload: Record<string, unknown>; dedupeKey: string;
};

const lowerEntries = (value: Record<string, unknown>) => new Map(Object.entries(value).map(([k, v]) => [k.toLowerCase().replace(/[_-]/g, ''), v]));
function pick(object: Record<string, unknown>, keys: string[]) {
  const map = lowerEntries(object);
  for (const key of keys) { const value = map.get(key.toLowerCase().replace(/[_-]/g, '')); if (value !== undefined && value !== null && value !== '') return value; }
  return undefined;
}
const text = (value: unknown) => value === undefined || value === null ? null : String(value).trim() || null;
function number(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  let raw = String(value ?? '').trim().replace(/\s/g, '');
  if (!raw) return 0;
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(raw)) raw = raw.replace(/,/g, '');
  else if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(raw)) raw = raw.replace(/\./g, '').replace(',', '.');
  else raw = raw.replace(',', '.');
  const parsed = Number(raw.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}
function date(value: unknown): Date {
  if (typeof value === 'number' || /^\d{10,13}$/.test(String(value ?? ''))) {
    const n = Number(value); const result = new Date(n < 10_000_000_000 ? n * 1000 : n);
    if (!Number.isNaN(result.getTime())) return result;
  }
  const raw = String(value ?? '');
  const vietnamese = raw.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (vietnamese) return new Date(`${vietnamese[3]}-${vietnamese[2]}-${vietnamese[1]}T${vietnamese[4] || '00'}:${vietnamese[5] || '00'}:${vietnamese[6] || '00'}+07:00`);
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}
function direction(value: unknown, amount: number): NormalizedTransaction['direction'] {
  const raw = String(value ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (['credit', 'cr', 'c', 'in', 'income', 'ghi co', 'receive', 'received'].some(v => raw === v || raw.includes(v))) return 'CREDIT';
  if (['debit', 'dr', 'd', 'out', 'expense', 'ghi no', 'payment', 'paid'].some(v => raw === v || raw.includes(v))) return 'DEBIT';
  return amount < 0 ? 'DEBIT' : 'UNKNOWN';
}

export function transactionObjects(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) return body.filter(v => v && typeof v === 'object') as Record<string, unknown>[];
  if (!body || typeof body !== 'object') return [];
  const root = body as Record<string, unknown>;
  for (const key of ['transactions', 'transactionList', 'items', 'records', 'data']) {
    const value = pick(root, [key]);
    if (Array.isArray(value)) return value.filter(v => v && typeof v === 'object') as Record<string, unknown>[];
    if (value && typeof value === 'object' && key === 'data') return transactionObjects(value);
  }
  return [root];
}

export function normalizeTransaction(raw: Record<string, unknown>): NormalizedTransaction {
  const amountValue = number(pick(raw, ['amount', 'transactionAmount', 'txnAmount', 'value', 'creditAmount', 'debitAmount']));
  const directionValue = direction(pick(raw, ['direction', 'transactionType', 'txnType', 'type', 'creditDebitIndicator', 'drCr', 'indicator']), amountValue);
  const normalized = {
    bankReference: text(pick(raw, ['transactionNumber', 'transactionId', 'transactionReference', 'referenceNumber', 'reference', 'refNo', 'traceId', 'txnId'])),
    accountNumber: text(pick(raw, ['accountNumber', 'accountNo', 'bankAccount', 'beneficiaryAccount', 'toAccount'])),
    counterpartyAccount: text(pick(raw, ['counterpartyAccount', 'senderAccount', 'fromAccount', 'remitterAccount', 'sourceAccount'])),
    counterpartyName: text(pick(raw, ['counterpartyName', 'senderName', 'remitterName', 'customerName'])),
    direction: directionValue,
    amount: Math.abs(amountValue),
    currency: text(pick(raw, ['currency', 'currencyCode', 'ccy']))?.toUpperCase() || 'VND',
    description: text(pick(raw, ['description', 'content', 'remark', 'narrative', 'transactionContent', 'message'])),
    transactionTime: date(pick(raw, ['transactionDateTime', 'transactionTime', 'transactionDate', 'txnTime', 'bookingDate', 'date'])),
    balanceAfter: pick(raw, ['balanceAfter', 'availableBalance', 'currentBalance', 'balance']) === undefined ? null : number(pick(raw, ['balanceAfter', 'availableBalance', 'currentBalance', 'balance'])),
    rawPayload: raw
  };
  const fingerprint = normalized.bankReference || JSON.stringify([normalized.accountNumber, normalized.direction, normalized.amount, normalized.description, normalized.transactionTime.toISOString()]);
  return { ...normalized, dedupeKey: createHash('sha256').update(fingerprint).digest('hex') };
}

