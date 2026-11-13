export type InstanceStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'WAITING'
  | 'INCIDENT_OPEN'
  | 'COMPENSATING'
  | 'COMPENSATED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type TokenStatus = 'ACTIVE' | 'WAITING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export type StepStatus =
  | 'RUNNING'
  | 'WAITING'
  | 'COMPLETED'
  | 'FAILED'
  | 'SKIPPED'
  | 'COMPENSATED'
  | 'COMPENSATION_FAILED';

export type UserTaskStatus =
  | 'OPEN'
  | 'CLAIMED'
  | 'COMPLETED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'EXPIRED';

export type SubscriptionType = 'MESSAGE' | 'TIMER';
export type SubscriptionStatus = 'ACTIVE' | 'TRIGGERED' | 'CANCELLED';

export type IncidentStatus = 'OPEN' | 'RESOLVED' | 'DISMISSED';

export type JobType = 'EXECUTE_NODE' | 'RESUME_TOKEN' | 'COMPENSATE';
export type JobStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'DEAD';

export interface TaskApprovalVote {
  userId: string;
  decision: 'APPROVED' | 'REJECTED';
  note?: string;
  decidedAt: string;
}

export type ExternalTaskStatus = 'OPEN' | 'LOCKED' | 'COMPLETED' | 'FAILED';

export interface ExternalTask {
  id: string;
  instanceId: string;
  tokenId: string;
  nodeId: string;
  topic: string;
  workerId: string | null;
  lockExpiresAt: Date | null;
  status: ExternalTaskStatus;
  variables: Record<string, unknown>;
  resultVariables: Record<string, unknown> | null;
  retries: number;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkflowInstance {
  id: string;
  tenantId: string;
  workflowId: string;
  workflowKey: string;
  workflowVersion: number;
  status: InstanceStatus;
  currentStage: string | null;
  slaStatus: 'ON_TRACK' | 'BREACHED';
  triggerType: string;
  triggerPayload: Record<string, unknown>;
  variables: Record<string, unknown>;
  correlationKey: string | null;
  parentInstanceId: string | null;
  parentTokenId: string | null;
  startedBy: string | null;
  occVersion: number;
  startedAt: Date;
  completedAt: Date | null;
  updatedAt: Date;
}

export interface ExecutionToken {
  id: string;
  instanceId: string;
  currentNodeId: string;
  parentTokenId: string | null;
  joinGroupId: string | null;
  status: TokenStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface StepExecution {
  id: string;
  instanceId: string;
  tokenId: string;
  nodeId: string;
  nodeType: string;
  nodeName: string;
  status: StepStatus;
  attempt: number;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  errorMessage: string | null;
  compensateNodeId: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
}

export interface UserTask {
  id: string;
  tenantId: string;
  instanceId: string;
  tokenId: string;
  nodeId: string;
  title: string;
  description: string;
  stage: string | null;
  candidateGroup: string | null;
  assignee: string | null;
  delegatedFrom: string | null;
  status: UserTaskStatus;
  formSchema: Record<string, unknown>;
  payload: Record<string, unknown>;
  resolution: Record<string, unknown> | null;
  requiredApprovals: number;
  approvalsReceived: TaskApprovalVote[];
  dueAt: Date | null;
  slaBreached: boolean;
  escalateTo: string | null;
  escalationLevel: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export interface CaseComment {
  id: string;
  instanceId: string;
  authorId: string;
  authorEmail: string;
  body: string;
  createdAt: Date;
}

export interface EventSubscription {
  id: string;
  instanceId: string;
  tokenId: string;
  nodeId: string;
  type: SubscriptionType;
  messageName: string | null;
  correlationKey: string | null;
  triggerAt: Date | null;
  status: SubscriptionStatus;
  payload: Record<string, unknown> | null;
  createdAt: Date;
  triggeredAt: Date | null;
}

export interface Incident {
  id: string;
  instanceId: string;
  tokenId: string;
  stepExecutionId: string | null;
  nodeId: string;
  incidentType: string;
  message: string;
  stackTrace: string | null;
  payloadSnapshot: Record<string, unknown>;
  status: IncidentStatus;
  resolvedBy: string | null;
  resolutionNote: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
}

export interface ExecutionJob {
  id: string;
  instanceId: string;
  tokenId: string;
  nodeId: string;
  jobType: JobType;
  payload: Record<string, unknown>;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  availableAt: Date;
  lockedBy: string | null;
  lockedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OutboxEvent {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  status: 'PENDING' | 'PUBLISHED' | 'FAILED';
  attempts: number;
  createdAt: Date;
  publishedAt: Date | null;
}

export type NotificationType =
  | 'TASK_ASSIGNED'
  | 'TASK_ESCALATED'
  | 'TASK_DELEGATED'
  | 'WORKFLOW_FAILED'
  | 'INFO';

export interface NotificationRecord {
  id: string;
  tenantId: string;
  recipientId: string;
  recipientGroup: string | null;
  title: string;
  message: string;
  type: NotificationType;
  taskId: string | null;
  instanceId: string | null;
  read: boolean;
  createdAt: Date;
  readAt: Date | null;
}

