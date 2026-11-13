import pino from 'pino';
import type { ILogger, LogEntry } from '../../domain/ports/telemetry.js';
import { getContext } from './context.js';

export class PinoLogger implements ILogger {
  private readonly logger: pino.Logger;
  private readonly ringBuffer: LogEntry[] = [];
  private readonly maxBufferSize = 1000;

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

  private pushBuffer(level: 'info' | 'warn' | 'error' | 'debug', message: string, meta?: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      meta,
    };
    this.ringBuffer.unshift(entry);
    if (this.ringBuffer.length > this.maxBufferSize) {
      this.ringBuffer.pop();
    }
  }

  info(msg: string, meta?: Record<string, unknown>): void {
    const enriched = this.withCtx(meta);
    this.logger.info(enriched, msg);
    this.pushBuffer('info', msg, enriched);
  }

  warn(msg: string, meta?: Record<string, unknown>): void {
    const enriched = this.withCtx(meta);
    this.logger.warn(enriched, msg);
    this.pushBuffer('warn', msg, enriched);
  }

  error(msg: string, meta?: Record<string, unknown>): void {
    const enriched = this.withCtx(meta);
    this.logger.error(enriched, msg);
    this.pushBuffer('error', msg, enriched);
  }

  debug(msg: string, meta?: Record<string, unknown>): void {
    const enriched = this.withCtx(meta);
    this.logger.debug(enriched, msg);
    this.pushBuffer('debug', msg, enriched);
  }

  getRecentLogs(limit = 100, minLevel?: string): LogEntry[] {
    const levelSeverity: Record<string, number> = {
      debug: 1,
      info: 2,
      warn: 3,
      error: 4,
    };
    const targetSeverity = minLevel ? levelSeverity[minLevel.toLowerCase()] ?? 1 : 1;

    return this.ringBuffer
      .filter((entry) => (levelSeverity[entry.level] ?? 1) >= targetSeverity)
      .slice(0, limit);
  }
}
