import pino from 'pino';
import type { ILogger } from '../../domain/ports/telemetry.js';
import { getContext } from './context.js';

export class PinoLogger implements ILogger {
  private readonly logger: pino.Logger;

  constructor(level = 'info', service = 'nexusflow') {
    this.logger = pino({
      level,
      base: { service },
      redact: {
        paths: [
          'password',
          'passwordHash',
          'token',
          'secret',
          'authorization',
          '*.password',
          '*.secret',
          '*.apiKey',
          '*.token',
        ],
        censor: '[REDACTED]',
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    });
  }

  private withCtx(meta?: Record<string, unknown>): Record<string, unknown> {
    const ctx = getContext();
    if (!ctx) return meta ?? {};
    return {
      correlationId: ctx.correlationId,
      traceId: ctx.traceId,
      ...(ctx.userId ? { userId: ctx.userId } : {}),
      ...meta,
    };
  }

  info(msg: string, meta?: Record<string, unknown>): void {
    this.logger.info(this.withCtx(meta), msg);
  }

  warn(msg: string, meta?: Record<string, unknown>): void {
    this.logger.warn(this.withCtx(meta), msg);
  }

  error(msg: string, meta?: Record<string, unknown>): void {
    this.logger.error(this.withCtx(meta), msg);
  }

  debug(msg: string, meta?: Record<string, unknown>): void {
    this.logger.debug(this.withCtx(meta), msg);
  }
}
