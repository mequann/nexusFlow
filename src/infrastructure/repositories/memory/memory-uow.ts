import { ConflictError, NotFoundError } from '../../../domain/errors.js';
import type {
  CaseComment,
  EventSubscription,
  ExecutionJob,
  ExecutionToken,
  ExternalTask,
  Incident,
  NotificationRecord,
  OutboxEvent,
  StepExecution,
  UserTask,
  WorkflowInstance,
} from '../../../domain/execution/types.js';
import type {
  ICaseCommentRepository,
  ICredentialRepository,
  IExternalTaskRepository,
  IIdempotencyRepository,
  IIncidentRepository,
  IInstanceRepository,
  IJobRepository,
  INotificationRepository,
  IOutboxRepository,
  IRepositoryRegistry,
  IStepRepository,
  ISubscriptionRepository,
  ITenantRepository,
  ITokenRepository,
  IUnitOfWork,
  IUserRepository,
  IUserTaskRepository,
  IWorkflowRepository,
  IdempotencyRecord,
} from '../../../domain/ports/repositories.js';
import type { ApiKeyRecord, CredentialRecord, TenantRecord, UserRecord } from '../../../domain/security/types.js';
import type { WorkflowDefinitionRecord } from '../../../domain/workflow/types.js';

function clone<T>(obj: T): T {
  return structuredClone(obj);
}

export class MemoryUnitOfWork implements IUnitOfWork {
  private readonly tenantsMap = new Map<string, TenantRecord>();
  private readonly workflowsMap = new Map<string, WorkflowDefinitionRecord>();
  private readonly instancesMap = new Map<string, WorkflowInstance>();
  private readonly tokensMap = new Map<string, ExecutionToken>();
  private readonly stepsMap = new Map<string, StepExecution>();
  private readonly userTasksMap = new Map<string, UserTask>();
  private readonly notificationsMap = new Map<string, NotificationRecord>();
  private readonly commentsMap = new Map<string, CaseComment>();
  private readonly externalTasksMap = new Map<string, ExternalTask>();
  private readonly subscriptionsMap = new Map<string, EventSubscription>();
  private readonly incidentsMap = new Map<string, Incident>();
  private readonly jobsMap = new Map<string, ExecutionJob>();
  private readonly outboxMap = new Map<string, OutboxEvent>();
  private readonly credentialsMap = new Map<string, CredentialRecord>();
  private readonly usersMap = new Map<string, UserRecord>();
  private readonly apiKeysMap = new Map<string, ApiKeyRecord>();
  private readonly idempotencyMap = new Map<string, IdempotencyRecord>();

  private txChain: Promise<unknown> = Promise.resolve();
  public readonly repos: IRepositoryRegistry;

  constructor() {
    this.repos = this.createRegistry();
  }

