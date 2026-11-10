import crypto from 'node:crypto';
import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { APP_LOGGER, APP_METRICS } from '../../../application/tokens.js';
import type { ILogger, IMetrics } from '../../../domain/ports/telemetry.js';
import { runWithContext } from '../../../infrastructure/observability/context.js';

@Injectable()
export class CorrelationMetricsInterceptor implements NestInterceptor {
  constructor(
    @Inject(APP_LOGGER) private readonly logger: ILogger,
    @Inject(APP_METRICS) private readonly metrics: IMetrics,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    const headerCid = req.headers['x-correlation-id'];
    const correlationId =
      typeof headerCid === 'string' && headerCid.trim()
        ? headerCid.trim()
        : crypto.randomUUID();
    const traceId = crypto.randomUUID().replace(/-/g, '');
    const startedAt = Date.now();

    res.setHeader('x-correlation-id', correlationId);
    res.setHeader('x-trace-id', traceId);

    return runWithContext({ correlationId, traceId }, () =>
      next.handle().pipe(
        tap({
          next: () => {
            const durationMs = Date.now() - startedAt;
            const route = (req.route as { path?: string } | undefined)?.path ?? req.path;
            this.metrics.recordHttpRequest(req.method, route, res.statusCode, durationMs);
            if (req.path !== '/metrics' && req.path !== '/healthz') {
              this.logger.info('HTTP request completed', {
                method: req.method,
                path: req.path,
                statusCode: res.statusCode,
                durationMs,
              });
            }
          },
          error: () => {
            const durationMs = Date.now() - startedAt;
            const route = (req.route as { path?: string } | undefined)?.path ?? req.path;
            this.metrics.recordHttpRequest(req.method, route, res.statusCode || 500, durationMs);
          },
        }),
      ),
    );
  }
}

