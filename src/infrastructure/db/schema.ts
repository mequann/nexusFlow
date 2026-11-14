import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { TaskApprovalVote } from '../../domain/execution/types.js';
import type { WorkflowGraphDefinition } from '../../domain/workflow/types.js';

export const tenants = pgTable('tenants', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  plan: text('plan').notNull().default('ENTERPRISE'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  tenantId: text('tenant_id').notNull().default('default').references(() => tenants.id, { onDelete: 'cascade' }),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  department: text('department'),
  managerId: uuid('manager_id'),
  outOfOffice: boolean('out_of_office').notNull().default(false),
  delegateId: uuid('delegate_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey(),
  tenantId: text('tenant_id').notNull().default('default').references(() => tenants.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  keyPrefix: text('key_prefix').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  role: text('role').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const credentials = pgTable('credentials', {
  id: uuid('id').primaryKey(),
  tenantId: text('tenant_id').notNull().default('default').references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull().unique(),
  type: text('type').notNull(),
  keyId: text('key_id').notNull(),
  iv: text('iv').notNull(),
  authTag: text('auth_tag').notNull(),
  ciphertext: text('ciphertext').notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const workflows = pgTable(
  'workflows',
  {
    id: uuid('id').primaryKey(),
    tenantId: text('tenant_id').notNull().default('default').references(() => tenants.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    version: integer('version').notNull(),
    status: text('status').notNull(),
    definition: jsonb('definition').$type<WorkflowGraphDefinition>().notNull(),
    webhookPath: text('webhook_path'),
    webhookSecretHash: text('webhook_secret_hash'),
    cronExpression: text('cron_expression'),
    cronNextRunAt: timestamp('cron_next_run_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('workflows_key_version_uidx').on(table.key, table.version)],
);

export const workflowInstances = pgTable(
  'workflow_instances',
  {
    id: uuid('id').primaryKey(),
    tenantId: text('tenant_id').notNull().default('default').references(() => tenants.id, { onDelete: 'cascade' }),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id),
    workflowKey: text('workflow_key').notNull(),
    workflowVersion: integer('workflow_version').notNull(),
    status: text('status').notNull(),
    currentStage: text('current_stage'),
    slaStatus: text('sla_status').notNull().default('ON_TRACK'),
    triggerType: text('trigger_type').notNull(),
    triggerPayload: jsonb('trigger_payload').$type<Record<string, unknown>>().notNull().default({}),
    variables: jsonb('variables').$type<Record<string, unknown>>().notNull().default({}),
    correlationKey: text('correlation_key'),
    parentInstanceId: uuid('parent_instance_id'),
    parentTokenId: uuid('parent_token_id'),
    startedBy: text('started_by'),
    occVersion: integer('occ_version').notNull().default(1),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_instances_status').on(table.status, table.updatedAt),
    index('idx_instances_workflow').on(table.workflowId, table.startedAt),
  ],
);

export const executionTokens = pgTable(
  'execution_tokens',
  {
    id: uuid('id').primaryKey(),
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => workflowInstances.id, { onDelete: 'cascade' }),
    currentNodeId: text('current_node_id').notNull(),
    parentTokenId: uuid('parent_token_id'),
    joinGroupId: text('join_group_id'),
    status: text('status').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_tokens_instance').on(table.instanceId, table.status)],
);

export const stepExecutions = pgTable(
  'step_executions',
  {
    id: uuid('id').primaryKey(),
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => workflowInstances.id, { onDelete: 'cascade' }),
    tokenId: uuid('token_id')
      .notNull()
      .references(() => executionTokens.id, { onDelete: 'cascade' }),
    nodeId: text('node_id').notNull(),
    nodeType: text('node_type').notNull(),
    nodeName: text('node_name').notNull(),
    status: text('status').notNull(),
    attempt: integer('attempt').notNull().default(1),
    input: jsonb('input').$type<Record<string, unknown>>().notNull().default({}),
    output: jsonb('output').$type<Record<string, unknown> | null>(),
    errorMessage: text('error_message'),
    compensateNodeId: text('compensate_node_id'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
  },
  (table) => [index('idx_steps_instance').on(table.instanceId, table.startedAt)],
);

export const userTasks = pgTable(
  'user_tasks',
  {
    id: uuid('id').primaryKey(),
    tenantId: text('tenant_id').notNull().default('default').references(() => tenants.id, { onDelete: 'cascade' }),
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => workflowInstances.id, { onDelete: 'cascade' }),
    tokenId: uuid('token_id')
      .notNull()
      .references(() => executionTokens.id, { onDelete: 'cascade' }),
    nodeId: text('node_id').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    stage: text('stage'),
    candidateGroup: text('candidate_group'),
    assignee: text('assignee'),
    delegatedFrom: text('delegated_from'),
    status: text('status').notNull(),
    formSchema: jsonb('form_schema').$type<Record<string, unknown>>().notNull().default({}),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    resolution: jsonb('resolution').$type<Record<string, unknown> | null>(),
    requiredApprovals: integer('required_approvals').notNull().default(1),
    approvalsReceived: jsonb('approvals_received').$type<TaskApprovalVote[]>().notNull().default([]),
    dueAt: timestamp('due_at', { withTimezone: true }),
    slaBreached: boolean('sla_breached').notNull().default(false),
    escalateTo: text('escalate_to'),
    escalationLevel: integer('escalation_level').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_user_tasks_status').on(table.status, table.createdAt),
    index('idx_user_tasks_instance').on(table.instanceId),
    index('idx_user_tasks_sla').on(table.dueAt),
  ],
);

export const caseComments = pgTable(
  'case_comments',
  {
    id: uuid('id').primaryKey(),
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => workflowInstances.id, { onDelete: 'cascade' }),
    authorId: text('author_id').notNull(),
    authorEmail: text('author_email').notNull(),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_case_comments_instance').on(table.instanceId, table.createdAt)],
);

export const externalTasks = pgTable(
  'external_tasks',
  {
    id: uuid('id').primaryKey(),
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => workflowInstances.id, { onDelete: 'cascade' }),
    tokenId: uuid('token_id')
      .notNull()
      .references(() => executionTokens.id, { onDelete: 'cascade' }),
    nodeId: text('node_id').notNull(),
    topic: text('topic').notNull(),
    workerId: text('worker_id'),
    lockExpiresAt: timestamp('lock_expires_at', { withTimezone: true }),
    status: text('status').notNull(),
    variables: jsonb('variables').$type<Record<string, unknown>>().notNull().default({}),
    resultVariables: jsonb('result_variables').$type<Record<string, unknown> | null>(),
    retries: integer('retries').notNull().default(3),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_external_tasks_topic_poll').on(table.topic, table.createdAt)],
);

export const eventSubscriptions = pgTable('event_subscriptions', {
  id: uuid('id').primaryKey(),
  instanceId: uuid('instance_id')
    .notNull()
    .references(() => workflowInstances.id, { onDelete: 'cascade' }),
  tokenId: uuid('token_id')
    .notNull()
    .references(() => executionTokens.id, { onDelete: 'cascade' }),
  nodeId: text('node_id').notNull(),
  type: text('type').notNull(),
  messageName: text('message_name'),
  correlationKey: text('correlation_key'),
  triggerAt: timestamp('trigger_at', { withTimezone: true }),
  status: text('status').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown> | null>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  triggeredAt: timestamp('triggered_at', { withTimezone: true }),
});

export const incidents = pgTable(
  'incidents',
  {
    id: uuid('id').primaryKey(),
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => workflowInstances.id, { onDelete: 'cascade' }),
    tokenId: uuid('token_id')
      .notNull()
      .references(() => executionTokens.id, { onDelete: 'cascade' }),
    stepExecutionId: uuid('step_execution_id').references(() => stepExecutions.id, {
      onDelete: 'set null',
    }),
    nodeId: text('node_id').notNull(),
    incidentType: text('incident_type').notNull(),
    message: text('message').notNull(),
    stackTrace: text('stack_trace'),
    payloadSnapshot: jsonb('payload_snapshot').$type<Record<string, unknown>>().notNull().default({}),
    status: text('status').notNull(),
    resolvedBy: text('resolved_by'),
    resolutionNote: text('resolution_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => [index('idx_incidents_status').on(table.status, table.createdAt)],
);

export const executionJobs = pgTable('execution_jobs', {
  id: uuid('id').primaryKey(),
  instanceId: uuid('instance_id')
    .notNull()
    .references(() => workflowInstances.id, { onDelete: 'cascade' }),
  tokenId: uuid('token_id')
    .notNull()
    .references(() => executionTokens.id, { onDelete: 'cascade' }),
  nodeId: text('node_id').notNull(),
  jobType: text('job_type').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  status: text('status').notNull(),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
  lockedBy: text('locked_by'),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const outboxEvents = pgTable('outbox_events', {
  id: uuid('id').primaryKey(),
  aggregateType: text('aggregate_type').notNull(),
  aggregateId: text('aggregate_id').notNull(),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  status: text('status').notNull(),
  attempts: integer('attempts').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
});

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    key: text('key').notNull(),
    scope: text('scope').notNull(),
    requestHash: text('request_hash').notNull(),
    statusCode: integer('status_code').notNull(),
    responseBody: jsonb('response_body').$type<unknown>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.key, table.scope] })],
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey(),
    tenantId: text('tenant_id').notNull().default('default').references(() => tenants.id, { onDelete: 'cascade' }),
    recipientId: text('recipient_id').notNull(),
    recipientGroup: text('recipient_group'),
    title: text('title').notNull(),
    message: text('message').notNull(),
    type: text('type').notNull(),
    taskId: uuid('task_id').references(() => userTasks.id, { onDelete: 'cascade' }),
    instanceId: uuid('instance_id').references(() => workflowInstances.id, { onDelete: 'cascade' }),
    read: boolean('read').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_notifications_recipient').on(table.recipientId, table.read, table.createdAt),
  ],
);



export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey(),
    tenantId: text('tenant_id').notNull().default('default').references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    userEmail: text('user_email'),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id').notNull(),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_audit_logs_tenant_ts').on(table.tenantId, table.timestamp),
    index('idx_audit_logs_action').on(table.action),
    index('idx_audit_logs_resource').on(table.resourceType, table.resourceId),
  ],
);

export const storedFiles = pgTable(
  'stored_files',
  {
    id: uuid('id').primaryKey(),
    tenantId: text('tenant_id').notNull().default('default').references(() => tenants.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull().default('application/octet-stream'),
    sizeBytes: integer('size_bytes').notNull().default(0),
    checksumSha256: text('checksum_sha256').notNull(),
    storageDriver: text('storage_driver').notNull().default('local'),
    storagePath: text('storage_path').notNull(),
    contentData: text('content_data'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    uploadedBy: text('uploaded_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_stored_files_tenant').on(table.tenantId, table.createdAt),
    index('idx_stored_files_checksum').on(table.checksumSha256),
  ],
);
