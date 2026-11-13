import crypto from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import cronParser from 'cron-parser';
import { ConflictError, NotFoundError, ValidationError } from '../../domain/errors.js';
import type { IUnitOfWork } from '../../domain/ports/repositories.js';
import type {
  WorkflowDefinitionRecord,
  WorkflowGraphDefinition,
  WorkflowStatus,
} from '../../domain/workflow/types.js';
import { validateWorkflowGraph } from '../../domain/workflow/validator.js';
import { sha256Hex } from '../../infrastructure/security/password.js';
import { UNIT_OF_WORK } from '../tokens.js';

export interface CreateWorkflowInput {
  tenantId?: string;
  key: string;
  name: string;
  description?: string;
  definition: WorkflowGraphDefinition;
  webhookSecret?: string;
  createdBy: string | null;
}

@Injectable()
export class WorkflowService {
  constructor(@Inject(UNIT_OF_WORK) private readonly uow: IUnitOfWork) {}

  async createWorkflow(input: CreateWorkflowInput): Promise<WorkflowDefinitionRecord> {
    validateWorkflowGraph(input.definition);

    const { webhookPath, cronExpression, cronNextRunAt } = this.extractTriggerMetadata(
      input.definition,
    );

    const tenantId = input.tenantId ?? 'default';
    const now = new Date();
    const version = await this.uow.repos.workflows.getNextVersion(input.key, tenantId);

    const record: WorkflowDefinitionRecord = {
      id: crypto.randomUUID(),
      tenantId,
      key: input.key,
      name: input.name,
      description: input.description ?? '',
      version,
      status: 'DRAFT',
      definition: input.definition,
      webhookPath,
      webhookSecretHash: input.webhookSecret ? sha256Hex(input.webhookSecret) : null,
      cronExpression,
      cronNextRunAt,
      createdBy:
        typeof input.createdBy === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.createdBy)
          ? input.createdBy
          : null,
      createdAt: now,
      updatedAt: now,
    };

    return this.uow.repos.workflows.create(record);
  }

  async updateDraft(
    id: string,
    patch: {
      name?: string;
      description?: string;
      definition?: WorkflowGraphDefinition;
      webhookSecret?: string;
    },
  ): Promise<WorkflowDefinitionRecord> {
    const existing = await this.uow.repos.workflows.findById(id);
    if (!existing) throw new NotFoundError('Workflow', id);
    if (existing.status !== 'DRAFT') {
      throw new ConflictError('Only DRAFT workflows can be mutated; create a new version instead');
    }

    const definition = patch.definition ?? existing.definition;
    if (patch.definition) {
      validateWorkflowGraph(definition);
    }
    const { webhookPath, cronExpression, cronNextRunAt } =
      this.extractTriggerMetadata(definition);

    const updated: WorkflowDefinitionRecord = {
      ...existing,
      name: patch.name ?? existing.name,
      description: patch.description ?? existing.description,
      definition,
      webhookPath,
      webhookSecretHash: patch.webhookSecret
        ? sha256Hex(patch.webhookSecret)
        : existing.webhookSecretHash,
      cronExpression,
      cronNextRunAt,
      updatedAt: new Date(),
    };

    return this.uow.repos.workflows.update(updated);
  }

  async publishWorkflow(id: string): Promise<WorkflowDefinitionRecord> {
    return this.uow.runInTransaction(async (repos) => {
      const target = await repos.workflows.findById(id);
      if (!target) throw new NotFoundError('Workflow', id);
      if (target.status === 'ARCHIVED') {
        throw new ConflictError('Cannot publish an ARCHIVED workflow');
      }

      validateWorkflowGraph(target.definition);

      // Archive previously published versions of the same key in this tenant
      const existingAll = await repos.workflows.list({
        key: target.key,
        status: 'PUBLISHED',
        tenantId: target.tenantId,
      });
      for (const prev of existingAll) {
        if (prev.id !== target.id) {
          await repos.workflows.update({
            ...prev,
            status: 'ARCHIVED',
            updatedAt: new Date(),
          });
        }
      }

      const { webhookPath, cronExpression, cronNextRunAt } = this.extractTriggerMetadata(
        target.definition,
      );

      return repos.workflows.update({
        ...target,
        status: 'PUBLISHED',
        webhookPath,
        cronExpression,
        cronNextRunAt,
        updatedAt: new Date(),
      });
    });
  }

  async getById(id: string): Promise<WorkflowDefinitionRecord> {
    const found = await this.uow.repos.workflows.findById(id);
    if (!found) throw new NotFoundError('Workflow', id);
    return found;
  }

  async list(filters?: {
    status?: WorkflowStatus;
    key?: string;
    tenantId?: string;
  }): Promise<WorkflowDefinitionRecord[]> {
    return this.uow.repos.workflows.list(filters);
  }

  private extractTriggerMetadata(definition: WorkflowGraphDefinition): {
    webhookPath: string | null;
    cronExpression: string | null;
    cronNextRunAt: Date | null;
  } {
    const trigger = definition.nodes.find((n) => n.type.startsWith('trigger.'));
    if (!trigger) {
      return { webhookPath: null, cronExpression: null, cronNextRunAt: null };
    }

    if (trigger.type === 'trigger.webhook') {
      const path = trigger.config.path;
      if (typeof path !== 'string' || !path.trim()) {
        throw new ValidationError('trigger.webhook node requires a non-empty config.path');
      }
      return {
        webhookPath: path.replace(/^\/+/, ''),
        cronExpression: null,
        cronNextRunAt: null,
      };
    }

    if (trigger.type === 'trigger.cron') {
      const expr = trigger.config.expression;
      if (typeof expr !== 'string' || !expr.trim()) {
        throw new ValidationError('trigger.cron node requires config.expression');
      }
      try {
        const interval = cronParser.parseExpression(expr);
        return {
          webhookPath: null,
          cronExpression: expr,
          cronNextRunAt: interval.next().toDate(),
        };
      } catch {
        throw new ValidationError(`Invalid cron expression '${expr}'`);
      }
    }

    return { webhookPath: null, cronExpression: null, cronNextRunAt: null };
  }
}

