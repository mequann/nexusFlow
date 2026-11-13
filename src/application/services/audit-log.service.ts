import crypto from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { APP_LOGGER, UNIT_OF_WORK } from '../tokens.js';
import type { IUnitOfWork, AuditLogEntry } from '../../domain/ports/repositories.js';
import type { ILogger, LogEntry } from '../../domain/ports/telemetry.js';

export interface RecordAuditInput {
  tenantId?: string;
  userId?: string | null;
  userEmail?: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  details?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface QueryAuditInput {
  tenantId?: string;
  action?: string;
  userId?: string;
  resourceType?: string;
  limit?: number;
}

@Injectable()
export class AuditLogService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: IUnitOfWork,
    @Inject(APP_LOGGER) private readonly logger: ILogger,
  ) {}

  async log(input: RecordAuditInput): Promise<AuditLogEntry> {
    const entry: AuditLogEntry = {
      id: crypto.randomUUID(),
      tenantId: input.tenantId ?? 'default',
      userId: input.userId ?? null,
      userEmail: input.userEmail ?? null,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      details: input.details ?? {},
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      timestamp: new Date(),
    };

    const saved = await this.uow.repos.auditLogs.append(entry);

    this.logger.info(`Audit: [${entry.action}] on ${entry.resourceType}:${entry.resourceId}`, {
      auditId: entry.id,
      tenantId: entry.tenantId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      actor: entry.userEmail ?? entry.userId ?? 'system',
    });

    return saved;
  }

  async query(filters?: QueryAuditInput): Promise<AuditLogEntry[]> {
    return this.uow.repos.auditLogs.list(filters);
  }

  getSystemLogs(limit = 100, minLevel?: string): LogEntry[] {
    if (this.logger.getRecentLogs) {
      return this.logger.getRecentLogs(limit, minLevel);
    }
    return [];
  }

  async getInstanceExecutionLogs(instanceId: string): Promise<Array<{
    stepId: string;
    nodeId: string;
    nodeName: string;
    nodeType: string;
    status: string;
    attempt: number;
    startedAt: Date;
    finishedAt: Date | null;
    durationMs: number | null;
    input: Record<string, unknown>;
    output: Record<string, unknown> | null;
    errorMessage: string | null;
  }>> {
    const steps = await this.uow.repos.steps.findByInstance(instanceId);
    return steps.map((s) => ({
      stepId: s.id,
      nodeId: s.nodeId,
      nodeName: s.nodeName,
      nodeType: s.nodeType,
      status: s.status,
      attempt: s.attempt,
      startedAt: s.startedAt,
      finishedAt: s.finishedAt,
      durationMs: s.durationMs,
      input: s.input,
      output: s.output,
      errorMessage: s.errorMessage,
    }));
  }
}
