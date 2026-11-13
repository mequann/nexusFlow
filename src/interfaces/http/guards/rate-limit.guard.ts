import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { DomainError } from '../../../domain/errors.js';
import { CacheService } from '../../../infrastructure/resilience/cache-service.js';

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly windowSeconds = 60;
  private readonly maxRequests = 300;

  constructor(@Inject(CacheService) private readonly cache: CacheService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    if (req.path === '/healthz' || req.path === '/readyz' || req.path === '/metrics') {
      return true;
    }

    const ip = req.ip || 'unknown';
    const key = `ratelimit:${ip}`;

    const { current, ttl } = await this.cache.incrementRateLimit(key, this.windowSeconds);

    res.setHeader('x-ratelimit-limit', String(this.maxRequests));
    res.setHeader('x-ratelimit-remaining', String(Math.max(0, this.maxRequests - current)));
    res.setHeader('x-ratelimit-reset', String(ttl));

    if (current > this.maxRequests) {
      throw new DomainError('RATE_LIMIT_EXCEEDED', 'Too many requests; retry later', 429);
    }

    return true;
  }
}

