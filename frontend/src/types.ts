export interface UserInfo {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'OPERATOR' | 'BUILDER' | 'VIEWER' | 'HR' | 'USER';
  department?: string;
}

export type AppPerspective = 'ADMIN' | 'HR' | 'USER';

export interface WorkflowNode {
  id: string;
  name: string;
  type: string;
  stage?: string;
  position?: { x: number; y: number };
  config: Record<string, unknown>;
  compensateNodeId?: string;
  isCompensationHandler?: boolean;
  outputKey?: string;
}

export interface WorkflowEdge {
  id: string;
  from: string;
  to: string;
  branch?: string;
  condition?: string;
}

export interface FormFieldRule {
  name: string;
  label?: string;
  type: 'text' | 'number' | 'currency' | 'boolean' | 'select' | 'date' | 'email';
  required?: boolean;
  min?: number;
  max?: number;
  options?: string[];
}

export interface WorkflowRecord {
  id: string;
  key: string;
  name: string;
  description: string;
  version: number;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  definition: {
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
    sagaEnabled?: boolean;
    stages?: string[];
    intakeFormSchema?: { title?: string; fields?: FormFieldRule[] };
  };
  webhookPath: string | null;
  cronExpression: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowInstance {
  id: string;
  workflowId: string;
  workflowKey: string;
  workflowVersion: number;
  status: string;
  currentStage: string | null;
  slaStatus: 'ON_TRACK' | 'BREACHED';
  triggerType: string;
  variables: Record<string, unknown>;
  occVersion: number;
  generation?: number;
  parentClosePolicy?: string;
  continuedFromInstanceId?: string;
  startedAt: string;
  completedAt: string | null;
}

export interface UserTask {
  id: string;
  instanceId: string;
  tokenId: string;
  nodeId: string;
  title: string;
  description: string;
  stage: string | null;
  candidateGroup: string | null;
  assignee: string | null;
  delegatedFrom: string | null;
  status: string;
  formSchema: { title?: string; fields?: FormFieldRule[] };
  payload: Record<string, unknown>;
  resolution: Record<string, unknown> | null;
  requiredApprovals: number;
  approvalsReceived: Array<{ userId: string; decision: string; decidedAt: string }>;
  dueAt: string | null;
  slaBreached: boolean;
  escalateTo: string | null;
  escalationLevel: number;
  createdAt: string;
}

export interface CaseComment {
  id: string;
  instanceId: string;
  authorId: string;
  authorEmail: string;
  body: string;
  createdAt: string;
}

export interface StepExecution {
  id: string;
  nodeId: string;
  nodeType: string;
  nodeName: string;
  status: string;
  attempt: number;
  output: Record<string, unknown> | null;
  errorMessage: string | null;
  durationMs: number | null;
  startedAt: string;
}

export interface ExecutionToken {
  id: string;
  currentNodeId: string;
  status: string;
}

export interface CaseSummary {
  instance: WorkflowInstance;
  stages: string[];
  currentStage: string | null;
  progressPercent: number;
  openTasks: UserTask[];
  completedSteps: StepExecution[];
  comments: CaseComment[];
}

export interface InstanceTrace {
  instance: WorkflowInstance;
  tokens: ExecutionToken[];
  steps: StepExecution[];
  tasks: UserTask[];
  incidents: Incident[];
}

export interface Incident {
  id: string;
  instanceId: string;
  nodeId: string;
  incidentType: string;
  message: string;
  status: 'OPEN' | 'RESOLVED' | 'DISMISSED';
  createdAt: string;
}

export interface ConnectorDescriptor {
  type: string;
  category: string;
  title: string;
  description: string;
  builtin: boolean;
  configSchema: Record<string, unknown>;
}

export interface MaskedCredential {
  id: string;
  name: string;
  type: string;
  keyId: string;
  createdAt: string;
}

export interface ExternalTask {
  id: string;
  instanceId: string;
  nodeId: string;
  topic: string;
  workerId: string | null;
  status: string;
  variables: Record<string, unknown>;
  retries: number;
  lastHeartbeatAt?: string | null;
  heartbeatTimeoutSeconds?: number | null;
  progress?: number | null;
}

export interface MinuteRecord {
  id: string;
  authorId: string;
  authorName: string;
  authorRole: string;
  department: string;
  actionTaken: 'FORWARDED' | 'RECOMMENDED' | 'APPROVED' | 'REJECTED' | 'COMMENT';
  comment: string;
  ethiopianDateStr: string;
  createdAt: string;
}

export interface DigitalSealInfo {
  algorithm: string;
  sealedBy: string;
  signatoryRole: string;
  digest: string;
  verificationUrl: string;
  qrData: string;
  sealedAtGregorian: string;
  sealedAtEthiopian: string;
}

export interface CorrespondenceItem {
  id: string;
  referenceNumber: string;
  type: 'INBOUND' | 'OUTBOUND' | 'INTERNAL_MEMO';
  subject: string;
  senderOrg: string;
  recipientOrg: string;
  urgency: 'NORMAL' | 'URGENT' | 'VERY_URGENT';
  classification: 'PUBLIC' | 'CONFIDENTIAL' | 'TOP_SECRET';
  status: 'DRAFT' | 'IN_REVIEW' | 'DIRECTOR_APPROVAL' | 'SEALED' | 'ARCHIVED';
  bodyHtml?: string;
  ethiopianDateStr: string;
  minutes: MinuteRecord[];
  digitalSeal?: DigitalSealInfo;
  createdAt: string;
}

export interface TenantImportValidationResult {
  valid: boolean;
  errors: string[];
  summary: {
    workflowCount: number;
    workflows: Array<{
      code: string;
      name: string;
      domainService: string;
      version: number;
      stepsCount: number;
      steps: Array<{
        stepOrder: number;
        code: string;
        name: string;
        collaborationMode: string;
        timeLimitHours: number;
        statuses: string[];
      }>;
    }>;
  };
}


