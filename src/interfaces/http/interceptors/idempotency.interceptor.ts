import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, from, of, switchMap, tap } from 'rxjs';
import { UNIT_OF_WORK } from '../../../application/tokens.js';
import { ConflictError } from '../../../domain/errors.js';
import type { IUnitOfWork } from '../../../domain/ports/repositories.js';
import { sha256Hex } from '../../../infrastructure/security/password.js';

/**
 * NestJS Interceptor implementing safe Idempotency-Key deduplication for mutating endpoints.
 * Replays identical responses and rejects mismatched payloads with 409 Conflict.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(@Inject(UNIT_OF_WORK) private readonly uow: IUnitOfWork) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const rawKey = req.headers['idempotency-key'];

    if (typeof rawKey !== 'string' || !rawKey.trim()) {
      return next.handle();
    }

    const key = rawKey.trim();
    const scope = `${req.method}:${req.path}`;
    const requestHash = sha256Hex(JSON.stringify(req.body ?? {}));
    const now = new Date();

    return from(this.uow.repos.idempotency.find(key, scope, now)).pipe(
      switchMap((existing) => {
        if (existing) {
          if (existing.requestHash !== requestHash) {
            throw new ConflictError(
              'Idempotency-Key was already used with a different request payload',
            );
          }
          res.status(existing.statusCode);
          res.setHeader('x-idempotency-replayed', 'true');
          return of(existing.responseBody);
        }

        return next.handle().pipe(
          tap((body) => {
            void this.uow.repos.idempotency.save({
              key,
              scope,
              requestHash,
              statusCode: res.statusCode || 200,
              responseBody: body,
              createdAt: now,
              expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
            });
          }),
        );
      }),
    );
  }
}

