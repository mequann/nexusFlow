import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { loadConfig } from '../../config/env.js';
import { createPgPool } from './pool.js';

export async function runMigrations(pool: Pool, migrationsDir?: string): Promise<string[]> {
  const dir =
    migrationsDir ??
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../migrations');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const appliedResult = await pool.query<{ version: string }>('SELECT version FROM schema_migrations');
  const applied = new Set(appliedResult.rows.map((r) => r.version));

  const newlyApplied: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await fs.readFile(path.join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
      await client.query('COMMIT');
      newlyApplied.push(file);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
  return newlyApplied;
}

const isCli =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isCli) {
  const config = loadConfig();
  const pool = createPgPool(config);
  runMigrations(pool)
    .then((applied) => {
      console.log('Migrations complete:', applied.length ? applied : 'up to date');
      return pool.end();
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
