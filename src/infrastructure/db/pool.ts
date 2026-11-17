import { Pool, type PoolConfig } from 'pg';
import { type AppConfig, resolvePostgresConnectionString } from '../../config/env.js';

function shouldEnableSsl(connectionString?: string, explicitSsl?: boolean): boolean {
  if (explicitSsl) return true;
  if (!connectionString) return false;
  return /sslmode=(require|prefer|verify-ca|verify-full)|ssl=true|supabase\.(co|com)|neon\.tech|render\.com|amazonaws\.com|timescale\.com|cockroachlabs\.cloud/i.test(
    connectionString,
  );
}

export function createPgPool(
  connectionOrConfig: string | AppConfig,
  options: { ssl?: boolean; max?: number } = {},
): Pool {
  if (typeof connectionOrConfig === 'string') {
    const isSsl = shouldEnableSsl(connectionOrConfig, options.ssl);
    return new Pool({
      connectionString: connectionOrConfig,
      max: options.max ?? 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl: isSsl ? { rejectUnauthorized: false } : undefined,
    });
  }

  const connectionString = resolvePostgresConnectionString(connectionOrConfig);
  const isSsl = shouldEnableSsl(connectionString, connectionOrConfig.DB_SSL || options.ssl);

  const poolConfig: PoolConfig = {
    connectionString,
    max: connectionOrConfig.DB_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: isSsl ? { rejectUnauthorized: false } : undefined,
  };
  return new Pool(poolConfig);
}
