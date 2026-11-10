import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { DomainError } from '../../../domain/errors.js';

interface Bucket {
  count: number;
  resetAt: number;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, Bucket>();
  private readonly windowMs = 60_000;
  private readonly maxRequests = 300;

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    if (req.path === '/healthz' || req.path === '/readyz' || req.path === '/metrics') {
      return true;
    }

    const ip = req.ip || 'unknown';
    const now = Date.now();
    let bucket = this.buckets.get(ip);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(ip, bucket);
    }

    bucket.count += 1;
    res.setHeader('x-ratelimit-limit', String(this.maxRequests));
    res.setHeader('x-ratelimit-remaining', String(Math.max(0, this.maxRequests - bucket.count)));

    if (bucket.count > this.maxRequests) {
      throw new DomainError('RATE_LIMIT_EXCEEDED', 'Too many requests; retry later', 429);
    }

    return true;
  }
}

