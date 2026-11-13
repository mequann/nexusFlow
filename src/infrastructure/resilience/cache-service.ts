import { Inject, Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import type { AppConfig } from '../../config/env.js';
import { APP_CONFIG } from '../../application/tokens.js';

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly redisClient: InstanceType<typeof Redis> | null = null;
  private readonly memoryCache = new Map<string, { value: unknown; expiresAt: number }>();

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    if (config.REDIS_URL) {
      try {
        this.redisClient = new Redis(config.REDIS_URL, {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
        });
        this.redisClient.connect().catch((err: Error) => {
          this.logger.warn(`Redis connection failed (${err.message}). Falling back to in-memory cache.`);
        });
      } catch (err: unknown) {
        this.logger.warn(`Failed to initialize Redis client: ${String(err)}`);
      }
    }
  }

  async get<T>(key: string): Promise<T | null> {
    if (this.redisClient && this.redisClient.status === 'ready') {
      try {
        const raw = await this.redisClient.get(key);
        return raw ? (JSON.parse(raw) as T) : null;
      } catch {
        // Fall back to memory cache
      }
    }

    const item = this.memoryCache.get(key);
    if (!item) return null;
    if (item.expiresAt <= Date.now()) {
      this.memoryCache.delete(key);
      return null;
    }
    return item.value as T;
  }

  async set(key: string, value: unknown, ttlSeconds = 300): Promise<void> {
    if (this.redisClient && this.redisClient.status === 'ready') {
      try {
        await this.redisClient.set(key, JSON.stringify(value), 'EX', ttlSeconds);
        return;
      } catch {
        // Fall back to memory cache
      }
    }

    this.memoryCache.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  async delete(key: string): Promise<void> {
    if (this.redisClient && this.redisClient.status === 'ready') {
      try {
        await this.redisClient.del(key);
      } catch {
        // Ignore
      }
    }
    this.memoryCache.delete(key);
  }

  /**
   * Distributed sliding-window or fixed-window rate limit increment.
   */
  async incrementRateLimit(
    key: string,
    windowSeconds: number,
  ): Promise<{ current: number; ttl: number }> {
    if (this.redisClient && this.redisClient.status === 'ready') {
      try {
        const multi = this.redisClient.multi();
        multi.incr(key);
        multi.expire(key, windowSeconds, 'NX');
        multi.ttl(key);
        const results = await multi.exec();
        const current = (results?.[0]?.[1] as number) ?? 1;
        const ttl = (results?.[2]?.[1] as number) ?? windowSeconds;
        return { current, ttl: ttl > 0 ? ttl : windowSeconds };
      } catch {
        // Fall back to memory
      }
    }

    const now = Date.now();
    const item = this.memoryCache.get(key);
    if (!item || item.expiresAt <= now) {
      this.memoryCache.set(key, { value: 1, expiresAt: now + windowSeconds * 1000 });
      return { current: 1, ttl: windowSeconds };
    }

    const count = (item.value as number) + 1;
    item.value = count;
    const remainingTtl = Math.max(1, Math.round((item.expiresAt - now) / 1000));
    return { current: count, ttl: remainingTtl };
  }
}
