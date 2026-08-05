import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  POSTGRES_HOST: z.string().min(1), POSTGRES_PORT: z.coerce.number().int().positive().default(5432),
  POSTGRES_USER: z.string().min(1), POSTGRES_DB: z.string().min(1), POSTGRES_PASSWORD: z.string(),
  POSTGRES_SSL: z.enum(['true', 'false']).default('false'),
  ADMIN_USERNAME: z.string().min(1).default('admin'), ADMIN_PASSWORD: z.string().min(10),
  SESSION_SECRET: z.string().min(32), PUBLIC_URL: z.string().url().default('http://localhost:3000'),
  ACB_CALLBACK_TOKEN: z.string().min(20), ACB_WEBHOOK_TOKEN: z.string().optional(),
  ACB_WEBHOOK_AUTH_REQUIRED: z.enum(['true', 'false']).default('false'),
  CLIENT_ID: z.string().optional(), SCRECET_ID: z.string().optional(), ACB_CLIENT_SECRET: z.string().optional()
});

export const config = schema.parse(process.env);
export const isProduction = config.NODE_ENV === 'production';

