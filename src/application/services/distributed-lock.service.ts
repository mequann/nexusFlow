import crypto from 'node:crypto';
import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import Redis from 'ioredis';
import { APP_CONFIG, APP_LOGGER } from '../tokens.js';
import type { AppConfig } from '../../config/env.js';
import type { ILogger } from '../../domain/ports/telemetry.js';
import { createPgPool } from '../../infrastructure/db/pool.js';

export interface LockHandle {
  key: string;
  acquired: boolean;
  driver: 'postgres_advisory' | 'redis' | 'memory';
  lockId: string;
  client?: PoolClient;
}

@Injectable()
export class DistributedLockService implements OnModuleDestroy {
  private inMemoryLocks = new Set<string>();
  private pgPool: Pool | null = null;
  private redisClient: any | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(APP_LOGGER) private readonly logger: ILogger,
  ) {}

  private getPool(): Pool {
    if (!this.pgPool) {
      this.pgPool = createPgPool(this.config);
    }
    return this.pgPool;
  }

  private getRedis(): any {
    if (!this.redisClient) {
      this.redisClient = new (Redis as any)(this.config.REDIS_URL ?? 'redis://localhost:6379', {
        maxRetriesPerRequest: 1,
        lazyConnect: true,
      });
    }
    return this.redisClient;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pgPool) {
      await this.pgPool.end();
      this.pgPool = null;
    }
    if (this.redisClient) {
      await this.redisClient.quit().catch(() => {});
      this.redisClient = null;
    }
  }

  /**
   * Acquire a non-blocking distributed lock across cluster nodes.
   * If already held by another node/process, returns acquired: false immediately.
   */
  async tryAcquire(lockName: string, ttlMs = 10_000): Promise<LockHandle> {
    const lockId = crypto.randomUUID();

    if (this.config.STORAGE_DRIVER === 'memory' || this.config.CLUSTER_LOCK_DRIVER === 'memory') {
      if (this.inMemoryLocks.has(lockName)) {
        return { key: lockName, acquired: false, driver: 'memory', lockId };
      }
      this.inMemoryLocks.add(lockName);
      return { key: lockName, acquired: true, driver: 'memory', lockId };
    }

    if (this.config.CLUSTER_LOCK_DRIVER === 'redis' && this.config.REDIS_URL) {
      try {
        const redis = this.getRedis();
        const res = await redis.set(`lock:${lockName}`, lockId, 'PX', ttlMs, 'NX');
        const acquired = res === 'OK';
        return { key: lockName, acquired, driver: 'redis', lockId };
      } catch (err: any) {
        this.logger.warn(`Redis lock check failed (${err.message}), falling back to memory lock`);
        if (this.inMemoryLocks.has(lockName)) {
          return { key: lockName, acquired: false, driver: 'memory', lockId };
        }
        this.inMemoryLocks.add(lockName);
        return { key: lockName, acquired: true, driver: 'memory', lockId };
      }
    }

    if (this.config.CLUSTER_LOCK_DRIVER === 'postgres_advisory' || !this.config.REDIS_URL) {
      // 64-bit integer hash for PostgreSQL Advisory Lock
      const hash = crypto.createHash('sha256').update(lockName).digest();
      // Read first 8 bytes as a signed BigInt
      const lockNumber = hash.readBigInt64BE(0);

      try {
        const client = await this.getPool().connect();
        try {
          const res = await client.query<{ pg_try_advisory_lock: boolean }>(
            'SELECT pg_try_advisory_lock($1) as pg_try_advisory_lock',
            [lockNumber.toString()],
          );
          const acquired = Boolean(res.rows[0]?.pg_try_advisory_lock);
          if (!acquired) {
            client.release();
            return { key: lockName, acquired: false, driver: 'postgres_advisory', lockId: lockNumber.toString() };
          }
          return { key: lockName, acquired: true, driver: 'postgres_advisory', lockId: lockNumber.toString(), client };
        } catch (queryErr: any) {
          client.release();
          throw queryErr;
        }
      } catch (err: any) {
        this.logger.warn(`Postgres advisory lock check failed (${err.message}), falling back to memory lock`);
        if (this.inMemoryLocks.has(lockName)) {
          return { key: lockName, acquired: false, driver: 'memory', lockId };
        }
        this.inMemoryLocks.add(lockName);
        return { key: lockName, acquired: true, driver: 'memory', lockId };
      }
    }

    // Default memory fallback
    if (this.inMemoryLocks.has(lockName)) {
      return { key: lockName, acquired: false, driver: 'memory', lockId };
    }
    this.inMemoryLocks.add(lockName);
    return { key: lockName, acquired: true, driver: 'memory', lockId };
  }

  async release(handle: LockHandle): Promise<void> {
    if (!handle.acquired) return;

    if (handle.driver === 'memory') {
      this.inMemoryLocks.delete(handle.key);
      return;
    }

    if (handle.driver === 'redis' && this.redisClient) {
      const lua = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      try {
        await this.redisClient.eval(lua, 1, `lock:${handle.key}`, handle.lockId);
      } catch (err: any) {
        this.logger.warn(`Redis advisory unlock error: ${err.message}`);
      }
      return;
    }

    if (handle.driver === 'postgres_advisory') {
      if (handle.client) {
        try {
          await handle.client.query('SELECT pg_advisory_unlock($1)', [handle.lockId]);
        } catch (err: any) {
          this.logger.warn(`Postgres advisory unlock error: ${err.message}`);
        } finally {
          handle.client.release();
          handle.client = undefined;
        }
      }
    }
  }

  /**
   * Execute an asynchronous task exclusively across the cluster under a distributed lock.
   */
  async withLock<T>(
    lockName: string,
    action: () => Promise<T>,
    ttlMs = 15_000,
  ): Promise<{ executed: boolean; result?: T }> {
    const handle = await this.tryAcquire(lockName, ttlMs);
    if (!handle.acquired) {
      return { executed: false };
    }

    try {
      const result = await action();
      return { executed: true, result };
    } finally {
      await this.release(handle);
    }
  }
}
