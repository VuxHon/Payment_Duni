import { randomUUID } from 'node:crypto';
import { historyQueryError, statementsQueryError } from './acb-contract.js';
import { acbApiSecret, acbClientSecret, acbConfigured, acbRequestHeadersConfigured, acbSandboxConfigured, config } from './config.js';
import { pool } from './db.js';

type Json = Record<string, unknown> | unknown[];
type Method = 'GET' | 'POST';

export class AcbApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly data: unknown) {
    super(message);
  }
}

let tokenCache: { value: string; expiresAt: number } | null = null;

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const combinePath = (suffix: string) => {
  if (/^https?:\/\//i.test(suffix)) return new URL(suffix).pathname;
  if (suffix.startsWith('/acb/') || suffix.startsWith('/auth/')) return suffix;
  const prefix = config.ACB_API_PREFIX.replace(/\/$/, '');
  return `${prefix}/${suffix.replace(/^\//, '')}`;
};

async function parseResponse(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function fetchToken(force = false) {
  if (!acbConfigured) throw new AcbApiError('Chưa cấu hình CLIENT_ID/ACB_CLIENT_SECRET cho ACB Sandbox', 503, null);
  if (!force && tokenCache && tokenCache.expiresAt > Date.now() + 30_000) return tokenCache.value;

  const form = new URLSearchParams({
    client_id: config.CLIENT_ID || '',
    client_secret: acbClientSecret,
    grant_type: config.ACB_GRANT_TYPE
  });
  if (config.ACB_SCOPE) form.set('scope', config.ACB_SCOPE);
  const response = await fetch(config.ACB_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
    signal: AbortSignal.timeout(config.ACB_REQUEST_TIMEOUT_MS)
  });
  const data = await parseResponse(response);
  const payload = asObject(data);
  if (!response.ok || typeof payload.access_token !== 'string') {
    throw new AcbApiError(String(payload.error_description || payload.message || 'Không lấy được access token ACB'), response.status, data);
  }
  tokenCache = {
    value: payload.access_token,
    expiresAt: Date.now() + Math.max(60, Number(payload.expires_in) || 300) * 1000
  };
  return tokenCache.value;
}

function sanitize(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sanitize);
  const blocked = /secret|token|authorization|password/i;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .map(([key, item]) => [key, blocked.test(key) ? '[REDACTED]' : sanitize(item)]));
}

