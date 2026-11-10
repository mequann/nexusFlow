import { Pool } from 'pg';

export function createPgPool(connectionString: string): Pool {
  return new Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

