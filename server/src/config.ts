import 'dotenv/config';
import { z } from 'zod';

const headerName = z.string().regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/);
const optionalHeaderName = z.preprocess(value => value === '' ? undefined : value, headerName.optional());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  POSTGRES_HOST: z.string().min(1),
  POSTGRES_PORT: z.coerce.number().int().positive().default(5432),
  POSTGRES_USER: z.string().min(1),
  POSTGRES_DB: z.string().min(1),
  POSTGRES_PASSWORD: z.string(),
  POSTGRES_SSL: z.enum(['true', 'false']).default('false'),
  ADMIN_USERNAME: z.string().min(1).default('admin'),
  ADMIN_PASSWORD: z.string().min(10),
  SESSION_SECRET: z.string().min(32),
  PUBLIC_URL: z.string().url().default('http://localhost:3000'),

  CLIENT_ID: z.string().optional(),
  SCRECET_ID: z.string().optional(),
  ACB_CLIENT_SECRET: z.string().optional(),
  ACB_BASE_URL: z.string().url().default('https://sandbox.acb.com.vn'),
  ACB_TOKEN_URL: z.string().url().default('https://sandbox.acb.com.vn/acb/open/auth/realms/soba/protocol/openid-connect/token'),
  ACB_GRANT_TYPE: z.string().default('client_credentials'),
  ACB_SCOPE: z.string().optional(),
  ACB_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(15000),
  ACB_X_CHANNEL: z.string().optional(),
  ACB_PROVIDER_ID: z.string().optional(),
  ACB_SERVICE: z.string().optional(),
  ACB_TEST_ACCOUNT: z.string().optional(),
  ACB_API_SECRET: z.string().optional(),
  ACB_HEADER_CHANNEL_NAME: headerName.default('x-channel'),
  ACB_HEADER_REQUEST_ID_NAME: headerName.default('x-request-id'),
  ACB_HEADER_CLIENT_ID_NAME: headerName.default('x-client-id'),
  ACB_HEADER_PROVIDER_ID_NAME: headerName.default('x-provider-id'),
  ACB_HEADER_SERVICE_NAME: headerName.default('x-service'),
  ACB_HEADER_SECRET_NAME: optionalHeaderName,
  ACB_API_PREFIX: z.string().default('/acb/open/account-information/v1'),
  ACB_PATH_ACCOUNTS: z.string().default('/acb/open/customers/account/v1/accounts'),
  ACB_PATH_BALANCES: z.string().default('/acb/open/customers/account/v1/balances'),
  ACB_PATH_TRANSACTION_HISTORY: z.string().default('/acb/open/accounts/transactions/v1/transaction-history'),
  ACB_PATH_STATEMENTS: z.string().default('/acb/open/customers/account/v1/statements'),
  ACB_PATH_TRANSACTION_DETAIL: z.string().default('/acb/open/customers/account/v1/transaction/detail'),
  ACB_PATH_STATEMENT_RETRIEVE: z.string().default('/acb/open/oe/current-account/v1/statement/retrieve'),
  ACB_PATH_STATEMENT_INQUIRY: z.string().default('/acb/open/oe/current-account/v1/account/statement/inquiry'),
  ACB_PATH_ESTATEMENT_REGISTRATION: z.string().default('/acb/open/oe/current-account/v1/e-statement/registration'),
  ACB_PATH_SANDBOX_CREDIT: z.string().default('/acb/open/payment/payment-execution/v1/credit'),
  ACB_PATH_SANDBOX_DEBIT: z.string().default('/acb/open/payment/payment-execution/v1/debit'),

  ACB_CALLBACK_TOKEN: z.string().min(20),
  ACB_WEBHOOK_TOKEN: z.string().optional(),
  ACB_WEBHOOK_AUTH_REQUIRED: z.enum(['true', 'false']).default('true'),
  ACB_CALLBACK_MAX_BODY_BYTES: z.coerce.number().int().min(1024).max(10_000_000).default(1_048_576),
  INBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60000).default(1000),
  INBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20),
  INBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(50).default(8)
});

export const config = schema.parse(process.env);
export const isProduction = config.NODE_ENV === 'production';
export const acbClientSecret = config.ACB_CLIENT_SECRET || config.SCRECET_ID || '';
export const acbApiSecret = config.ACB_API_SECRET || acbClientSecret;
export const acbConfigured = Boolean(config.CLIENT_ID && acbClientSecret);
export const acbRequestHeadersConfigured = Boolean(config.ACB_X_CHANNEL && config.ACB_PROVIDER_ID && config.ACB_SERVICE);
export const acbSandboxConfigured = Boolean(acbConfigured && acbRequestHeadersConfigured);