async function audit(input: {
  operation: string; method: Method; path: string; requestId: string;
  requestData: unknown; responseStatus?: number; responseData?: unknown;
  durationMs: number; errorMessage?: string;
}) {
  try {
    await pool.query(`INSERT INTO acb_api_requests
      (operation,method,path,request_id,request_data,response_status,response_data,duration_ms,error_message)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
      input.operation, input.method, input.path, input.requestId, sanitize(input.requestData),
      input.responseStatus ?? null, sanitize(input.responseData) ?? null, input.durationMs, input.errorMessage ?? null
    ]);
  } catch (error) { console.error('ACB audit write failed', error); }
}

async function request(operation: string, method: Method, suffix: string, data: Record<string, unknown> = {}, retryAuth = true): Promise<unknown> {
  const requestId = randomUUID();
  const path = combinePath(suffix);
  const url = new URL(path, config.ACB_BASE_URL);
  if (method === 'GET') {
    for (const [key, value] of Object.entries(data)) if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const started = Date.now();
  try {
    const token = await fetchToken();
    const response = await fetch(url, {
      method,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        [config.ACB_HEADER_REQUEST_ID_NAME]: requestId,
        ...(config.CLIENT_ID ? { [config.ACB_HEADER_CLIENT_ID_NAME]: config.CLIENT_ID } : {}),
        ...(config.ACB_PROVIDER_ID ? { [config.ACB_HEADER_PROVIDER_ID_NAME]: config.ACB_PROVIDER_ID } : {}),
        ...(config.ACB_SERVICE ? { [config.ACB_HEADER_SERVICE_NAME]: config.ACB_SERVICE } : {}),
        ...(config.ACB_X_CHANNEL ? { [config.ACB_HEADER_CHANNEL_NAME]: config.ACB_X_CHANNEL } : {}),
        ...(config.ACB_HEADER_SECRET_NAME && acbApiSecret
          ? { [config.ACB_HEADER_SECRET_NAME]: acbApiSecret }
          : {})
      },
      ...(method === 'POST' ? { body: JSON.stringify(data) } : {}),
      signal: AbortSignal.timeout(config.ACB_REQUEST_TIMEOUT_MS)
    });
    const payload = await parseResponse(response);
    if (response.status === 401 && retryAuth) {
      await fetchToken(true);
      return request(operation, method, suffix, data, false);
    }
    await audit({ operation, method, path, requestId, requestData: data, responseStatus: response.status, responseData: payload, durationMs: Date.now() - started });
    if (!response.ok) {
      const object = asObject(payload);
      throw new AcbApiError(String(object.message || object.error_description || object.errorCode || `ACB HTTP ${response.status}`), response.status, payload);
    }
    // Các kịch bản chính thức của ACB dùng HTTP 202 cho lỗi nghiệp vụ 4202xxxx.
    if (response.status === 202) {
      const object = asObject(payload);
      throw new AcbApiError(String(object.message || object.errorMessage || object.errorCode || 'ACB từ chối yêu cầu'), 422, payload);
    }
    return payload;
  } catch (error) {
    if (!(error instanceof AcbApiError) || error.status === 503) {
      await audit({ operation, method, path, requestId, requestData: data, durationMs: Date.now() - started, errorMessage: error instanceof Error ? error.message : String(error) });
    }
    throw error;
  }
}

export function validateStatementsQuery(input: Record<string, unknown>) {
  const error = statementsQueryError(input);
  if (error) throw new AcbApiError(error, 400, null);
}

export function validateHistoryQuery(input: Record<string, unknown>) {
  const error = historyQueryError(input);
  if (error) throw new AcbApiError(error, 400, null);
}

function remap(input: Record<string, unknown>, fields: Record<string, string[]>) {
  const result = { ...input };
  for (const [target, aliases] of Object.entries(fields)) {
    const value = aliases.map(key => input[key]).find(item => item !== undefined && item !== null && item !== '');
    for (const alias of aliases) delete result[alias];
    if (value !== undefined) result[target] = value;
  }
  return result;
}

function sandboxPayload(input: Record<string, unknown>) {
  const amount = Number(input.transactionAmount ?? input.amount);
  const numberOfTransaction = Number(input.numberOfTransaction ?? 1);
  const description = String(input.description || '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').trim();
  if (!Number.isFinite(amount) || amount < 1 || amount > 500_000_000) {
    throw new AcbApiError('Số tiền test phải từ 1 đến 500.000.000 VND', 400, null);
  }
  if (!Number.isInteger(numberOfTransaction) || numberOfTransaction < 1 || numberOfTransaction > 10) {
    throw new AcbApiError('numberOfTransaction phải từ 1 đến 10', 400, null);
  }
  if (!description || description.length > 255) {
    throw new AcbApiError('Nội dung test phải từ 1 đến 255 ký tự', 400, null);
  }
  return {
    requestTrace: randomUUID(),
    requestDateTime: new Date().toISOString(),
    requestParameters: { transactionAmount: amount, description, numberOfTransaction }
  };
}

export const acb = {
  configured: () => acbConfigured,
  requestHeadersConfigured: () => acbRequestHeadersConfigured,
  sandboxConfigured: () => acbSandboxConfigured,
  accounts: (query: Record<string, unknown>) => request('accounts', 'GET', config.ACB_PATH_ACCOUNTS, query),
  balances: (query: Record<string, unknown>) => request('balances', 'GET', config.ACB_PATH_BALANCES,
    remap(query, { account_number: ['account_number', 'account'] })),
  history: (query: Record<string, unknown>) => { validateHistoryQuery(query); return request('transaction-history', 'GET', config.ACB_PATH_TRANSACTION_HISTORY, query); },
  statements: (query: Record<string, unknown>) => { validateStatementsQuery(query); return request('statements', 'GET', config.ACB_PATH_STATEMENTS,
    remap(query, { account_number: ['account_number', 'account'] })); },
  transactionDetail: (query: Record<string, unknown>) => request('transaction-detail', 'GET', config.ACB_PATH_TRANSACTION_DETAIL, query),
  statementRetrieve: (query: Record<string, unknown>) => request('statement-retrieve', 'GET', config.ACB_PATH_STATEMENT_RETRIEVE,
    remap(query, { accountNumber: ['accountNumber', 'account_number', 'account'], fromDate: ['fromDate', 'from_date'], toDate: ['toDate', 'to_date'] })),
  statementInquiry: (query: Record<string, unknown>) => request('statement-inquiry', 'GET', config.ACB_PATH_STATEMENT_INQUIRY,
    remap(query, { accountNumber: ['accountNumber', 'account_number', 'account'], fromDate: ['fromDate', 'from_date'], toDate: ['toDate', 'to_date'] })),
  registerEStatement: (body: Record<string, unknown>) => request('e-statement-registration', 'POST', config.ACB_PATH_ESTATEMENT_REGISTRATION, body),
  sandboxCredit: (body: Record<string, unknown>) => request('sandbox-credit', 'POST', config.ACB_PATH_SANDBOX_CREDIT, sandboxPayload(body)),
  sandboxDebit: (body: Record<string, unknown>) => request('sandbox-debit', 'POST', config.ACB_PATH_SANDBOX_DEBIT, sandboxPayload(body))
};
