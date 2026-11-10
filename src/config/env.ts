import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  STORAGE_DRIVER: z.enum(['memory', 'postgres']).default('memory'),
  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),

  JWT_SECRET: z.string().min(16).default('dev-jwt-secret-change-me-in-production-32chars'),
  JWT_ISSUER: z.string().default('nexusflow'),
  JWT_AUDIENCE: z.string().default('nexusflow-api'),

  VAULT_MASTER_KEY_V1: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'VAULT_MASTER_KEY_V1 must be 64 hex chars (32 bytes)')
    .default('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'),
  VAULT_MASTER_KEY_V2: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/)
    .optional(),
  VAULT_ACTIVE_KEY_ID: z.string().default('v1'),

  ENABLE_EMBEDDED_WORKERS: z
    .string()
    .transform((v) => v !== 'false')
    .default('true'),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(10).default(100),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(128).default(8),
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(50).default(250),
  TIMER_POLL_INTERVAL_MS: z.coerce.number().int().min(50).default(500),

  ALLOW_PRIVATE_NETWORK_HTTP: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),

  BOOTSTRAP_ADMIN_EMAIL: z.string().email().default('admin@nexusflow.local'),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(8).default('AdminChangeMe123!'),
});

export type AppConfig = z.infer<typeof EnvSchema>;

export function loadConfig(overrides: Record<string, string | undefined> = {}): AppConfig {
  return EnvSchema.parse({ ...process.env, ...overrides });
}
