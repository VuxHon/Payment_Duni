import pg from 'pg';
import { config } from './config.js';

export const pool = new pg.Pool({
  host: config.POSTGRES_HOST, port: config.POSTGRES_PORT, user: config.POSTGRES_USER,
  database: config.POSTGRES_DB, password: config.POSTGRES_PASSWORD,
  ssl: config.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000
});

export async function migrate() {
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      provider text NOT NULL DEFAULT 'ACB',
      request_id text,
      raw_body jsonb NOT NULL,
      raw_body_sha256 text NOT NULL UNIQUE,
      request_headers jsonb NOT NULL DEFAULT '{}'::jsonb,
      remote_ip inet,
      authenticated boolean NOT NULL DEFAULT false,
      status text NOT NULL DEFAULT 'PROCESSED',
      transaction_count integer NOT NULL DEFAULT 0,
      error_message text,
      received_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      source_delivery_id uuid REFERENCES webhook_deliveries(id) ON DELETE RESTRICT,
      provider text NOT NULL DEFAULT 'ACB',
      bank_reference text,
      account_number text,
      counterparty_account text,
      counterparty_name text,
      direction text NOT NULL CHECK (direction IN ('CREDIT','DEBIT','UNKNOWN')),
      amount numeric(20,2) NOT NULL DEFAULT 0,
      currency varchar(8) NOT NULL DEFAULT 'VND',
      description text,
      transaction_time timestamptz NOT NULL,
      balance_after numeric(20,2),
      raw_payload jsonb NOT NULL,
      dedupe_key text NOT NULL UNIQUE,
      received_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS transactions_time_idx ON transactions (transaction_time DESC);
    CREATE INDEX IF NOT EXISTS transactions_direction_idx ON transactions (direction, transaction_time DESC);
    CREATE INDEX IF NOT EXISTS transactions_reference_idx ON transactions (bank_reference);
    CREATE INDEX IF NOT EXISTS deliveries_received_idx ON webhook_deliveries (received_at DESC);
  `);
}

