import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ErrorDetailDto {
  @ApiProperty({ type: String, example: 'VALIDATION_ERROR' })
  code!: string;

  @ApiProperty({ type: String, example: 'Request validation failed' })
  message!: string;

  @ApiPropertyOptional({
    type: 'array',
    items: { type: 'object' },
    example: [{ field: 'amount', message: "'amount' must be >= 1" }],
  })
  details?: unknown;

  @ApiPropertyOptional({ type: String, example: 'c4f5a2d1-8e1a-4b02-9a3f-12e456789abc' })
  correlationId?: string;

  @ApiProperty({ type: String, example: '/api/v1/workflows' })
  path!: string;
}

export class ErrorResponseDto {
  @ApiProperty({ type: () => ErrorDetailDto })
  error!: ErrorDetailDto;
}

export class HealthResponseDto {
  @ApiProperty({ type: String, example: 'ok' })
  status!: string;

  @ApiProperty({ type: String, example: '2026-11-10T10:00:00.000Z' })
  timestamp!: string;
}

export class ReadyResponseDto {
  @ApiProperty({ type: String, example: 'ready', enum: ['ready', 'unavailable'] })
  status!: string;

  @ApiProperty({ type: String, example: '2026-11-10T10:00:00.000Z' })
  timestamp!: string;
}

export class LoginRequestDto {
  @ApiProperty({ type: String, example: 'admin@nexusflow.local' })
  email!: string;

  @ApiProperty({ type: String, example: 'AdminChangeMe123!' })
  password!: string;
}

