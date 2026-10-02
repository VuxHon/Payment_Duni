// History and realtime callbacks must produce the same transaction reference/dedupe key.
export function historyTransaction(raw: Record<string, unknown>, account: string) {
  if (String(raw.transaction_status).toLowerCase() !== 'completed') return null;
  const reference = String(raw.transaction_code ?? '');
  const amount = Number(raw.transaction_amount);
  const direction = String(raw.debit_or_credit).toLowerCase();
  const day = String(raw.transaction_date ?? '');
  if (!reference || String(raw.account) !== account || !Number.isFinite(amount) || amount <= 0
    || !['credit', 'debit'].includes(direction) || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error('INVALID_ACB_HISTORY_TRANSACTION');
  }
  const description = String(raw.transaction_description ?? '');
  const time = description.match(/(\d{2})(\d{2})(\d{2})-(\d{2}:\d{2}:\d{2})$/);
  // ACB history can contain only a booking date. Noon preserves that date in UTC
  // for the existing AdminDuni outbox; do not substitute the current time.
  const transactionDate = time
    ? `20${time[3]}-${time[2]}-${time[1]}T${time[4]}+07:00`
    : `${day}T12:00:00+07:00`;
  if (Number.isNaN(Date.parse(transactionDate))) throw new Error('INVALID_ACB_HISTORY_DATE');
  return {
    bankHistoryRaw: raw, historyDateOnly: !time, accountNumber: account,
    transactionCode: reference, amount, debitOrCredit: direction,
    description, transactionDate, counterpartyName: raw.remitter_name ?? null,
    counterpartyAccount: raw.remitter_account_number ?? null, currency: 'VND'
  };
}
