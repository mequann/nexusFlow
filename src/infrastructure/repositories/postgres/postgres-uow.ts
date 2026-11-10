import {
  and,
  asc,
  count as drizzleCount,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import { type NodePgDatabase, drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import { ConflictError, NotFoundError } from '../../../domain/errors.js';
import type {
  CaseComment,
  EventSubscription,
  ExecutionJob,
  ExecutionToken,
  Incident,
  OutboxEvent,
  StepExecution,
  UserTask,
  WorkflowInstance,
} from '../../../domain/execution/types.js';
import type {
  ICaseCommentRepository,
  ICredentialRepository,
  IIdempotencyRepository,
  IIncidentRepository,
  IInstanceRepository,
  IJobRepository,
  IOutboxRepository,
  IRepositoryRegistry,
  IStepRepository,
  ISubscriptionRepository,
  ITokenRepository,
  IUnitOfWork,
  IUserRepository,
  IUserTaskRepository,
  IWorkflowRepository,
} from '../../../domain/ports/repositories.js';
import type { CredentialRecord, Role } from '../../../domain/security/types.js';
import type { WorkflowDefinitionRecord, WorkflowStatus } from '../../../domain/workflow/types.js';
import * as schema from '../../db/schema.js';

type DrizzleDb = NodePgDatabase<typeof schema>;

function buildDrizzleRegistry(db: DrizzleDb): IRepositoryRegistry {
  const workflows: IWorkflowRepository = {
    create: async (record) => {
      try {
        const [inserted] = await db
          .insert(schema.workflows)
          .values({
            id: record.id,
            key: record.key,
            name: record.name,
            description: record.description,
            version: record.version,
            status: record.status,
            definition: record.definition,
            webhookPath: record.webhookPath,
            webhookSecretHash: record.webhookSecretHash,
            cronExpression: record.cronExpression,
            cronNextRunAt: record.cronNextRunAt,
            createdBy: record.createdBy,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
          })
          .returning();
        return toWorkflowRecord(inserted!);
      } catch (err: unknown) {
        if ((err as { code?: string }).code === '23505') {
          throw new ConflictError(`Workflow '${record.key}' v${record.version} already exists`);
        }
        throw err;
      }
    },
    findById: async (id) => {
      const [row] = await db.select().from(schema.workflows).where(eq(schema.workflows.id, id));
      return row ? toWorkflowRecord(row) : null;
    },
    findLatestByKey: async (key, status) => {
      const cond = status
        ? and(eq(schema.workflows.key, key), eq(schema.workflows.status, status))
        : eq(schema.workflows.key, key);
      const [row] = await db
        .select()
        .from(schema.workflows)
        .where(cond)
        .orderBy(desc(schema.workflows.version))
        .limit(1);
      return row ? toWorkflowRecord(row) : null;
    },
    findByKeyAndVersion: async (key, version) => {
      const [row] = await db
        .select()
        .from(schema.workflows)
        .where(and(eq(schema.workflows.key, key), eq(schema.workflows.version, version)));
      return row ? toWorkflowRecord(row) : null;
    },
    findByWebhookPath: async (webhookPath) => {
      const [row] = await db
        .select()
        .from(schema.workflows)
        .where(
          and(
            eq(schema.workflows.status, 'PUBLISHED'),
            eq(schema.workflows.webhookPath, webhookPath),
          ),
        )
        .orderBy(desc(schema.workflows.version))
        .limit(1);
      return row ? toWorkflowRecord(row) : null;
    },
    findDueCronWorkflows: async (now) => {
      const rows = await db
        .select()
        .from(schema.workflows)
        .where(
          and(
            eq(schema.workflows.status, 'PUBLISHED'),
            isNotNull(schema.workflows.cronExpression),
            lte(schema.workflows.cronNextRunAt, now),
          ),
        );
      return rows.map(toWorkflowRecord);
    },
    list: async (filters) => {
      const conditions = [];
      if (filters?.status) conditions.push(eq(schema.workflows.status, filters.status));
      if (filters?.key) conditions.push(eq(schema.workflows.key, filters.key));
      const rows = await db
        .select()
        .from(schema.workflows)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(schema.workflows.updatedAt));
      return rows.map(toWorkflowRecord);
    },
    update: async (record) => {
      const [updated] = await db
        .update(schema.workflows)
        .set({
          name: record.name,
          description: record.description,
          status: record.status,
          definition: record.definition,
          webhookPath: record.webhookPath,
          webhookSecretHash: record.webhookSecretHash,
          cronExpression: record.cronExpression,
          cronNextRunAt: record.cronNextRunAt,
          updatedAt: record.updatedAt,
        })
        .where(eq(schema.workflows.id, record.id))
        .returning();
      if (!updated) throw new NotFoundError('Workflow', record.id);
      return toWorkflowRecord(updated);
    },
    getNextVersion: async (key) => {
      const [row] = await db
        .select({ maxVer: sql<number | null>`MAX(${schema.workflows.version})` })
        .from(schema.workflows)
        .where(eq(schema.workflows.key, key));
      return Number(row?.maxVer ?? 0) + 1;
    },
  };

  const instances: IInstanceRepository = {
    create: async (inst) => {
      const [row] = await db
        .insert(schema.workflowInstances)
        .values({
          id: inst.id,
          workflowId: inst.workflowId,
          workflowKey: inst.workflowKey,
          workflowVersion: inst.workflowVersion,
          status: inst.status,
          currentStage: inst.currentStage,
          slaStatus: inst.slaStatus,
          triggerType: inst.triggerType,
          triggerPayload: inst.triggerPayload,
          variables: inst.variables,
          correlationKey: inst.correlationKey,
          startedBy: inst.startedBy,
          occVersion: inst.occVersion,
          startedAt: inst.startedAt,
          completedAt: inst.completedAt,
          updatedAt: inst.updatedAt,
        })
        .returning();
      return toInstanceRecord(row!);
    },
    findById: async (id) => {
      const [row] = await db
        .select()
        .from(schema.workflowInstances)
        .where(eq(schema.workflowInstances.id, id));
      return row ? toInstanceRecord(row) : null;
    },
    list: async (filters) => {
      const conditions = [];
      if (filters?.status) conditions.push(eq(schema.workflowInstances.status, filters.status));
      if (filters?.workflowKey) {
        conditions.push(eq(schema.workflowInstances.workflowKey, filters.workflowKey));
      }
      const rows = await db
        .select()
        .from(schema.workflowInstances)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(schema.workflowInstances.startedAt))
        .limit(filters?.limit ?? 100);
      return rows.map(toInstanceRecord);
    },
    updateWithOcc: async (inst) => {
      const [updated] = await db
        .update(schema.workflowInstances)
        .set({
          status: inst.status,
          currentStage: inst.currentStage,
          slaStatus: inst.slaStatus,
          variables: inst.variables,
          completedAt: inst.completedAt,
          occVersion: sql`${schema.workflowInstances.occVersion} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.workflowInstances.id, inst.id),
            eq(schema.workflowInstances.occVersion, inst.occVersion),
          ),
        )
        .returning();
      if (!updated) {
        throw new ConflictError(`Optimistic concurrency conflict or missing instance '${inst.id}'`);
      }
      return toInstanceRecord(updated);
    },
  };

  const tokens: ITokenRepository = {
    create: async (token) => {
      const [row] = await db
        .insert(schema.executionTokens)
        .values({
          id: token.id,
          instanceId: token.instanceId,
          currentNodeId: token.currentNodeId,
          parentTokenId: token.parentTokenId,
          joinGroupId: token.joinGroupId,
          status: token.status,
          createdAt: token.createdAt,
          updatedAt: token.updatedAt,
        })
        .returning();
      return toTokenRecord(row!);
    },
    findById: async (id) => {
      const [row] = await db
        .select()
        .from(schema.executionTokens)
        .where(eq(schema.executionTokens.id, id));
      return row ? toTokenRecord(row) : null;
    },
    findByInstance: async (instanceId) => {
      const rows = await db
        .select()
        .from(schema.executionTokens)
        .where(eq(schema.executionTokens.instanceId, instanceId))
        .orderBy(asc(schema.executionTokens.createdAt));
      return rows.map(toTokenRecord);
    },
    findWaitingAtNode: async (instanceId, nodeId) => {
      const rows = await db
        .select()
        .from(schema.executionTokens)
        .where(
          and(
            eq(schema.executionTokens.instanceId, instanceId),
            eq(schema.executionTokens.currentNodeId, nodeId),
            eq(schema.executionTokens.status, 'WAITING'),
          ),
        );
      return rows.map(toTokenRecord);
    },
    update: async (token) => {
      const [updated] = await db
        .update(schema.executionTokens)
        .set({
          currentNodeId: token.currentNodeId,
          status: token.status,
          updatedAt: new Date(),
        })
        .where(eq(schema.executionTokens.id, token.id))
        .returning();
      if (!updated) throw new NotFoundError('ExecutionToken', token.id);
      return toTokenRecord(updated);
    },
  };

  const steps: IStepRepository = {
    create: async (step) => {
      const [row] = await db
        .insert(schema.stepExecutions)
        .values({
          id: step.id,
          instanceId: step.instanceId,
          tokenId: step.tokenId,
          nodeId: step.nodeId,
          nodeType: step.nodeType,
          nodeName: step.nodeName,
          status: step.status,
          attempt: step.attempt,
          input: step.input,
          output: step.output,
          errorMessage: step.errorMessage,
          compensateNodeId: step.compensateNodeId,
          startedAt: step.startedAt,
          finishedAt: step.finishedAt,
          durationMs: step.durationMs,
        })
        .returning();
      return toStepRecord(row!);
    },
    findById: async (id) => {
      const [row] = await db
        .select()
        .from(schema.stepExecutions)
        .where(eq(schema.stepExecutions.id, id));
      return row ? toStepRecord(row) : null;
    },
    findByInstance: async (instanceId) => {
      const rows = await db
        .select()
        .from(schema.stepExecutions)
        .where(eq(schema.stepExecutions.instanceId, instanceId))
        .orderBy(asc(schema.stepExecutions.startedAt));
      return rows.map(toStepRecord);
    },
    update: async (step) => {
      const [updated] = await db
        .update(schema.stepExecutions)
        .set({
          status: step.status,
          output: step.output,
          errorMessage: step.errorMessage,
          finishedAt: step.finishedAt,
          durationMs: step.durationMs,
        })
        .where(eq(schema.stepExecutions.id, step.id))
        .returning();
      if (!updated) throw new NotFoundError('StepExecution', step.id);
      return toStepRecord(updated);
    },
  };

  const userTasks: IUserTaskRepository = {
    create: async (t) => {
      const [row] = await db
        .insert(schema.userTasks)
        .values({
          id: t.id,
          instanceId: t.instanceId,
          tokenId: t.tokenId,
          nodeId: t.nodeId,
          title: t.title,
          description: t.description,
          stage: t.stage,
          candidateGroup: t.candidateGroup,
          assignee: t.assignee,
          delegatedFrom: t.delegatedFrom,
          status: t.status,
          formSchema: t.formSchema,
          payload: t.payload,
          resolution: t.resolution,
          requiredApprovals: t.requiredApprovals,
          approvalsReceived: t.approvalsReceived,
          dueAt: t.dueAt,
          slaBreached: t.slaBreached,
          escalateTo: t.escalateTo,
          escalationLevel: t.escalationLevel,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
          completedAt: t.completedAt,
        })
        .returning();
      return toTaskRecord(row!);
    },
    findById: async (id) => {
      const [row] = await db.select().from(schema.userTasks).where(eq(schema.userTasks.id, id));
      return row ? toTaskRecord(row) : null;
    },
    list: async (filters) => {
      const conditions = [];
      if (filters?.status) conditions.push(eq(schema.userTasks.status, filters.status));
      if (filters?.assignee) conditions.push(eq(schema.userTasks.assignee, filters.assignee));
      if (filters?.candidateGroup) {
        conditions.push(eq(schema.userTasks.candidateGroup, filters.candidateGroup));
      }
      if (filters?.instanceId) conditions.push(eq(schema.userTasks.instanceId, filters.instanceId));
      const rows = await db
        .select()
        .from(schema.userTasks)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(schema.userTasks.createdAt));
      return rows.map(toTaskRecord);
    },
    findOverdueTasks: async (now, limit = 50) => {
      const rows = await db
        .select()
        .from(schema.userTasks)
        .where(
          and(
            inArray(schema.userTasks.status, ['OPEN', 'CLAIMED']),
            eq(schema.userTasks.slaBreached, false),
            isNotNull(schema.userTasks.dueAt),
            lte(schema.userTasks.dueAt, now),
          ),
        )
        .orderBy(asc(schema.userTasks.dueAt))
        .limit(limit);
      return rows.map(toTaskRecord);
    },
    update: async (t) => {
      const [updated] = await db
        .update(schema.userTasks)
        .set({
          assignee: t.assignee,
          delegatedFrom: t.delegatedFrom,
          status: t.status,
          resolution: t.resolution,
          approvalsReceived: t.approvalsReceived,
          slaBreached: t.slaBreached,
          escalateTo: t.escalateTo,
          escalationLevel: t.escalationLevel,
          completedAt: t.completedAt,
          updatedAt: new Date(),
        })
        .where(eq(schema.userTasks.id, t.id))
        .returning();
      if (!updated) throw new NotFoundError('UserTask', t.id);
      return toTaskRecord(updated);
    },
  };

  const caseComments: ICaseCommentRepository = {
    create: async (comment) => {
      const [row] = await db
        .insert(schema.caseComments)
        .values({
          id: comment.id,
          instanceId: comment.instanceId,
          authorId: comment.authorId,
          authorEmail: comment.authorEmail,
          body: comment.body,
          createdAt: comment.createdAt,
        })
        .returning();
      return row!;
    },
    findByInstance: async (instanceId) => {
      return db
        .select()
        .from(schema.caseComments)
        .where(eq(schema.caseComments.instanceId, instanceId))
        .orderBy(asc(schema.caseComments.createdAt));
    },
  };

  const subscriptions: ISubscriptionRepository = {
    create: async (s) => {
      const [row] = await db
        .insert(schema.eventSubscriptions)
        .values({
          id: s.id,
          instanceId: s.instanceId,
          tokenId: s.tokenId,
          nodeId: s.nodeId,
          type: s.type,
          messageName: s.messageName,
          correlationKey: s.correlationKey,
          triggerAt: s.triggerAt,
          status: s.status,
          payload: s.payload,
          createdAt: s.createdAt,
          triggeredAt: s.triggeredAt,
        })
        .returning();
      return toSubscriptionRecord(row!);
    },
    findActiveMessage: async (messageName, correlationKey) => {
      const rows = await db
        .select()
        .from(schema.eventSubscriptions)
        .where(
          and(
            eq(schema.eventSubscriptions.status, 'ACTIVE'),
            eq(schema.eventSubscriptions.type, 'MESSAGE'),
            eq(schema.eventSubscriptions.messageName, messageName),
            or(
              eq(schema.eventSubscriptions.correlationKey, correlationKey),
              isNull(schema.eventSubscriptions.correlationKey),
            ),
          ),
        );
      return rows.map(toSubscriptionRecord);
    },
    findDueTimers: async (now, limit = 50) => {
      const rows = await db
        .select()
        .from(schema.eventSubscriptions)
        .where(
          and(
            eq(schema.eventSubscriptions.status, 'ACTIVE'),
            eq(schema.eventSubscriptions.type, 'TIMER'),
            lte(schema.eventSubscriptions.triggerAt, now),
          ),
        )
        .orderBy(asc(schema.eventSubscriptions.triggerAt))
        .limit(limit);
      return rows.map(toSubscriptionRecord);
    },
    findByInstance: async (instanceId) => {
      const rows = await db
        .select()
        .from(schema.eventSubscriptions)
        .where(eq(schema.eventSubscriptions.instanceId, instanceId));
      return rows.map(toSubscriptionRecord);
    },
    update: async (s) => {
      const [updated] = await db
        .update(schema.eventSubscriptions)
        .set({
          status: s.status,
          payload: s.payload,
          triggeredAt: s.triggeredAt,
        })
        .where(eq(schema.eventSubscriptions.id, s.id))
        .returning();
      if (!updated) throw new NotFoundError('EventSubscription', s.id);
      return toSubscriptionRecord(updated);
    },
  };

  const incidents: IIncidentRepository = {
    create: async (inc) => {
      const [row] = await db
        .insert(schema.incidents)
        .values({
          id: inc.id,
          instanceId: inc.instanceId,
          tokenId: inc.tokenId,
          stepExecutionId: inc.stepExecutionId,
          nodeId: inc.nodeId,
          incidentType: inc.incidentType,
          message: inc.message,
          stackTrace: inc.stackTrace,
          payloadSnapshot: inc.payloadSnapshot,
          status: inc.status,
          resolvedBy: inc.resolvedBy,
          resolutionNote: inc.resolutionNote,
          createdAt: inc.createdAt,
          resolvedAt: inc.resolvedAt,
        })
        .returning();
      return toIncidentRecord(row!);
    },
    findById: async (id) => {
      const [row] = await db.select().from(schema.incidents).where(eq(schema.incidents.id, id));
      return row ? toIncidentRecord(row) : null;
    },
    list: async (filters) => {
      const conditions = [];
      if (filters?.status) conditions.push(eq(schema.incidents.status, filters.status));
      if (filters?.instanceId) conditions.push(eq(schema.incidents.instanceId, filters.instanceId));
      const rows = await db
        .select()
        .from(schema.incidents)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(schema.incidents.createdAt));
      return rows.map(toIncidentRecord);
    },
    update: async (inc) => {
      const [updated] = await db
        .update(schema.incidents)
        .set({
          status: inc.status,
          resolvedBy: inc.resolvedBy,
          resolutionNote: inc.resolutionNote,
          resolvedAt: inc.resolvedAt,
        })
        .where(eq(schema.incidents.id, inc.id))
        .returning();
      if (!updated) throw new NotFoundError('Incident', inc.id);
      return toIncidentRecord(updated);
    },
  };

  const jobs: IJobRepository = {
    enqueue: async (job) => {
      const [row] = await db
        .insert(schema.executionJobs)
        .values({
          id: job.id,
          instanceId: job.instanceId,
          tokenId: job.tokenId,
          nodeId: job.nodeId,
          jobType: job.jobType,
          payload: job.payload,
          status: job.status,
          attempts: job.attempts,
          maxAttempts: job.maxAttempts,
          availableAt: job.availableAt,
          lockedBy: job.lockedBy,
          lockedAt: job.lockedAt,
          lastError: job.lastError,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
        })
        .returning();
      return toJobRecord(row!);
    },
    claimNextBatch: async (workerId, limit, now) => {
      return db.transaction(async (tx) => {
        const candidates = await tx
          .select({ id: schema.executionJobs.id })
          .from(schema.executionJobs)
          .where(
            and(
              eq(schema.executionJobs.status, 'PENDING'),
              lte(schema.executionJobs.availableAt, now),
            ),
          )
          .orderBy(asc(schema.executionJobs.availableAt))
          .limit(limit)
          .for('update', { skipLocked: true });

        if (candidates.length === 0) return [];

        const ids = candidates.map((c) => c.id);
        const claimed = await tx
          .update(schema.executionJobs)
          .set({
            status: 'PROCESSING',
            lockedBy: workerId,
            lockedAt: now,
            updatedAt: now,
          })
          .where(inArray(schema.executionJobs.id, ids))
          .returning();

        return claimed.map(toJobRecord);
      });
    },
    complete: async (jobId) => {
      await db
        .update(schema.executionJobs)
        .set({ status: 'COMPLETED', updatedAt: new Date() })
        .where(eq(schema.executionJobs.id, jobId));
    },
    reschedule: async (jobId, availableAt, attempts, lastError) => {
      await db
        .update(schema.executionJobs)
        .set({
          status: 'PENDING',
          availableAt,
          attempts,
          lastError,
          lockedBy: null,
          lockedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.executionJobs.id, jobId));
    },
    markDead: async (jobId, attempts, lastError) => {
      await db
        .update(schema.executionJobs)
        .set({
          status: 'DEAD',
          attempts,
          lastError,
          updatedAt: new Date(),
        })
        .where(eq(schema.executionJobs.id, jobId));
    },
  };

  const outbox: IOutboxRepository = {
    append: async (event) => {
      const [row] = await db
        .insert(schema.outboxEvents)
        .values({
          id: event.id,
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          eventType: event.eventType,
          payload: event.payload,
          status: event.status,
          attempts: event.attempts,
          createdAt: event.createdAt,
          publishedAt: event.publishedAt,
        })
        .returning();
      return toOutboxRecord(row!);
    },
    fetchPending: async (limit) => {
      const rows = await db
        .select()
        .from(schema.outboxEvents)
        .where(eq(schema.outboxEvents.status, 'PENDING'))
        .orderBy(asc(schema.outboxEvents.createdAt))
        .limit(limit);
      return rows.map(toOutboxRecord);
    },
    markPublished: async (id, publishedAt) => {
      await db
        .update(schema.outboxEvents)
        .set({ status: 'PUBLISHED', publishedAt })
        .where(eq(schema.outboxEvents.id, id));
    },
    markFailed: async (id) => {
      await db
        .update(schema.outboxEvents)
        .set({
          attempts: sql`${schema.outboxEvents.attempts} + 1`,
          status: sql`CASE WHEN ${schema.outboxEvents.attempts} + 1 >= 5 THEN 'FAILED' ELSE 'PENDING' END`,
        })
        .where(eq(schema.outboxEvents.id, id));
    },
  };

  const credentials: ICredentialRepository = {
    create: async (record) => {
      try {
        const [row] = await db
          .insert(schema.credentials)
          .values({
            id: record.id,
            name: record.name,
            type: record.type,
            keyId: record.keyId,
            iv: record.iv,
            authTag: record.authTag,
            ciphertext: record.ciphertext,
            createdBy: record.createdBy,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
          })
          .returning();
        return toCredentialRecord(row!);
      } catch (err: unknown) {
        if ((err as { code?: string }).code === '23505') {
          throw new ConflictError(`Credential '${record.name}' already exists`);
        }
        throw err;
      }
    },
    findById: async (id) => {
      const [row] = await db.select().from(schema.credentials).where(eq(schema.credentials.id, id));
      return row ? toCredentialRecord(row) : null;
    },
    findByName: async (name) => {
      const [row] = await db
        .select()
        .from(schema.credentials)
        .where(eq(schema.credentials.name, name));
      return row ? toCredentialRecord(row) : null;
    },
    list: async () => {
      const rows = await db
        .select()
        .from(schema.credentials)
        .orderBy(desc(schema.credentials.createdAt));
      return rows.map(toCredentialRecord);
    },
    update: async (record) => {
      const [updated] = await db
        .update(schema.credentials)
        .set({
          keyId: record.keyId,
          iv: record.iv,
          authTag: record.authTag,
          ciphertext: record.ciphertext,
          updatedAt: new Date(),
        })
        .where(eq(schema.credentials.id, record.id))
        .returning();
      if (!updated) throw new NotFoundError('Credential', record.id);
      return toCredentialRecord(updated);
    },
    delete: async (id) => {
      const deleted = await db
        .delete(schema.credentials)
        .where(eq(schema.credentials.id, id))
        .returning({ id: schema.credentials.id });
      if (deleted.length === 0) throw new NotFoundError('Credential', id);
    },
  };

  const users: IUserRepository = {
    create: async (user) => {
      try {
        const [row] = await db
          .insert(schema.users)
          .values({
            id: user.id,
            email: user.email,
            name: user.name,
            passwordHash: user.passwordHash,
            role: user.role,
            isActive: user.isActive,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
          })
          .returning();
        return { ...row!, role: row!.role as Role };
      } catch (err: unknown) {
        if ((err as { code?: string }).code === '23505') {
          throw new ConflictError(`User '${user.email}' already exists`);
        }
        throw err;
      }
    },
    findById: async (id) => {
      const [row] = await db.select().from(schema.users).where(eq(schema.users.id, id));
      return row ? { ...row, role: row.role as Role } : null;
    },
    findByEmail: async (email) => {
      const [row] = await db
        .select()
        .from(schema.users)
        .where(sql`LOWER(${schema.users.email}) = LOWER(${email})`);
      return row ? { ...row, role: row.role as Role } : null;
    },
    count: async () => {
      const [row] = await db.select({ cnt: drizzleCount() }).from(schema.users);
      return Number(row?.cnt ?? 0);
    },
    createApiKey: async (apiKey) => {
      const [row] = await db
        .insert(schema.apiKeys)
        .values({
          id: apiKey.id,
          userId: apiKey.userId,
          name: apiKey.name,
          keyPrefix: apiKey.keyPrefix,
          keyHash: apiKey.keyHash,
          role: apiKey.role,
          expiresAt: apiKey.expiresAt,
          lastUsedAt: apiKey.lastUsedAt,
          createdAt: apiKey.createdAt,
        })
        .returning();
      return { ...row!, role: row!.role as Role };
    },
    findApiKeyByHash: async (keyHash) => {
      const [row] = await db
        .select()
        .from(schema.apiKeys)
        .where(eq(schema.apiKeys.keyHash, keyHash));
      return row ? { ...row, role: row.role as Role } : null;
    },
    touchApiKey: async (id, usedAt) => {
      await db.update(schema.apiKeys).set({ lastUsedAt: usedAt }).where(eq(schema.apiKeys.id, id));
    },
  };

  const idempotency: IIdempotencyRepository = {
    find: async (key, scope, now) => {
      const [row] = await db
        .select()
        .from(schema.idempotencyKeys)
        .where(
          and(
            eq(schema.idempotencyKeys.key, key),
            eq(schema.idempotencyKeys.scope, scope),
            gt(schema.idempotencyKeys.expiresAt, now),
          ),
        );
      return row ?? null;
    },
    save: async (record) => {
      await db
        .insert(schema.idempotencyKeys)
        .values(record)
        .onConflictDoUpdate({
          target: [schema.idempotencyKeys.key, schema.idempotencyKeys.scope],
          set: {
            requestHash: record.requestHash,
            statusCode: record.statusCode,
            responseBody: record.responseBody,
            expiresAt: record.expiresAt,
          },
        });
    },
  };

  return {
    workflows,
    instances,
    tokens,
    steps,
    userTasks,
    caseComments,
    subscriptions,
    incidents,
    jobs,
    outbox,
    credentials,
    users,
    idempotency,
  };
}

function toWorkflowRecord(row: typeof schema.workflows.$inferSelect): WorkflowDefinitionRecord {
  return { ...row, status: row.status as WorkflowStatus };
}

function toInstanceRecord(row: typeof schema.workflowInstances.$inferSelect): WorkflowInstance {
  return {
    ...row,
    status: row.status as WorkflowInstance['status'],
    slaStatus: row.slaStatus as WorkflowInstance['slaStatus'],
  };
}

function toTokenRecord(row: typeof schema.executionTokens.$inferSelect): ExecutionToken {
  return { ...row, status: row.status as ExecutionToken['status'] };
}

function toStepRecord(row: typeof schema.stepExecutions.$inferSelect): StepExecution {
  return { ...row, status: row.status as StepExecution['status'] };
}

function toTaskRecord(row: typeof schema.userTasks.$inferSelect): UserTask {
  return { ...row, status: row.status as UserTask['status'] };
}

function toSubscriptionRecord(row: typeof schema.eventSubscriptions.$inferSelect): EventSubscription {
  return {
    ...row,
    type: row.type as EventSubscription['type'],
    status: row.status as EventSubscription['status'],
  };
}

function toIncidentRecord(row: typeof schema.incidents.$inferSelect): Incident {
  return { ...row, status: row.status as Incident['status'] };
}

function toJobRecord(row: typeof schema.executionJobs.$inferSelect): ExecutionJob {
  return {
    ...row,
    jobType: row.jobType as ExecutionJob['jobType'],
    status: row.status as ExecutionJob['status'],
  };
}

function toOutboxRecord(row: typeof schema.outboxEvents.$inferSelect): OutboxEvent {
  return { ...row, status: row.status as OutboxEvent['status'] };
}

function toCredentialRecord(row: typeof schema.credentials.$inferSelect): CredentialRecord {
  return { ...row, type: row.type as CredentialRecord['type'] };
}

/**
 * Drizzle ORM Unit of Work for PostgreSQL.
 */
export class PostgresUnitOfWork implements IUnitOfWork {
  public readonly db: DrizzleDb;
  public readonly repos: IRepositoryRegistry;

  constructor(private readonly pool: Pool) {
    this.db = drizzle(pool, { schema });
    this.repos = buildDrizzleRegistry(this.db);
  }

  async runInTransaction<T>(fn: (repos: IRepositoryRegistry) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      const txRepos = buildDrizzleRegistry(tx as unknown as DrizzleDb);
      return fn(txRepos);
    });
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export type { CaseComment };