  async runInTransaction<T>(fn: (repos: IRepositoryRegistry) => Promise<T>): Promise<T> {
    const run = this.txChain.then(() => fn(this.repos));
    this.txChain = run.catch(() => undefined);
    return run;
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {
    // No external resources to close
  }

  private createRegistry(): IRepositoryRegistry {
    const tenants: ITenantRepository = {
      create: async (record) => {
        const saved = clone(record);
        this.tenantsMap.set(saved.id, saved);
        return clone(saved);
      },
      findById: async (id) => {
        const found = this.tenantsMap.get(id);
        return found ? clone(found) : null;
      },
      list: async () => [...this.tenantsMap.values()].map(clone),
      update: async (record) => {
        if (!this.tenantsMap.has(record.id)) throw new NotFoundError('Tenant', record.id);
        const saved = clone(record);
        this.tenantsMap.set(saved.id, saved);
        return clone(saved);
      },
    };

    const workflows: IWorkflowRepository = {
      create: async (record) => {
        for (const existing of this.workflowsMap.values()) {
          if (
            existing.tenantId === record.tenantId &&
            existing.key === record.key &&
            existing.version === record.version
          ) {
            throw new ConflictError(
              `Workflow '${record.key}' v${record.version} already exists in tenant '${record.tenantId}'`,
            );
          }
        }
        const saved = clone(record);
        this.workflowsMap.set(saved.id, saved);
        return clone(saved);
      },
      findById: async (id) => {
        const found = this.workflowsMap.get(id);
        return found ? clone(found) : null;
      },
      findLatestByKey: async (key, status, tenantId) => {
        const matches = [...this.workflowsMap.values()]
          .filter((w) => {
            if (tenantId && w.tenantId !== tenantId) return false;
            if (w.key !== key) return false;
            if (status && w.status !== status) return false;
            return true;
          })
          .sort((a, b) => b.version - a.version);
        return matches[0] ? clone(matches[0]) : null;
      },
      findByKeyAndVersion: async (key, version, tenantId) => {
        for (const w of this.workflowsMap.values()) {
          if (tenantId && w.tenantId !== tenantId) continue;
          if (w.key === key && w.version === version) return clone(w);
        }
        return null;
      },
      findByWebhookPath: async (webhookPath, tenantId) => {
        const matches = [...this.workflowsMap.values()]
          .filter((w) => {
            if (tenantId && w.tenantId !== tenantId) return false;
            return w.status === 'PUBLISHED' && w.webhookPath === webhookPath;
          })
          .sort((a, b) => b.version - a.version);
        return matches[0] ? clone(matches[0]) : null;
      },
      findDueCronWorkflows: async (now) => {
        return [...this.workflowsMap.values()]
          .filter(
            (w) =>
              w.status === 'PUBLISHED' &&
              w.cronExpression !== null &&
              w.cronNextRunAt !== null &&
              w.cronNextRunAt.getTime() <= now.getTime(),
          )
          .map(clone);
      },
      list: async (filters) => {
        return [...this.workflowsMap.values()]
          .filter((w) => {
            if (filters?.tenantId && w.tenantId !== filters.tenantId) return false;
            if (filters?.status && w.status !== filters.status) return false;
            if (filters?.key && w.key !== filters.key) return false;
            return true;
          })
          .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
          .map(clone);
      },
      update: async (record) => {
        if (!this.workflowsMap.has(record.id)) {
          throw new NotFoundError('Workflow', record.id);
        }
        const saved = clone(record);
        this.workflowsMap.set(saved.id, saved);
        return clone(saved);
      },
      getNextVersion: async (key, tenantId) => {
        let max = 0;
        for (const w of this.workflowsMap.values()) {
          if (tenantId && w.tenantId !== tenantId) continue;
          if (w.key === key && w.version > max) max = w.version;
        }
        return max + 1;
      },
    };

    const instances: IInstanceRepository = {
      create: async (instance) => {
        const saved = clone(instance);
        this.instancesMap.set(saved.id, saved);
        return clone(saved);
      },
      findById: async (id) => {
        const found = this.instancesMap.get(id);
        return found ? clone(found) : null;
      },
      findByIdForUpdate: async (id) => {
        const found = this.instancesMap.get(id);
        return found ? clone(found) : null;
      },
      findByParentInstance: async (parentInstanceId: string) => {
        return [...this.instancesMap.values()]
          .filter((i) => i.parentInstanceId === parentInstanceId)
          .map(clone);
      },
      list: async (filters) => {
        const list = [...this.instancesMap.values()]
          .filter((i) => {
            if (filters?.tenantId && i.tenantId !== filters.tenantId) return false;
            if (filters?.status && i.status !== filters.status) return false;
            if (filters?.workflowKey && i.workflowKey !== filters.workflowKey) return false;
            if (filters?.startedBy && i.startedBy !== filters.startedBy) return false;
            return true;
          })
          .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
        return list.slice(0, filters?.limit ?? 100).map(clone);
      },
      updateWithOcc: async (instance) => {
        const current = this.instancesMap.get(instance.id);
        if (!current) throw new NotFoundError('WorkflowInstance', instance.id);
        if (current.occVersion !== instance.occVersion) {
          throw new ConflictError(
            `Optimistic concurrency conflict on instance '${instance.id}'`,
          );
        }
        const next = clone(instance);
        next.occVersion += 1;
        next.updatedAt = new Date();
        this.instancesMap.set(next.id, next);
        return clone(next);
      },
    };

    const tokens: ITokenRepository = {
      create: async (token) => {
        const saved = clone(token);
        this.tokensMap.set(saved.id, saved);
        return clone(saved);
      },
      findById: async (id) => {
        const found = this.tokensMap.get(id);
        return found ? clone(found) : null;
      },
      findByInstance: async (instanceId) => {
        return [...this.tokensMap.values()]
          .filter((t) => t.instanceId === instanceId)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map(clone);
      },
      findWaitingAtNode: async (instanceId, nodeId) => {
        return [...this.tokensMap.values()]
          .filter(
            (t) =>
              t.instanceId === instanceId &&
              t.currentNodeId === nodeId &&
              t.status === 'WAITING',
          )
          .map(clone);
      },
      update: async (token) => {
        if (!this.tokensMap.has(token.id)) {
          throw new NotFoundError('ExecutionToken', token.id);
        }
        const saved = clone(token);
        saved.updatedAt = new Date();
        this.tokensMap.set(saved.id, saved);
        return clone(saved);
      },
    };

    const steps: IStepRepository = {
      create: async (step) => {
        const saved = clone(step);
        this.stepsMap.set(saved.id, saved);
        return clone(saved);
      },
      findById: async (id) => {
        const found = this.stepsMap.get(id);
        return found ? clone(found) : null;
      },
      findByInstance: async (instanceId) => {
        return [...this.stepsMap.values()]
          .filter((s) => s.instanceId === instanceId)
          .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
          .map(clone);
      },
      update: async (step) => {
        if (!this.stepsMap.has(step.id)) throw new NotFoundError('StepExecution', step.id);
        const saved = clone(step);
        this.stepsMap.set(saved.id, saved);
        return clone(saved);
      },
    };

    const userTasks: IUserTaskRepository = {
      create: async (task) => {
        const saved = clone(task);
        this.userTasksMap.set(saved.id, saved);
        return clone(saved);
      },
      findById: async (id) => {
        const found = this.userTasksMap.get(id);
        return found ? clone(found) : null;
      },
      list: async (filters) => {
        return [...this.userTasksMap.values()]
          .filter((t) => {
            if (filters?.tenantId && t.tenantId !== filters.tenantId) return false;
            if (filters?.status && t.status !== filters.status) return false;
            if (filters?.assignee && t.assignee !== filters.assignee) return false;
            if (filters?.candidateGroup && t.candidateGroup !== filters.candidateGroup) return false;
            if (
              filters?.candidateGroups &&
              (!t.candidateGroup || !filters.candidateGroups.includes(t.candidateGroup))
            ) {
              return false;
            }
            if (filters?.userOrGroups) {
              const matchesUser = t.assignee === filters.userOrGroups.userId;
              const matchesGroup =
                t.candidateGroup && filters.userOrGroups.groups.includes(t.candidateGroup);
              if (!matchesUser && !matchesGroup) return false;
            }
            if (filters?.instanceId && t.instanceId !== filters.instanceId) return false;
            return true;
          })
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .map(clone);
      },
      findOverdueTasks: async (now, limit = 50) => {
        return [...this.userTasksMap.values()]
          .filter(
            (t) =>
              (t.status === 'OPEN' || t.status === 'CLAIMED') &&
              !t.slaBreached &&
              t.dueAt !== null &&
              t.dueAt.getTime() <= now.getTime(),
          )
          .sort((a, b) => (a.dueAt?.getTime() ?? 0) - (b.dueAt?.getTime() ?? 0))
          .slice(0, limit)
          .map(clone);
      },
      update: async (task) => {
        if (!this.userTasksMap.has(task.id)) throw new NotFoundError('UserTask', task.id);
        const saved = clone(task);
        saved.updatedAt = new Date();
        this.userTasksMap.set(saved.id, saved);
        return clone(saved);
      },
    };

    const notifications: INotificationRepository = {
      create: async (notification) => {
        const saved = clone(notification);
        this.notificationsMap.set(saved.id, saved);
        return clone(saved);
      },
      findById: async (id) => {
        const found = this.notificationsMap.get(id);
        return found ? clone(found) : null;
      },
      list: async (filters) => {
        return [...this.notificationsMap.values()]
          .filter((n) => {
            if (filters.tenantId && n.tenantId !== filters.tenantId) return false;
            if (filters.read !== undefined && n.read !== filters.read) return false;
            if (filters.recipientId && n.recipientId !== filters.recipientId) return false;
            if (filters.recipientGroup && n.recipientGroup !== filters.recipientGroup) return false;
            if (filters.recipientOrGroup) {
              const matchesUser = n.recipientId === filters.recipientOrGroup.recipientId;
              const matchesGroup =
                n.recipientGroup && filters.recipientOrGroup.groups.includes(n.recipientGroup);
              if (!matchesUser && !matchesGroup) return false;
            }
            return true;
          })
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, filters.limit ?? 50)
          .map(clone);
      },
      markAsRead: async (id, readAt) => {
        const n = this.notificationsMap.get(id);
        if (n) {
          n.read = true;
          n.readAt = readAt;
        }
      },
      markAllAsRead: async (recipientId, readAt, tenantId) => {
        for (const n of this.notificationsMap.values()) {
          if (tenantId && n.tenantId !== tenantId) continue;
          if (n.recipientId === recipientId && !n.read) {
            n.read = true;
            n.readAt = readAt;
          }
        }
      },
    };

    const caseComments: ICaseCommentRepository = {
      create: async (comment) => {
        const saved = clone(comment);
        this.commentsMap.set(saved.id, saved);
        return clone(saved);
      },
      findByInstance: async (instanceId) => {
        return [...this.commentsMap.values()]
          .filter((c) => c.instanceId === instanceId)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map(clone);
      },
    };

    const externalTasks: IExternalTaskRepository = {
      create: async (task) => {
        const saved = clone(task);
        this.externalTasksMap.set(saved.id, saved);
        return clone(saved);
      },
      findById: async (id) => {
        const found = this.externalTasksMap.get(id);
        return found ? clone(found) : null;
      },
      fetchAndLock: async (workerId, topics, maxTasks, lockUntil, now) => {
        const topicSet = new Set(topics);
        const candidates = [...this.externalTasksMap.values()]
          .filter(
            (t) =>
              topicSet.has(t.topic) &&
              (t.status === 'OPEN' ||
                (t.status === 'LOCKED' &&
                  t.lockExpiresAt !== null &&
                  t.lockExpiresAt.getTime() <= now.getTime())),
          )
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .slice(0, maxTasks);

        for (const t of candidates) {
          t.status = 'LOCKED';
          t.workerId = workerId;
          t.lockExpiresAt = lockUntil;
          t.updatedAt = now;
        }
        return candidates.map(clone);
      },
      update: async (task) => {
        if (!this.externalTasksMap.has(task.id)) {
          throw new NotFoundError('ExternalTask', task.id);
        }
        const saved = clone(task);
        saved.updatedAt = new Date();
        this.externalTasksMap.set(saved.id, saved);
        return clone(saved);
      },
    };

    const subscriptions: ISubscriptionRepository = {
      create: async (sub) => {
        const saved = clone(sub);
        this.subscriptionsMap.set(saved.id, saved);
        return clone(saved);
      },
      findActiveMessage: async (messageName, correlationKey) => {
        return [...this.subscriptionsMap.values()]
          .filter(
            (s) =>
              s.status === 'ACTIVE' &&
              s.type === 'MESSAGE' &&
              s.messageName === messageName &&
              (s.correlationKey === correlationKey || s.correlationKey === null),
          )
          .map(clone);
      },
      findDueTimers: async (now, limit = 50) => {
        return [...this.subscriptionsMap.values()]
          .filter(
            (s) =>
              s.status === 'ACTIVE' &&
              s.type === 'TIMER' &&
              s.triggerAt !== null &&
              s.triggerAt.getTime() <= now.getTime(),
          )
          .sort((a, b) => (a.triggerAt?.getTime() ?? 0) - (b.triggerAt?.getTime() ?? 0))
          .slice(0, limit)
          .map(clone);
      },
      findByInstance: async (instanceId) => {
        return [...this.subscriptionsMap.values()]
          .filter((s) => s.instanceId === instanceId)
          .map(clone);
      },
      update: async (sub) => {
        if (!this.subscriptionsMap.has(sub.id)) {
          throw new NotFoundError('EventSubscription', sub.id);
        }
        const saved = clone(sub);
        this.subscriptionsMap.set(saved.id, saved);
        return clone(saved);
      },
    };

    const incidents: IIncidentRepository = {
      create: async (incident) => {
        const saved = clone(incident);
        this.incidentsMap.set(saved.id, saved);
        return clone(saved);
      },
      findById: async (id) => {
        const found = this.incidentsMap.get(id);
        return found ? clone(found) : null;
      },
      list: async (filters) => {
        return [...this.incidentsMap.values()]
          .filter((i) => {
            if (filters?.status && i.status !== filters.status) return false;
            if (filters?.instanceId && i.instanceId !== filters.instanceId) return false;
            return true;
          })
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .map(clone);
      },
      update: async (incident) => {
        if (!this.incidentsMap.has(incident.id)) throw new NotFoundError('Incident', incident.id);
        const saved = clone(incident);
        this.incidentsMap.set(saved.id, saved);
        return clone(saved);
      },
    };

    const jobs: IJobRepository = {
      enqueue: async (job) => {
        const saved = clone(job);
        this.jobsMap.set(saved.id, saved);
        return clone(saved);
      },
      claimNextBatch: async (workerId, limit, now) => {
        const due = [...this.jobsMap.values()]
          .filter(
            (j) => j.status === 'PENDING' && j.availableAt.getTime() <= now.getTime(),
          )
          .sort((a, b) => a.availableAt.getTime() - b.availableAt.getTime())
          .slice(0, limit);

        for (const job of due) {
          job.status = 'PROCESSING';
          job.lockedBy = workerId;
          job.lockedAt = now;
          job.updatedAt = now;
        }
        return due.map(clone);
      },
      complete: async (jobId) => {
        const job = this.jobsMap.get(jobId);
        if (!job) return;
        job.status = 'COMPLETED';
        job.updatedAt = new Date();
      },
      reschedule: async (jobId, availableAt, attempts, lastError) => {
        const job = this.jobsMap.get(jobId);
        if (!job) return;
        job.status = 'PENDING';
        job.availableAt = availableAt;
        job.attempts = attempts;
        job.lastError = lastError;
        job.lockedBy = null;
        job.lockedAt = null;
        job.updatedAt = new Date();
      },
      markDead: async (jobId, attempts, lastError) => {
        const job = this.jobsMap.get(jobId);
        if (!job) return;
        job.status = 'DEAD';
        job.attempts = attempts;
        job.lastError = lastError;
        job.updatedAt = new Date();
      },
    };

    const outbox: IOutboxRepository = {
      append: async (event) => {
        const saved = clone(event);
        this.outboxMap.set(saved.id, saved);
        return clone(saved);
      },
      fetchPending: async (limit) => {
        return [...this.outboxMap.values()]
          .filter((e) => e.status === 'PENDING')
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .slice(0, limit)
          .map(clone);
      },
      markPublished: async (id, publishedAt) => {
        const e = this.outboxMap.get(id);
        if (!e) return;
        e.status = 'PUBLISHED';
        e.publishedAt = publishedAt;
      },
      markFailed: async (id) => {
        const e = this.outboxMap.get(id);
        if (!e) return;
        e.attempts += 1;
        if (e.attempts >= 5) e.status = 'FAILED';
      },
    };

    const credentials: ICredentialRepository = {
      create: async (record) => {
        for (const c of this.credentialsMap.values()) {
          if (c.name === record.name) {
            throw new ConflictError(`Credential '${record.name}' already exists`);
          }
        }
        const saved = clone(record);
        this.credentialsMap.set(saved.id, saved);
        return clone(saved);
      },
      findById: async (id) => {
        const found = this.credentialsMap.get(id);
        return found ? clone(found) : null;
      },
      findByName: async (name, tenantId) => {
        for (const c of this.credentialsMap.values()) {
          if (tenantId && c.tenantId !== tenantId) continue;
          if (c.name === name) return clone(c);
        }
        return null;
      },
      list: async (filters) => {
        return [...this.credentialsMap.values()]
          .filter((c) => !filters?.tenantId || c.tenantId === filters.tenantId)
          .map(clone);
      },
      update: async (record) => {
        if (!this.credentialsMap.has(record.id)) {
          throw new NotFoundError('Credential', record.id);
        }
        const saved = clone(record);
        this.credentialsMap.set(saved.id, saved);
        return clone(saved);
      },
      delete: async (id) => {
        if (!this.credentialsMap.delete(id)) {
          throw new NotFoundError('Credential', id);
        }
      },
    };

    const users: IUserRepository = {
      create: async (user) => {
        for (const u of this.usersMap.values()) {
          if (u.email === user.email) {
            throw new ConflictError(`User '${user.email}' already exists`);
          }
        }
        const saved = clone(user);
        this.usersMap.set(saved.id, saved);
        return clone(saved);
      },
      findById: async (id) => {
        const found = this.usersMap.get(id);
        return found ? clone(found) : null;
      },
      findByEmail: async (email, tenantId) => {
        for (const u of this.usersMap.values()) {
          if (tenantId && u.tenantId !== tenantId) continue;
          if (u.email.toLowerCase() === email.toLowerCase()) return clone(u);
        }
        return null;
      },
      list: async (filters) => {
        return [...this.usersMap.values()]
          .filter((u) => {
            if (filters?.tenantId && u.tenantId !== filters.tenantId) return false;
            if (filters?.department && u.department !== filters.department) return false;
            if (filters?.isActive !== undefined && u.isActive !== filters.isActive) return false;
            return true;
          })
          .map(clone);
      },
      count: async (tenantId) => {
        if (!tenantId) return this.usersMap.size;
        return [...this.usersMap.values()].filter((u) => u.tenantId === tenantId).length;
      },
      createApiKey: async (apiKey) => {
        const saved = clone(apiKey);
        this.apiKeysMap.set(saved.id, saved);
        return clone(saved);
      },
      findApiKeyByHash: async (keyHash) => {
        for (const k of this.apiKeysMap.values()) {
          if (k.keyHash === keyHash) return clone(k);
        }
        return null;
      },
      touchApiKey: async (id, usedAt) => {
        const k = this.apiKeysMap.get(id);
        if (k) k.lastUsedAt = usedAt;
      },
      update: async (user) => {
        if (!this.usersMap.has(user.id)) throw new NotFoundError('User', user.id);
        const saved = clone(user);
        saved.updatedAt = new Date();
        this.usersMap.set(saved.id, saved);
        return clone(saved);
      },
    };

    const idempotency: IIdempotencyRepository = {
      find: async (key, scope, now) => {
        const rec = this.idempotencyMap.get(`${scope}:${key}`);
        if (!rec || rec.expiresAt.getTime() <= now.getTime()) return null;
        return clone(rec);
      },
      save: async (record) => {
        this.idempotencyMap.set(`${record.scope}:${record.key}`, clone(record));
      },
    };

    return {
      tenants,
      workflows,
      instances,
      tokens,
      steps,
      userTasks,
      notifications,
      caseComments,
      externalTasks,
      subscriptions,
      incidents,
      jobs,
      outbox,
      credentials,
      users,
      idempotency,
    };
  }
}
