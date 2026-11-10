import { Pool, type PoolConfig } from 'pg';
import { type AppConfig, resolvePostgresConnectionString } from '../../config/env.js';

export function createPgPool(
  connectionOrConfig: string | AppConfig,
  options: { ssl?: boolean; max?: number } = {},
): Pool {
  if (typeof connectionOrConfig === 'string') {
    return new Pool({
      connectionString: connectionOrConfig,
      max: options.max ?? 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl: options.ssl ? { rejectUnauthorized: false } : undefined,
    });
  }

  const poolConfig: PoolConfig = {
    connectionString: resolvePostgresConnectionString(connectionOrConfig),
    max: connectionOrConfig.DB_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: connectionOrConfig.DB_SSL ? { rejectUnauthorized: false } : undefined,
  };
  return new Pool(poolConfig);
}