export class AuthenticatedUserDto {
  @ApiProperty({ type: String, example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  id!: string;

  @ApiProperty({ type: String, example: 'admin@nexusflow.local' })
  email!: string;

  @ApiProperty({ type: String, example: 'Platform Admin' })
  name!: string;

  @ApiProperty({ type: String, enum: ['ADMIN', 'OPERATOR', 'BUILDER', 'VIEWER'], example: 'ADMIN' })
  role!: string;
}

export class LoginResponseDto {
  @ApiProperty({ type: String, example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  accessToken!: string;

  @ApiProperty({ type: String, example: 'Bearer' })
  tokenType!: string;

  @ApiProperty({ type: Number, example: 3600 })
  expiresInSeconds!: number;

  @ApiProperty({ type: () => AuthenticatedUserDto })
  user!: AuthenticatedUserDto;
}

export class RegisterUserDto {
  @ApiProperty({ type: String, example: 'approver@nexusflow.local' })
  email!: string;

  @ApiProperty({ type: String, example: 'Finance Approver' })
  name!: string;

  @ApiProperty({ type: String, minLength: 8, example: 'StrongPass123!' })
  password!: string;

  @ApiProperty({ type: String, enum: ['ADMIN', 'OPERATOR', 'BUILDER', 'VIEWER'], example: 'OPERATOR' })
  role!: string;
}

export class UserResponseDto extends AuthenticatedUserDto {
  @ApiProperty({ type: Boolean, example: true })
  isActive!: boolean;

  @ApiProperty({ type: String, example: '2026-11-10T10:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ type: String, example: '2026-11-10T10:00:00.000Z' })
  updatedAt!: string;
}

export class CreateApiKeyDto {
  @ApiProperty({ type: String, example: 'erp-integration-bot' })
  name!: string;

  @ApiProperty({ type: String, enum: ['ADMIN', 'OPERATOR', 'BUILDER', 'VIEWER'], example: 'OPERATOR' })
  role!: string;

  @ApiPropertyOptional({ type: Number, example: 90, minimum: 1, maximum: 365 })
  expiresInDays?: number;
}

export class CreateApiKeyResponseDto {
  @ApiProperty({ type: String, example: 'a1b2c3d4-5717-4562-b3fc-2c963f66afa6' })
  id!: string;

  @ApiProperty({
    type: String,
    description: 'Raw API key (returned only once on creation)',
    example: 'nxf_9f8e7d6c5b4a3210fedcba9876543210abcdef1234567890',
  })
  rawKey!: string;

  @ApiProperty({ type: String, example: 'nxf_9f8e7d6c' })
  keyPrefix!: string;

  @ApiProperty({ type: String, enum: ['ADMIN', 'OPERATOR', 'BUILDER', 'VIEWER'], example: 'OPERATOR' })
  role!: string;
}

export class PrincipalDto {
  @ApiProperty({ type: String, example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  userId!: string;

  @ApiProperty({ type: String, example: 'admin@nexusflow.local' })
  email!: string;

  @ApiProperty({ type: String, enum: ['ADMIN', 'OPERATOR', 'BUILDER', 'VIEWER'], example: 'ADMIN' })
  role!: string;

  @ApiProperty({ type: String, enum: ['jwt', 'api_key'], example: 'jwt' })
  authType!: string;
}

export class MeResponseDto {
  @ApiProperty({ type: () => PrincipalDto })
  principal!: PrincipalDto;
}

export class RetryPolicyDto {
  @ApiProperty({ type: Number, example: 3 })
  maxAttempts!: number;

  @ApiProperty({ type: Number, example: 500 })
  initialDelayMs!: number;

  @ApiProperty({ type: Number, example: 2 })
  backoffMultiplier!: number;

  @ApiProperty({ type: Number, example: 30000 })
  maxDelayMs!: number;
}

export class WorkflowNodeDto {
  @ApiProperty({ type: String, example: 'finance_approval' })
  id!: string;

  @ApiProperty({ type: String, example: 'Finance Approval' })
  name!: string;

  @ApiProperty({
    type: String,
    enum: [
      'trigger.manual',
      'trigger.webhook',
      'trigger.cron',
      'action.http',
      'action.transform',
      'logic.if',
      'logic.switch',
      'logic.parallel',
      'logic.join',
      'bpmn.user_task',
      'bpmn.timer',
      'bpmn.message_catch',
      'bpmn.decision_table',
      'bpmn.end',
    ],
    example: 'bpmn.user_task',
  })
  type!: string;

  @ApiPropertyOptional({ type: String, example: 'Executive Approval' })
  stage?: string;

  @ApiProperty({
    type: Object,
    example: {
      title: 'Approve CapEx {{ $vars.poNumber }}',
      candidateGroup: 'finance',
      requiredApprovals: 1,
      slaMinutes: 60,
    },
  })
  config!: Record<string, unknown>;

  @ApiPropertyOptional({ type: () => RetryPolicyDto })
  retryPolicy?: RetryPolicyDto;

  @ApiPropertyOptional({ type: String, example: 'void_erp_po' })
  compensateNodeId?: string;

  @ApiPropertyOptional({ type: Boolean, example: false })
  isCompensationHandler?: boolean;

  @ApiPropertyOptional({ type: String, example: 'approvalResult' })
  outputKey?: string;
}

export class WorkflowEdgeDto {
  @ApiProperty({ type: String, example: 'e1' })
  id!: string;

  @ApiProperty({ type: String, example: 'intake' })
  from!: string;

  @ApiProperty({ type: String, example: 'finance_approval' })
  to!: string;

  @ApiPropertyOptional({ type: String, example: 'true' })
  branch?: string;

  @ApiPropertyOptional({ type: String, example: '$vars.amount >= 1000' })
  condition?: string;
}

export class WorkflowGraphDto {
  @ApiProperty({
    type: () => [WorkflowNodeDto],
    example: [
      { id: 'start', name: 'Intake', type: 'trigger.manual', stage: 'Intake', config: {} },
      {
        id: 'approve',
        name: 'Finance Approval',
        type: 'bpmn.user_task',
        stage: 'Approval',
        config: { title: 'Approve {{ $vars.poNumber }}', candidateGroup: 'finance' },
      },
      { id: 'end', name: 'Completed', type: 'bpmn.end', stage: 'Done', config: {} },
    ],
  })
  nodes!: WorkflowNodeDto[];

  @ApiProperty({
    type: () => [WorkflowEdgeDto],
    example: [
      { id: 'e1', from: 'start', to: 'approve' },
      { id: 'e2', from: 'approve', to: 'end' },
    ],
  })
  edges!: WorkflowEdgeDto[];

  @ApiPropertyOptional({ type: () => RetryPolicyDto })
  defaultRetryPolicy?: RetryPolicyDto;

  @ApiPropertyOptional({ type: Boolean, example: true })
  sagaEnabled?: boolean;

  @ApiPropertyOptional({ type: [String], example: ['Intake', 'Approval', 'Done'] })
  stages?: string[];

  @ApiPropertyOptional({
    type: Object,
    example: {
      fields: [
        { name: 'poNumber', type: 'text', required: true },
        { name: 'amount', type: 'currency', required: true, min: 1 },
      ],
    },
  })
  intakeFormSchema?: Record<string, unknown>;
}

export class CreateWorkflowDto {
  @ApiProperty({ type: String, example: 'procurement-capex-approval' })
  key!: string;

  @ApiProperty({ type: String, example: 'Enterprise Procurement & CapEx Approval' })
  name!: string;

  @ApiPropertyOptional({ type: String, example: 'Hybrid Camunda + n8n + Kissflow approval pipeline' })
  description?: string;

  @ApiProperty({ type: () => WorkflowGraphDto })
  definition!: WorkflowGraphDto;

  @ApiPropertyOptional({ type: String, example: 'whsec_change_me_123' })
  webhookSecret?: string;
}

export class UpdateWorkflowDto {
  @ApiPropertyOptional({ type: String, example: 'Enterprise Procurement & CapEx Approval v2' })
  name?: string;

  @ApiPropertyOptional({ type: String, example: 'Updated approval thresholds' })
  description?: string;

  @ApiPropertyOptional({ type: () => WorkflowGraphDto })
  definition?: WorkflowGraphDto;

  @ApiPropertyOptional({ type: String, example: 'whsec_new_secret_456' })
  webhookSecret?: string;
}

export class WorkflowResponseDto {
  @ApiProperty({ type: String, example: '0238655f-3914-4bbd-971c-17703d47fd00' })
  id!: string;

  @ApiProperty({ type: String, example: 'procurement-capex-approval' })
  key!: string;

  @ApiProperty({ type: String, example: 'Enterprise Procurement & CapEx Approval' })
  name!: string;

  @ApiProperty({ type: String, example: 'Hybrid Camunda + n8n + Kissflow approval pipeline' })
  description!: string;

  @ApiProperty({ type: Number, example: 1 })
  version!: number;

  @ApiProperty({ type: String, enum: ['DRAFT', 'PUBLISHED', 'ARCHIVED'], example: 'PUBLISHED' })
  status!: string;

  @ApiProperty({ type: () => WorkflowGraphDto })
  definition!: WorkflowGraphDto;

  @ApiPropertyOptional({ type: String, example: 'procurement/submit', nullable: true })
  webhookPath!: string | null;

  @ApiPropertyOptional({ type: String, example: null, nullable: true })
  cronExpression!: string | null;

  @ApiProperty({ type: String, example: '2026-11-10T10:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ type: String, example: '2026-11-10T10:00:00.000Z' })
  updatedAt!: string;
}

export class WorkflowListResponseDto {
  @ApiProperty({ type: () => [WorkflowResponseDto] })
  items!: WorkflowResponseDto[];
}

export class StartInstanceDto {
  @ApiPropertyOptional({ type: Number, example: 1 })
  version?: number;

  @ApiPropertyOptional({ type: Object, example: { source: 'portal', requestId: 'req-101' } })
  payload?: Record<string, unknown>;

  @ApiPropertyOptional({
    type: Object,
    example: {
      poNumber: 'PO-2026-088',
      vendorName: 'Dell Enterprise',
      amount: 40000,
      costCenter: 'CC-ENG',
    },
  })
  variables?: Record<string, unknown>;

  @ApiPropertyOptional({ type: String, example: 'PO-2026-088' })
  correlationKey?: string;
}

export class InstanceResponseDto {
  @ApiProperty({ type: String, example: 'b64d7c30-2d2a-4f7c-9c30-cf2310fb5a5f' })
  id!: string;

  @ApiProperty({ type: String, example: '0238655f-3914-4bbd-971c-17703d47fd00' })
  workflowId!: string;

  @ApiProperty({ type: String, example: 'procurement-capex-approval' })
  workflowKey!: string;

  @ApiProperty({ type: Number, example: 1 })
  workflowVersion!: number;

  @ApiProperty({
    type: String,
    enum: [
      'PENDING',
      'RUNNING',
      'WAITING',
      'INCIDENT_OPEN',
      'COMPENSATING',
      'COMPENSATED',
      'COMPLETED',
      'FAILED',
      'CANCELLED',
    ],
    example: 'WAITING',
  })
  status!: string;

  @ApiPropertyOptional({ type: String, example: 'Executive Approval', nullable: true })
  currentStage!: string | null;

  @ApiProperty({ type: String, enum: ['ON_TRACK', 'BREACHED'], example: 'ON_TRACK' })
  slaStatus!: string;

  @ApiProperty({ type: String, example: 'trigger.manual' })
  triggerType!: string;

  @ApiProperty({ type: Object, example: { poNumber: 'PO-2026-088', amount: 40000 } })
  variables!: Record<string, unknown>;

  @ApiProperty({ type: Number, example: 2 })
  occVersion!: number;

  @ApiProperty({ type: String, example: '2026-11-10T10:00:00.000Z' })
  startedAt!: string;

  @ApiPropertyOptional({ type: String, example: null, nullable: true })
  completedAt!: string | null;
}

export class InstanceListResponseDto {
  @ApiProperty({ type: () => [InstanceResponseDto] })
  items!: InstanceResponseDto[];
}

export class UserTaskResponseDto {
  @ApiProperty({ type: String, example: '7b92c4a1-1234-4abc-9def-0123456789ab' })
  id!: string;

  @ApiProperty({ type: String, example: 'b64d7c30-2d2a-4f7c-9c30-cf2310fb5a5f' })
  instanceId!: string;

  @ApiProperty({ type: String, example: 'finance_approval' })
  nodeId!: string;

  @ApiProperty({ type: String, example: 'Approve PO PO-2026-088 (Dell Enterprise)' })
  title!: string;

  @ApiPropertyOptional({ type: String, example: 'Executive Approval', nullable: true })
  stage!: string | null;

  @ApiPropertyOptional({ type: String, example: 'finance', nullable: true })
  candidateGroup!: string | null;

  @ApiPropertyOptional({ type: String, example: 'cfo@nexusflow.local', nullable: true })
  assignee!: string | null;

  @ApiPropertyOptional({ type: String, example: 'vp-eng@nexusflow.local', nullable: true })
  delegatedFrom!: string | null;

  @ApiProperty({
    type: String,
    enum: ['OPEN', 'CLAIMED', 'COMPLETED', 'REJECTED', 'CANCELLED', 'EXPIRED'],
    example: 'OPEN',
  })
  status!: string;

  @ApiProperty({ type: Number, example: 2 })
  requiredApprovals!: number;

  @ApiProperty({
    type: 'array',
    items: { type: 'object' },
    example: [{ userId: 'vp-eng', decision: 'APPROVED', decidedAt: '2026-11-10T10:05:00.000Z' }],
  })
  approvalsReceived!: unknown[];

  @ApiProperty({ type: Boolean, example: false })
  slaBreached!: boolean;

  @ApiPropertyOptional({ type: String, example: '2026-11-10T11:00:00.000Z', nullable: true })
  dueAt!: string | null;
}

export class UserTaskListResponseDto {
  @ApiProperty({ type: () => [UserTaskResponseDto] })
  items!: UserTaskResponseDto[];
}

export class CompleteTaskDto {
  @ApiProperty({
    type: Object,
    example: { budgetCode: 'CAPEX-2026-Q4', note: 'Approved within Q4 infrastructure budget' },
  })
  resolution!: Record<string, unknown>;
}

export class DelegateTaskDto {
  @ApiProperty({ type: String, example: 'vp-backup@nexusflow.local' })
  toAssignee!: string;

  @ApiPropertyOptional({ type: String, example: 'Out of office until Friday' })
  reason?: string;
}

export class CaseCommentResponseDto {
  @ApiProperty({ type: String, example: '9c1d2e3f-4567-4890-abcd-ef0123456789' })
  id!: string;

  @ApiProperty({ type: String, example: 'b64d7c30-2d2a-4f7c-9c30-cf2310fb5a5f' })
  instanceId!: string;

  @ApiProperty({ type: String, example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  authorId!: string;

  @ApiProperty({ type: String, example: 'admin@nexusflow.local' })
  authorEmail!: string;

  @ApiProperty({ type: String, example: 'Confirmed vendor quote matches Q4 CapEx plan.' })
  body!: string;

  @ApiProperty({ type: String, example: '2026-11-10T10:10:00.000Z' })
  createdAt!: string;
}

export class CaseCommentListResponseDto {
  @ApiProperty({ type: () => [CaseCommentResponseDto] })
  items!: CaseCommentResponseDto[];
}

export class AddCommentDto {
  @ApiProperty({ type: String, example: 'Confirmed vendor quote matches Q4 CapEx plan.' })
  body!: string;
}

export class CaseSummaryResponseDto {
  @ApiProperty({ type: () => InstanceResponseDto })
  instance!: InstanceResponseDto;

  @ApiProperty({
    type: [String],
    example: ['Intake', 'Spend Policy', 'Executive Approval', 'ERP Fulfillment', 'Completed'],
  })
  stages!: string[];

  @ApiPropertyOptional({ type: String, example: 'Executive Approval', nullable: true })
  currentStage!: string | null;

  @ApiProperty({ type: Number, example: 60 })
  progressPercent!: number;

  @ApiProperty({ type: () => [UserTaskResponseDto] })
  openTasks!: UserTaskResponseDto[];

  @ApiProperty({ type: 'array', items: { type: 'object' }, example: [] })
  completedSteps!: Record<string, unknown>[];

  @ApiProperty({ type: () => [CaseCommentResponseDto] })
  comments!: CaseCommentResponseDto[];
}

export class IncidentResponseDto {
  @ApiProperty({ type: String, example: '69df0788-fe2d-43a7-b826-9732deb718fe' })
  id!: string;

  @ApiProperty({ type: String, example: '97d2ba45-8609-4bb4-bc9d-aedbbd3233ed' })
  instanceId!: string;

  @ApiProperty({ type: String, example: 'create_erp_po' })
  nodeId!: string;

  @ApiProperty({ type: String, example: 'ExternalServiceError' })
  incidentType!: string;

  @ApiProperty({ type: String, example: 'HTTP 503 from erp.internal' })
  message!: string;

  @ApiProperty({ type: String, enum: ['OPEN', 'RESOLVED', 'DISMISSED'], example: 'OPEN' })
  status!: string;

  @ApiProperty({ type: String, example: '2026-11-10T10:15:00.000Z' })
  createdAt!: string;
}

export class IncidentListResponseDto {
  @ApiProperty({ type: () => [IncidentResponseDto] })
  items!: IncidentResponseDto[];
}

export class ResolveIncidentDto {
  @ApiProperty({ type: String, enum: ['RETRY', 'COMPENSATE', 'FAIL'], example: 'RETRY' })
  action!: 'RETRY' | 'COMPENSATE' | 'FAIL';

  @ApiPropertyOptional({ type: String, example: 'ERP service recovered; retrying step' })
  note?: string;

  @ApiPropertyOptional({ type: Object, example: { retryEndpoint: 'https://erp.acme.io/v2/po' } })
  variablesPatch?: Record<string, unknown>;
}

export class InstanceTraceResponseDto {
  @ApiProperty({ type: () => InstanceResponseDto })
  instance!: InstanceResponseDto;

  @ApiProperty({
    type: 'array',
    items: { type: 'object' },
    example: [{ id: 'tok-1', currentNodeId: 'finance_approval', status: 'WAITING' }],
  })
  tokens!: Record<string, unknown>[];

  @ApiProperty({
    type: 'array',
    items: { type: 'object' },
    example: [{ id: 'step-1', nodeId: 'spend_policy_dmn', status: 'COMPLETED', durationMs: 4 }],
  })
  steps!: Record<string, unknown>[];

  @ApiProperty({ type: () => [UserTaskResponseDto] })
  tasks!: UserTaskResponseDto[];

  @ApiProperty({ type: 'array', items: { type: 'object' }, example: [] })
  subscriptions!: Record<string, unknown>[];

  @ApiProperty({ type: () => [IncidentResponseDto] })
  incidents!: IncidentResponseDto[];
}

export class CorrelateMessageDto {
  @ApiProperty({ type: String, example: 'goods.received' })
  messageName!: string;

  @ApiProperty({ type: String, example: 'PO-2026-088' })
  correlationKey!: string;

  @ApiProperty({ type: Object, example: { receivedBy: 'warehouse-1', packingSlip: 'PS-991' } })
  payload!: Record<string, unknown>;
}

export class CorrelateMessageResponseDto {
  @ApiProperty({ type: Number, example: 1 })
  matchedSubscriptions!: number;

  @ApiProperty({ type: [String], example: ['b64d7c30-2d2a-4f7c-9c30-cf2310fb5a5f'] })
  resumedInstanceIds!: string[];
}

export class CreateCredentialDto {
  @ApiProperty({ type: String, example: 'erp_prod_bearer' })
  name!: string;

  @ApiProperty({ type: String, enum: ['bearer', 'api_key', 'basic', 'custom'], example: 'bearer' })
  type!: 'bearer' | 'api_key' | 'basic' | 'custom';

  @ApiProperty({ type: Object, example: { token: 'sk_live_replace_me' } })
  secretData!: Record<string, unknown>;
}

export class MaskedCredentialResponseDto {
  @ApiProperty({ type: String, example: 'd1e2f3a4-5678-4901-abcd-1234567890ef' })
  id!: string;

  @ApiProperty({ type: String, example: 'erp_prod_bearer' })
  name!: string;

  @ApiProperty({ type: String, enum: ['bearer', 'api_key', 'basic', 'custom'], example: 'bearer' })
  type!: string;

  @ApiProperty({ type: String, example: 'v1' })
  keyId!: string;

  @ApiProperty({ type: String, example: '2026-11-10T10:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ type: String, example: '2026-11-10T10:00:00.000Z' })
  updatedAt!: string;
}

export class MaskedCredentialListResponseDto {
  @ApiProperty({ type: () => [MaskedCredentialResponseDto] })
  items!: MaskedCredentialResponseDto[];
}

export class WebhookTriggerPayloadDto {
  @ApiProperty({ type: String, example: 'PO-2026-088' })
  poNumber!: string;

  @ApiProperty({ type: String, example: 'Dell Enterprise' })
  vendorName!: string;

  @ApiProperty({ type: Number, example: 40000 })
  amount!: number;

  @ApiProperty({ type: String, example: 'CC-ENG' })
  costCenter!: string;
}

export class WebhookAcceptedResponseDto {
  @ApiProperty({ type: Boolean, example: true })
  accepted!: boolean;

  @ApiProperty({ type: String, example: 'b64d7c30-2d2a-4f7c-9c30-cf2310fb5a5f' })
  instanceId!: string;

  @ApiProperty({ type: String, example: 'procurement-capex-approval' })
  workflowKey!: string;

  @ApiProperty({ type: Number, example: 1 })
  workflowVersion!: number;
}

export class ConnectorDescriptorDto {
  @ApiProperty({ type: String, example: 'kissflow.approval_matrix' })
  type!: string;

  @ApiProperty({
    type: String,
    enum: ['trigger', 'action', 'logic', 'bpmn', 'kissflow', 'custom'],
    example: 'kissflow',
  })
  category!: string;

  @ApiProperty({ type: String, example: 'Dynamic Kissflow Approval Matrix' })
  title!: string;

  @ApiProperty({
    type: String,
    example: 'Dynamically resolves approver, candidateGroup, quorum, and SLA from runtime rules',
  })
  description!: string;

  @ApiProperty({ type: Boolean, example: true })
  builtin!: boolean;

  @ApiProperty({ type: Object, example: { rules: 'Array', defaultRule: 'object' } })
  configSchema!: Record<string, unknown>;
}

export class ConnectorListResponseDto {
  @ApiProperty({ type: () => [ConnectorDescriptorDto] })
  items!: ConnectorDescriptorDto[];
}

export class RegisterHttpConnectorDto {
  @ApiProperty({ type: String, example: 'connector.slack_webhook' })
  type!: string;

  @ApiProperty({ type: String, example: 'Slack Channel Notifier' })
  title!: string;

  @ApiProperty({ type: String, example: 'Posts workflow alerts to a configured Slack webhook' })
  description!: string;

  @ApiProperty({ type: String, example: 'https://hooks.slack.com/services/T000/B000/XXXX' })
  endpointUrl!: string;

  @ApiPropertyOptional({ type: String, enum: ['POST', 'PUT', 'PATCH'], example: 'POST' })
  method?: string;

  @ApiPropertyOptional({ type: String, example: 'slack_bot_token' })
  credentialName?: string;

  @ApiPropertyOptional({ type: Object, example: { 'x-source': 'nexusflow' } })
  defaultHeaders?: Record<string, string>;
}

export class FetchAndLockExternalTasksDto {
  @ApiProperty({ type: String, example: 'sap-erp-worker-01' })
  workerId!: string;

  @ApiProperty({ type: [String], example: ['erp.create_invoice', 'external.ai_score'] })
  topics!: string[];

  @ApiPropertyOptional({ type: Number, example: 10 })
  maxTasks?: number;

  @ApiPropertyOptional({ type: Number, example: 30000 })
  lockDurationMs?: number;
}

export class ExternalTaskResponseDto {
  @ApiProperty({ type: String, example: 'e4d3c2b1-1234-4abc-9def-0123456789ab' })
  id!: string;

  @ApiProperty({ type: String, example: 'b64d7c30-2d2a-4f7c-9c30-cf2310fb5a5f' })
  instanceId!: string;

  @ApiProperty({ type: String, example: 'erp_invoice_step' })
  nodeId!: string;

  @ApiProperty({ type: String, example: 'erp.create_invoice' })
  topic!: string;

  @ApiPropertyOptional({ type: String, example: 'sap-erp-worker-01', nullable: true })
  workerId!: string | null;

  @ApiProperty({ type: String, enum: ['OPEN', 'LOCKED', 'COMPLETED', 'FAILED'], example: 'LOCKED' })
  status!: string;

  @ApiProperty({ type: Object, example: { poNumber: 'PO-2026-088', amount: 40000 } })
  variables!: Record<string, unknown>;

  @ApiProperty({ type: Number, example: 3 })
  retries!: number;
}

export class ExternalTaskListResponseDto {
  @ApiProperty({ type: () => [ExternalTaskResponseDto] })
  items!: ExternalTaskResponseDto[];
}

export class CompleteExternalTaskDto {
  @ApiProperty({ type: String, example: 'sap-erp-worker-01' })
  workerId!: string;

  @ApiProperty({ type: Object, example: { erpInvoiceId: 'INV-9001', posted: true } })
  variables!: Record<string, unknown>;
}

export class FailExternalTaskDto {
  @ApiProperty({ type: String, example: 'sap-erp-worker-01' })
  workerId!: string;

  @ApiProperty({ type: String, example: 'SAP BAPI timeout' })
  errorMessage!: string;

  @ApiPropertyOptional({ type: Number, example: 2 })
  retriesRemaining?: number;
}

export class PatchInstanceVariablesDto {
  @ApiProperty({ type: Object, example: { priority: 'CRITICAL', overrideLimit: true } })
  variables!: Record<string, unknown>;
}

export class MoveTokenDto {
  @ApiProperty({ type: String, example: 'tok-123' })
  tokenId!: string;

  @ApiProperty({ type: String, example: 'erp_fulfillment' })
  targetNodeId!: string;

  @ApiPropertyOptional({ type: String, example: 'Skip manual review per VP override' })
  reason?: string;
}

export class ExecutionTokenResponseDto {
  @ApiProperty({ type: String, example: 'tok-123' })
  id!: string;

  @ApiProperty({ type: String, example: 'b64d7c30-2d2a-4f7c-9c30-cf2310fb5a5f' })
  instanceId!: string;

  @ApiProperty({ type: String, example: 'erp_fulfillment' })
  currentNodeId!: string;

  @ApiProperty({
    type: String,
    enum: ['ACTIVE', 'WAITING', 'COMPLETED', 'FAILED', 'CANCELLED'],
    example: 'ACTIVE',
  })
  status!: string;
}
