import type {
  CaseComment,
  EventSubscription,
  ExecutionJob,
  ExecutionToken,
  ExternalTask,
  Incident,
  IncidentStatus,
  InstanceStatus,
  OutboxEvent,
  StepExecution,
  UserTask,
  UserTaskStatus,
  WorkflowInstance,
} from '../execution/types.js';
import type { ApiKeyRecord, CredentialRecord, UserRecord } from '../security/types.js';
import type { WorkflowDefinitionRecord, WorkflowStatus } from '../workflow/types.js';

export interface IWorkflowRepository {
  create(record: WorkflowDefinitionRecord): Promise<WorkflowDefinitionRecord>;
  findById(id: string): Promise<WorkflowDefinitionRecord | null>;
  findLatestByKey(key: string, status?: WorkflowStatus): Promise<WorkflowDefinitionRecord | null>;
  findByKeyAndVersion(key: string, version: number): Promise<WorkflowDefinitionRecord | null>;
  findByWebhookPath(path: string): Promise<WorkflowDefinitionRecord | null>;
  findDueCronWorkflows(now: Date): Promise<WorkflowDefinitionRecord[]>;
  list(filters?: { status?: WorkflowStatus; key?: string }): Promise<WorkflowDefinitionRecord[]>;
  update(record: WorkflowDefinitionRecord): Promise<WorkflowDefinitionRecord>;
  getNextVersion(key: string): Promise<number>;
}

export interface IInstanceRepository {
  create(instance: WorkflowInstance): Promise<WorkflowInstance>;
  findById(id: string): Promise<WorkflowInstance | null>;
  findByIdForUpdate(id: string): Promise<WorkflowInstance | null>;
  list(filters?: {
    status?: InstanceStatus;
    workflowKey?: string;
    limit?: number;
  }): Promise<WorkflowInstance[]>;
  updateWithOcc(instance: WorkflowInstance): Promise<WorkflowInstance>;
}

export interface ITokenRepository {
  create(token: ExecutionToken): Promise<ExecutionToken>;
  findById(id: string): Promise<ExecutionToken | null>;
  findByInstance(instanceId: string): Promise<ExecutionToken[]>;
  findWaitingAtNode(instanceId: string, nodeId: string): Promise<ExecutionToken[]>;
  update(token: ExecutionToken): Promise<ExecutionToken>;
}

export interface IStepRepository {
  create(step: StepExecution): Promise<StepExecution>;
  findById(id: string): Promise<StepExecution | null>;
  findByInstance(instanceId: string): Promise<StepExecution[]>;
  update(step: StepExecution): Promise<StepExecution>;
}

export interface IUserTaskRepository {
  create(task: UserTask): Promise<UserTask>;
  findById(id: string): Promise<UserTask | null>;
  list(filters?: {
    status?: UserTaskStatus;
    assignee?: string;
    candidateGroup?: string;
    instanceId?: string;
  }): Promise<UserTask[]>;
  findOverdueTasks(now: Date, limit?: number): Promise<UserTask[]>;
  update(task: UserTask): Promise<UserTask>;
}

export interface ICaseCommentRepository {
  create(comment: CaseComment): Promise<CaseComment>;
  findByInstance(instanceId: string): Promise<CaseComment[]>;
}

export interface IExternalTaskRepository {
  create(task: ExternalTask): Promise<ExternalTask>;
  findById(id: string): Promise<ExternalTask | null>;
  fetchAndLock(
    workerId: string,
    topics: string[],
    maxTasks: number,
    lockUntil: Date,
    now: Date,
  ): Promise<ExternalTask[]>;
  update(task: ExternalTask): Promise<ExternalTask>;
}

export interface ISubscriptionRepository {
  create(sub: EventSubscription): Promise<EventSubscription>;
  findActiveMessage(messageName: string, correlationKey: string): Promise<EventSubscription[]>;
  findDueTimers(now: Date, limit?: number): Promise<EventSubscription[]>;
  findByInstance(instanceId: string): Promise<EventSubscription[]>;
  update(sub: EventSubscription): Promise<EventSubscription>;
}

export interface IIncidentRepository {
  create(incident: Incident): Promise<Incident>;
  findById(id: string): Promise<Incident | null>;
  list(filters?: { status?: IncidentStatus; instanceId?: string }): Promise<Incident[]>;
  update(incident: Incident): Promise<Incident>;
}

export interface IJobRepository {
  enqueue(job: ExecutionJob): Promise<ExecutionJob>;
  claimNextBatch(workerId: string, limit: number, now: Date): Promise<ExecutionJob[]>;
  complete(jobId: string): Promise<void>;
  reschedule(jobId: string, availableAt: Date, attempts: number, lastError: string): Promise<void>;
  markDead(jobId: string, attempts: number, lastError: string): Promise<void>;
}

export interface IOutboxRepository {
  append(event: OutboxEvent): Promise<OutboxEvent>;
  fetchPending(limit: number): Promise<OutboxEvent[]>;
  markPublished(id: string, publishedAt: Date): Promise<void>;
  markFailed(id: string): Promise<void>;
}

export interface ICredentialRepository {
  create(record: CredentialRecord): Promise<CredentialRecord>;
  findById(id: string): Promise<CredentialRecord | null>;
  findByName(name: string): Promise<CredentialRecord | null>;
  list(): Promise<CredentialRecord[]>;
  update(record: CredentialRecord): Promise<CredentialRecord>;
  delete(id: string): Promise<void>;
}

export interface IUserRepository {
  create(user: UserRecord): Promise<UserRecord>;
  findById(id: string): Promise<UserRecord | null>;
  findByEmail(email: string): Promise<UserRecord | null>;
  count(): Promise<number>;
  createApiKey(apiKey: ApiKeyRecord): Promise<ApiKeyRecord>;
  findApiKeyByHash(keyHash: string): Promise<ApiKeyRecord | null>;
  touchApiKey(id: string, usedAt: Date): Promise<void>;
}

export interface IdempotencyRecord {
  key: string;
  scope: string;
  requestHash: string;
  statusCode: number;
  responseBody: unknown;
  createdAt: Date;
  expiresAt: Date;
}

export interface IIdempotencyRepository {
  find(key: string, scope: string, now: Date): Promise<IdempotencyRecord | null>;
  save(record: IdempotencyRecord): Promise<void>;
}

export interface IRepositoryRegistry {
  workflows: IWorkflowRepository;
  instances: IInstanceRepository;
  tokens: ITokenRepository;
  steps: IStepRepository;
  userTasks: IUserTaskRepository;
  caseComments: ICaseCommentRepository;
  externalTasks: IExternalTaskRepository;
  subscriptions: ISubscriptionRepository;
  incidents: IIncidentRepository;
  jobs: IJobRepository;
  outbox: IOutboxRepository;
  credentials: ICredentialRepository;
  users: IUserRepository;
  idempotency: IIdempotencyRepository;
}

export interface IUnitOfWork {
  /** Root non-transactional repositories */
  readonly repos: IRepositoryRegistry;
  /** Runs callback inside an atomic ACID transaction (or serialized lock in memory) */
  runInTransaction<T>(fn: (repos: IRepositoryRegistry) => Promise<T>): Promise<T>;
  healthCheck(): Promise<boolean>;
  close(): Promise<void>;
}
