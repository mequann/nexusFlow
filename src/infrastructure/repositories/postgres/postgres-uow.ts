import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { ConflictError, NotFoundError } from '../../../domain/errors.js';
import type {
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
import type { ApiKeyRecord, CredentialRecord, Role, UserRecord } from '../../../domain/security/types.js';
import type { WorkflowDefinitionRecord, WorkflowGraphDefinition, WorkflowStatus } from '../../../domain/workflow/types.js';

interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
}

function mapWorkflow(row: Record<string, unknown>): WorkflowDefinitionRecord {
  return {
    id: String(row.id),
    key: String(row.key),
    name: String(row.name),
    description: String(row.description ?? ''),
    version: Number(row.version),
    status: row.status as WorkflowStatus,
    definition: row.definition as WorkflowGraphDefinition,
    webhookPath: (row.webhook_path as string | null) ?? null,
    webhookSecretHash: (row.webhook_secret_hash as string | null) ?? null,
    cronExpression: (row.cron_expression as string | null) ?? null,
    cronNextRunAt: row.cron_next_run_at ? new Date(String(row.cron_next_run_at)) : null,
    createdBy: (row.created_by as string | null) ?? null,
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
  };
}

function mapInstance(row: Record<string, unknown>): WorkflowInstance {
  return {
    id: String(row.id),
    workflowId: String(row.workflow_id),
    workflowKey: String(row.workflow_key),
    workflowVersion: Number(row.workflow_version),
    status: row.status as WorkflowInstance['status'],
    triggerType: String(row.trigger_type),
    triggerPayload: (row.trigger_payload as Record<string, unknown>) ?? {},
    variables: (row.variables as Record<string, unknown>) ?? {},
    correlationKey: (row.correlation_key as string | null) ?? null,
    startedBy: (row.started_by as string | null) ?? null,
    occVersion: Number(row.occ_version),
    startedAt: new Date(String(row.started_at)),
    completedAt: row.completed_at ? new Date(String(row.completed_at)) : null,
    updatedAt: new Date(String(row.updated_at)),
  };
}

function mapToken(row: Record<string, unknown>): ExecutionToken {
  return {
    id: String(row.id),
    instanceId: String(row.instance_id),
    currentNodeId: String(row.current_node_id),
    parentTokenId: (row.parent_token_id as string | null) ?? null,
    joinGroupId: (row.join_group_id as string | null) ?? null,
    status: row.status as ExecutionToken['status'],
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
  };
}

function mapStep(row: Record<string, unknown>): StepExecution {
  return {
    id: String(row.id),
    instanceId: String(row.instance_id),
    tokenId: String(row.token_id),
    nodeId: String(row.node_id),
    nodeType: String(row.node_type),
    nodeName: String(row.node_name),
    status: row.status as StepExecution['status'],
    attempt: Number(row.attempt),
    input: (row.input as Record<string, unknown>) ?? {},
    output: (row.output as Record<string, unknown> | null) ?? null,
    errorMessage: (row.error_message as string | null) ?? null,
    compensateNodeId: (row.compensate_node_id as string | null) ?? null,
    startedAt: new Date(String(row.started_at)),
    finishedAt: row.finished_at ? new Date(String(row.finished_at)) : null,
    durationMs: row.duration_ms !== null && row.duration_ms !== undefined ? Number(row.duration_ms) : null,
  };
}

function mapTask(row: Record<string, unknown>): UserTask {
  return {
    id: String(row.id),
    instanceId: String(row.instance_id),
    tokenId: String(row.token_id),
    nodeId: String(row.node_id),
    title: String(row.title),
    description: String(row.description ?? ''),
    candidateGroup: (row.candidate_group as string | null) ?? null,
    assignee: (row.assignee as string | null) ?? null,
    status: row.status as UserTask['status'],
    formSchema: (row.form_schema as Record<string, unknown>) ?? {},
    payload: (row.payload as Record<string, unknown>) ?? {},
    resolution: (row.resolution as Record<string, unknown> | null) ?? null,
    dueAt: row.due_at ? new Date(String(row.due_at)) : null,
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
    completedAt: row.completed_at ? new Date(String(row.completed_at)) : null,
  };
}

function mapSubscription(row: Record<string, unknown>): EventSubscription {
  return {
    id: String(row.id),
    instanceId: String(row.instance_id),
    tokenId: String(row.token_id),
    nodeId: String(row.node_id),
    type: row.type as EventSubscription['type'],
    messageName: (row.message_name as string | null) ?? null,
    correlationKey: (row.correlation_key as string | null) ?? null,
    triggerAt: row.trigger_at ? new Date(String(row.trigger_at)) : null,
    status: row.status as EventSubscription['status'],
    payload: (row.payload as Record<string, unknown> | null) ?? null,
    createdAt: new Date(String(row.created_at)),
    triggeredAt: row.triggered_at ? new Date(String(row.triggered_at)) : null,
  };
}

function mapIncident(row: Record<string, unknown>): Incident {
  return {
    id: String(row.id),
    instanceId: String(row.instance_id),
    tokenId: String(row.token_id),
    stepExecutionId: (row.step_execution_id as string | null) ?? null,
    nodeId: String(row.node_id),
    incidentType: String(row.incident_type),
    message: String(row.message),
    stackTrace: (row.stack_trace as string | null) ?? null,
    payloadSnapshot: (row.payload_snapshot as Record<string, unknown>) ?? {},
    status: row.status as Incident['status'],
    resolvedBy: (row.resolved_by as string | null) ?? null,
    resolutionNote: (row.resolution_note as string | null) ?? null,
    createdAt: new Date(String(row.created_at)),
    resolvedAt: row.resolved_at ? new Date(String(row.resolved_at)) : null,
  };
}

function mapJob(row: Record<string, unknown>): ExecutionJob {
  return {
    id: String(row.id),
    instanceId: String(row.instance_id),
    tokenId: String(row.token_id),
    nodeId: String(row.node_id),
    jobType: row.job_type as ExecutionJob['jobType'],
    payload: (row.payload as Record<string, unknown>) ?? {},
    status: row.status as ExecutionJob['status'],
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    availableAt: new Date(String(row.available_at)),
    lockedBy: (row.locked_by as string | null) ?? null,
    lockedAt: row.locked_at ? new Date(String(row.locked_at)) : null,
    lastError: (row.last_error as string | null) ?? null,
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
  };
}

function mapOutbox(row: Record<string, unknown>): OutboxEvent {
  return {
    id: String(row.id),
    aggregateType: String(row.aggregate_type),
    aggregateId: String(row.aggregate_id),
    eventType: String(row.event_type),
    payload: (row.payload as Record<string, unknown>) ?? {},
    status: row.status as OutboxEvent['status'],
    attempts: Number(row.attempts),
    createdAt: new Date(String(row.created_at)),
    publishedAt: row.published_at ? new Date(String(row.published_at)) : null,
  };
}

function mapCredential(row: Record<string, unknown>): CredentialRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    type: row.type as CredentialRecord['type'],
    keyId: String(row.key_id),
    iv: String(row.iv),
    authTag: String(row.auth_tag),
    ciphertext: String(row.ciphertext),
    createdBy: (row.created_by as string | null) ?? null,
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
  };
}

function mapUser(row: Record<string, unknown>): UserRecord {
  return {
    id: String(row.id),
    email: String(row.email),
    name: String(row.name),
    passwordHash: String(row.password_hash),
    role: row.role as Role,
    isActive: Boolean(row.is_active),
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
  };
}

function mapApiKey(row: Record<string, unknown>): ApiKeyRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    name: String(row.name),
    keyPrefix: String(row.key_prefix),
    keyHash: String(row.key_hash),
    role: row.role as Role,
    expiresAt: row.expires_at ? new Date(String(row.expires_at)) : null,
    lastUsedAt: row.last_used_at ? new Date(String(row.last_used_at)) : null,
    createdAt: new Date(String(row.created_at)),
  };
}

function buildRegistry(db: Queryable): IRepositoryRegistry {
  const workflows: IWorkflowRepository = {
    create: async (record) => {
      try {
        const res = await db.query(
          `INSERT INTO workflows (id, key, name, description, version, status, definition, webhook_path, webhook_secret_hash, cron_expression, cron_next_run_at, created_by, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
          [
            record.id,
            record.key,
            record.name,
            record.description,
            record.version,
            record.status,
            JSON.stringify(record.definition),
            record.webhookPath,
            record.webhookSecretHash,
            record.cronExpression,
            record.cronNextRunAt,
            record.createdBy,
            record.createdAt,
            record.updatedAt,
          ],
        );
        return mapWorkflow(res.rows[0]!);
      } catch (err: unknown) {
        if ((err as { code?: string }).code === '23505') {
          throw new ConflictError(`Workflow '${record.key}' v${record.version} already exists`);
        }
        throw err;
      }
    },
    findById: async (id) => {
      const res = await db.query('SELECT * FROM workflows WHERE id = $1', [id]);
      return res.rows[0] ? mapWorkflow(res.rows[0]) : null;
    },
    findLatestByKey: async (key, status) => {
      const res = status
        ? await db.query(
            'SELECT * FROM workflows WHERE key = $1 AND status = $2 ORDER BY version DESC LIMIT 1',
            [key, status],
          )
        : await db.query(
            'SELECT * FROM workflows WHERE key = $1 ORDER BY version DESC LIMIT 1',
            [key],
          );
      return res.rows[0] ? mapWorkflow(res.rows[0]) : null;
    },
    findByKeyAndVersion: async (key, version) => {
      const res = await db.query('SELECT * FROM workflows WHERE key = $1 AND version = $2', [
        key,
        version,
      ]);
      return res.rows[0] ? mapWorkflow(res.rows[0]) : null;
    },
    findByWebhookPath: async (webhookPath) => {
      const res = await db.query(
        `SELECT * FROM workflows WHERE status = 'PUBLISHED' AND webhook_path = $1 ORDER BY version DESC LIMIT 1`,
        [webhookPath],
      );
      return res.rows[0] ? mapWorkflow(res.rows[0]) : null;
    },
    findDueCronWorkflows: async (now) => {
      const res = await db.query(
        `SELECT * FROM workflows WHERE status = 'PUBLISHED' AND cron_expression IS NOT NULL AND cron_next_run_at <= $1`,
        [now],
      );
      return res.rows.map(mapWorkflow);
    },
    list: async (filters) => {
      const clauses: string[] = [];
      const params: unknown[] = [];
      if (filters?.status) {
        params.push(filters.status);
        clauses.push(`status = $${params.length}`);
      }
      if (filters?.key) {
        params.push(filters.key);
        clauses.push(`key = $${params.length}`);
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const res = await db.query(
        `SELECT * FROM workflows ${where} ORDER BY updated_at DESC`,
        params,
      );
      return res.rows.map(mapWorkflow);
    },
    update: async (record) => {
      const res = await db.query(
        `UPDATE workflows SET name=$2, description=$3, status=$4, definition=$5, webhook_path=$6, webhook_secret_hash=$7, cron_expression=$8, cron_next_run_at=$9, updated_at=$10
         WHERE id = $1 RETURNING *`,
        [
          record.id,
          record.name,
          record.description,
          record.status,
          JSON.stringify(record.definition),
          record.webhookPath,
          record.webhookSecretHash,
          record.cronExpression,
          record.cronNextRunAt,
          record.updatedAt,
        ],
      );
      if (!res.rows[0]) throw new NotFoundError('Workflow', record.id);
      return mapWorkflow(res.rows[0]);
    },
    getNextVersion: async (key) => {
      const res = await db.query<{ max_ver: number | null }>(
        'SELECT MAX(version) AS max_ver FROM workflows WHERE key = $1',
        [key],
      );
      return Number(res.rows[0]?.max_ver ?? 0) + 1;
    },
  };

  const instances: IInstanceRepository = {
    create: async (inst) => {
      const res = await db.query(
        `INSERT INTO workflow_instances (id, workflow_id, workflow_key, workflow_version, status, trigger_type, trigger_payload, variables, correlation_key, started_by, occ_version, started_at, completed_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [
          inst.id,
          inst.workflowId,
          inst.workflowKey,
          inst.workflowVersion,
          inst.status,
          inst.triggerType,
          JSON.stringify(inst.triggerPayload),
          JSON.stringify(inst.variables),
          inst.correlationKey,
          inst.startedBy,
          inst.occVersion,
          inst.startedAt,
          inst.completedAt,
          inst.updatedAt,
        ],
      );
      return mapInstance(res.rows[0]!);
    },
    findById: async (id) => {
      const res = await db.query('SELECT * FROM workflow_instances WHERE id = $1', [id]);
      return res.rows[0] ? mapInstance(res.rows[0]) : null;
    },
    list: async (filters) => {
      const clauses: string[] = [];
      const params: unknown[] = [];
      if (filters?.status) {
        params.push(filters.status);
        clauses.push(`status = $${params.length}`);
      }
      if (filters?.workflowKey) {
        params.push(filters.workflowKey);
        clauses.push(`workflow_key = $${params.length}`);
      }
      params.push(filters?.limit ?? 100);
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const res = await db.query(
        `SELECT * FROM workflow_instances ${where} ORDER BY started_at DESC LIMIT $${params.length}`,
        params,
      );
      return res.rows.map(mapInstance);
    },
    updateWithOcc: async (inst) => {
      const res = await db.query(
        `UPDATE workflow_instances
         SET status=$3, variables=$4, completed_at=$5, occ_version = occ_version + 1, updated_at = NOW()
         WHERE id = $1 AND occ_version = $2 RETURNING *`,
        [inst.id, inst.occVersion, inst.status, JSON.stringify(inst.variables), inst.completedAt],
      );
      if (!res.rows[0]) {
        throw new ConflictError(`Optimistic concurrency conflict or missing instance '${inst.id}'`);
      }
      return mapInstance(res.rows[0]);
    },
  };

  const tokens: ITokenRepository = {
    create: async (token) => {
      const res = await db.query(
        `INSERT INTO execution_tokens (id, instance_id, current_node_id, parent_token_id, join_group_id, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          token.id,
          token.instanceId,
          token.currentNodeId,
          token.parentTokenId,
          token.joinGroupId,
          token.status,
          token.createdAt,
          token.updatedAt,
        ],
      );
      return mapToken(res.rows[0]!);
    },
    findById: async (id) => {
      const res = await db.query('SELECT * FROM execution_tokens WHERE id = $1', [id]);
      return res.rows[0] ? mapToken(res.rows[0]) : null;
    },
    findByInstance: async (instanceId) => {
      const res = await db.query(
        'SELECT * FROM execution_tokens WHERE instance_id = $1 ORDER BY created_at ASC',
        [instanceId],
      );
      return res.rows.map(mapToken);
    },
    findWaitingAtNode: async (instanceId, nodeId) => {
      const res = await db.query(
        `SELECT * FROM execution_tokens WHERE instance_id = $1 AND current_node_id = $2 AND status = 'WAITING'`,
        [instanceId, nodeId],
      );
      return res.rows.map(mapToken);
    },
    update: async (token) => {
      const res = await db.query(
        `UPDATE execution_tokens SET current_node_id=$2, status=$3, updated_at=NOW() WHERE id=$1 RETURNING *`,
        [token.id, token.currentNodeId, token.status],
      );
      if (!res.rows[0]) throw new NotFoundError('ExecutionToken', token.id);
      return mapToken(res.rows[0]);
    },
  };

  const steps: IStepRepository = {
    create: async (step) => {
      const res = await db.query(
        `INSERT INTO step_executions (id, instance_id, token_id, node_id, node_type, node_name, status, attempt, input, output, error_message, compensate_node_id, started_at, finished_at, duration_ms)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
        [
          step.id,
          step.instanceId,
          step.tokenId,
          step.nodeId,
          step.nodeType,
          step.nodeName,
          step.status,
          step.attempt,
          JSON.stringify(step.input),
          step.output ? JSON.stringify(step.output) : null,
          step.errorMessage,
          step.compensateNodeId,
          step.startedAt,
          step.finishedAt,
          step.durationMs,
        ],
      );
      return mapStep(res.rows[0]!);
    },
    findById: async (id) => {
      const res = await db.query('SELECT * FROM step_executions WHERE id = $1', [id]);
      return res.rows[0] ? mapStep(res.rows[0]) : null;
    },
    findByInstance: async (instanceId) => {
      const res = await db.query(
        'SELECT * FROM step_executions WHERE instance_id = $1 ORDER BY started_at ASC',
        [instanceId],
      );
      return res.rows.map(mapStep);
    },
    update: async (step) => {
      const res = await db.query(
        `UPDATE step_executions SET status=$2, output=$3, error_message=$4, finished_at=$5, duration_ms=$6 WHERE id=$1 RETURNING *`,
        [
          step.id,
          step.status,
          step.output ? JSON.stringify(step.output) : null,
          step.errorMessage,
          step.finishedAt,
          step.durationMs,
        ],
      );
      if (!res.rows[0]) throw new NotFoundError('StepExecution', step.id);
      return mapStep(res.rows[0]);
    },
  };

  const userTasks: IUserTaskRepository = {
    create: async (t) => {
      const res = await db.query(
        `INSERT INTO user_tasks (id, instance_id, token_id, node_id, title, description, candidate_group, assignee, status, form_schema, payload, resolution, due_at, created_at, updated_at, completed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
        [
          t.id,
          t.instanceId,
          t.tokenId,
          t.nodeId,
          t.title,
          t.description,
          t.candidateGroup,
          t.assignee,
          t.status,
          JSON.stringify(t.formSchema),
          JSON.stringify(t.payload),
          t.resolution ? JSON.stringify(t.resolution) : null,
          t.dueAt,
          t.createdAt,
          t.updatedAt,
          t.completedAt,
        ],
      );
      return mapTask(res.rows[0]!);
    },
    findById: async (id) => {
      const res = await db.query('SELECT * FROM user_tasks WHERE id = $1', [id]);
      return res.rows[0] ? mapTask(res.rows[0]) : null;
    },
    list: async (filters) => {
      const clauses: string[] = [];
      const params: unknown[] = [];
      if (filters?.status) {
        params.push(filters.status);
        clauses.push(`status = $${params.length}`);
      }
      if (filters?.assignee) {
        params.push(filters.assignee);
        clauses.push(`assignee = $${params.length}`);
      }
      if (filters?.candidateGroup) {
        params.push(filters.candidateGroup);
        clauses.push(`candidate_group = $${params.length}`);
      }
      if (filters?.instanceId) {
        params.push(filters.instanceId);
        clauses.push(`instance_id = $${params.length}`);
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const res = await db.query(
        `SELECT * FROM user_tasks ${where} ORDER BY created_at DESC`,
        params,
      );
      return res.rows.map(mapTask);
    },
    update: async (t) => {
      const res = await db.query(
        `UPDATE user_tasks SET assignee=$2, status=$3, resolution=$4, completed_at=$5, updated_at=NOW() WHERE id=$1 RETURNING *`,
        [
          t.id,
          t.assignee,
          t.status,
          t.resolution ? JSON.stringify(t.resolution) : null,
          t.completedAt,
        ],
      );
      if (!res.rows[0]) throw new NotFoundError('UserTask', t.id);
      return mapTask(res.rows[0]);
    },
  };

  const subscriptions: ISubscriptionRepository = {
    create: async (s) => {
      const res = await db.query(
        `INSERT INTO event_subscriptions (id, instance_id, token_id, node_id, type, message_name, correlation_key, trigger_at, status, payload, created_at, triggered_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [
          s.id,
          s.instanceId,
          s.tokenId,
          s.nodeId,
          s.type,
          s.messageName,
          s.correlationKey,
          s.triggerAt,
          s.status,
          s.payload ? JSON.stringify(s.payload) : null,
          s.createdAt,
          s.triggeredAt,
        ],
      );
      return mapSubscription(res.rows[0]!);
    },
    findActiveMessage: async (messageName, correlationKey) => {
      const res = await db.query(
        `SELECT * FROM event_subscriptions WHERE status = 'ACTIVE' AND type = 'MESSAGE' AND message_name = $1 AND (correlation_key = $2 OR correlation_key IS NULL)`,
        [messageName, correlationKey],
      );
      return res.rows.map(mapSubscription);
    },
    findDueTimers: async (now, limit = 50) => {
      const res = await db.query(
        `SELECT * FROM event_subscriptions WHERE status = 'ACTIVE' AND type = 'TIMER' AND trigger_at <= $1 ORDER BY trigger_at ASC LIMIT $2`,
        [now, limit],
      );
      return res.rows.map(mapSubscription);
    },
    findByInstance: async (instanceId) => {
      const res = await db.query('SELECT * FROM event_subscriptions WHERE instance_id = $1', [
        instanceId,
      ]);
      return res.rows.map(mapSubscription);
    },
    update: async (s) => {
      const res = await db.query(
        `UPDATE event_subscriptions SET status=$2, payload=$3, triggered_at=$4 WHERE id=$1 RETURNING *`,
        [s.id, s.status, s.payload ? JSON.stringify(s.payload) : null, s.triggeredAt],
      );
      if (!res.rows[0]) throw new NotFoundError('EventSubscription', s.id);
      return mapSubscription(res.rows[0]);
    },
  };

  const incidents: IIncidentRepository = {
    create: async (inc) => {
      const res = await db.query(
        `INSERT INTO incidents (id, instance_id, token_id, step_execution_id, node_id, incident_type, message, stack_trace, payload_snapshot, status, resolved_by, resolution_note, created_at, resolved_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [
          inc.id,
          inc.instanceId,
          inc.tokenId,
          inc.stepExecutionId,
          inc.nodeId,
          inc.incidentType,
          inc.message,
          inc.stackTrace,
          JSON.stringify(inc.payloadSnapshot),
          inc.status,
          inc.resolvedBy,
          inc.resolutionNote,
          inc.createdAt,
          inc.resolvedAt,
        ],
      );
      return mapIncident(res.rows[0]!);
    },
    findById: async (id) => {
      const res = await db.query('SELECT * FROM incidents WHERE id = $1', [id]);
      return res.rows[0] ? mapIncident(res.rows[0]) : null;
    },
    list: async (filters) => {
      const clauses: string[] = [];
      const params: unknown[] = [];
      if (filters?.status) {
        params.push(filters.status);
        clauses.push(`status = $${params.length}`);
      }
      if (filters?.instanceId) {
        params.push(filters.instanceId);
        clauses.push(`instance_id = $${params.length}`);
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const res = await db.query(`SELECT * FROM incidents ${where} ORDER BY created_at DESC`, params);
      return res.rows.map(mapIncident);
    },
    update: async (inc) => {
      const res = await db.query(
        `UPDATE incidents SET status=$2, resolved_by=$3, resolution_note=$4, resolved_at=$5 WHERE id=$1 RETURNING *`,
        [inc.id, inc.status, inc.resolvedBy, inc.resolutionNote, inc.resolvedAt],
      );
      if (!res.rows[0]) throw new NotFoundError('Incident', inc.id);
      return mapIncident(res.rows[0]);
    },
  };

  const jobs: IJobRepository = {
    enqueue: async (job) => {
      const res = await db.query(
        `INSERT INTO execution_jobs (id, instance_id, token_id, node_id, job_type, payload, status, attempts, max_attempts, available_at, locked_by, locked_at, last_error, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
        [
          job.id,
          job.instanceId,
          job.tokenId,
          job.nodeId,
          job.jobType,
          JSON.stringify(job.payload),
          job.status,
          job.attempts,
          job.maxAttempts,
          job.availableAt,
          job.lockedBy,
          job.lockedAt,
          job.lastError,
          job.createdAt,
          job.updatedAt,
        ],
      );
      return mapJob(res.rows[0]!);
    },
    claimNextBatch: async (workerId, limit, now) => {
      const res = await db.query(
        `WITH next_jobs AS (
           SELECT id FROM execution_jobs
           WHERE status = 'PENDING' AND available_at <= $2
           ORDER BY available_at ASC
           LIMIT $3
           FOR UPDATE SKIP LOCKED
         )
         UPDATE execution_jobs j
         SET status = 'PROCESSING', locked_by = $1, locked_at = $2, updated_at = NOW()
         FROM next_jobs
         WHERE j.id = next_jobs.id
         RETURNING j.*`,
        [workerId, now, limit],
      );
      return res.rows.map(mapJob);
    },
    complete: async (jobId) => {
      await db.query(`UPDATE execution_jobs SET status = 'COMPLETED', updated_at = NOW() WHERE id = $1`, [
        jobId,
      ]);
    },
    reschedule: async (jobId, availableAt, attempts, lastError) => {
      await db.query(
        `UPDATE execution_jobs SET status = 'PENDING', available_at = $2, attempts = $3, last_error = $4, locked_by = NULL, locked_at = NULL, updated_at = NOW() WHERE id = $1`,
        [jobId, availableAt, attempts, lastError],
      );
    },
    markDead: async (jobId, attempts, lastError) => {
      await db.query(
        `UPDATE execution_jobs SET status = 'DEAD', attempts = $2, last_error = $3, updated_at = NOW() WHERE id = $1`,
        [jobId, attempts, lastError],
      );
    },
  };

  const outbox: IOutboxRepository = {
    append: async (event) => {
      const res = await db.query(
        `INSERT INTO outbox_events (id, aggregate_type, aggregate_id, event_type, payload, status, attempts, created_at, published_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          event.id,
          event.aggregateType,
          event.aggregateId,
          event.eventType,
          JSON.stringify(event.payload),
          event.status,
          event.attempts,
          event.createdAt,
          event.publishedAt,
        ],
      );
      return mapOutbox(res.rows[0]!);
    },
    fetchPending: async (limit) => {
      const res = await db.query(
        `SELECT * FROM outbox_events WHERE status = 'PENDING' ORDER BY created_at ASC LIMIT $1`,
        [limit],
      );
      return res.rows.map(mapOutbox);
    },
    markPublished: async (id, publishedAt) => {
      await db.query(`UPDATE outbox_events SET status = 'PUBLISHED', published_at = $2 WHERE id = $1`, [
        id,
        publishedAt,
      ]);
    },
    markFailed: async (id) => {
      await db.query(
        `UPDATE outbox_events SET attempts = attempts + 1, status = CASE WHEN attempts + 1 >= 5 THEN 'FAILED' ELSE 'PENDING' END WHERE id = $1`,
        [id],
      );
    },
  };

  const credentials: ICredentialRepository = {
    create: async (record) => {
      try {
        const res = await db.query(
          `INSERT INTO credentials (id, name, type, key_id, iv, auth_tag, ciphertext, created_by, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
          [
            record.id,
            record.name,
            record.type,
            record.keyId,
            record.iv,
            record.authTag,
            record.ciphertext,
            record.createdBy,
            record.createdAt,
            record.updatedAt,
          ],
        );
        return mapCredential(res.rows[0]!);
      } catch (err: unknown) {
        if ((err as { code?: string }).code === '23505') {
          throw new ConflictError(`Credential '${record.name}' already exists`);
        }
        throw err;
      }
    },
    findById: async (id) => {
      const res = await db.query('SELECT * FROM credentials WHERE id = $1', [id]);
      return res.rows[0] ? mapCredential(res.rows[0]) : null;
    },
    findByName: async (name) => {
      const res = await db.query('SELECT * FROM credentials WHERE name = $1', [name]);
      return res.rows[0] ? mapCredential(res.rows[0]) : null;
    },
    list: async () => {
      const res = await db.query('SELECT * FROM credentials ORDER BY created_at DESC');
      return res.rows.map(mapCredential);
    },
    update: async (record) => {
      const res = await db.query(
        `UPDATE credentials SET key_id=$2, iv=$3, auth_tag=$4, ciphertext=$5, updated_at=NOW() WHERE id=$1 RETURNING *`,
        [record.id, record.keyId, record.iv, record.authTag, record.ciphertext],
      );
      if (!res.rows[0]) throw new NotFoundError('Credential', record.id);
      return mapCredential(res.rows[0]);
    },
    delete: async (id) => {
      const res = await db.query('DELETE FROM credentials WHERE id = $1', [id]);
      if ((res.rowCount ?? 0) === 0) throw new NotFoundError('Credential', id);
    },
  };

  const users: IUserRepository = {
    create: async (user) => {
      try {
        const res = await db.query(
          `INSERT INTO users (id, email, name, password_hash, role, is_active, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [
            user.id,
            user.email,
            user.name,
            user.passwordHash,
            user.role,
            user.isActive,
            user.createdAt,
            user.updatedAt,
          ],
        );
        return mapUser(res.rows[0]!);
      } catch (err: unknown) {
        if ((err as { code?: string }).code === '23505') {
          throw new ConflictError(`User '${user.email}' already exists`);
        }
        throw err;
      }
    },
    findById: async (id) => {
      const res = await db.query('SELECT * FROM users WHERE id = $1', [id]);
      return res.rows[0] ? mapUser(res.rows[0]) : null;
    },
    findByEmail: async (email) => {
      const res = await db.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [email]);
      return res.rows[0] ? mapUser(res.rows[0]) : null;
    },
    count: async () => {
      const res = await db.query<{ cnt: string }>('SELECT COUNT(*)::text AS cnt FROM users');
      return Number(res.rows[0]?.cnt ?? 0);
    },
    createApiKey: async (apiKey) => {
      const res = await db.query(
        `INSERT INTO api_keys (id, user_id, name, key_prefix, key_hash, role, expires_at, last_used_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          apiKey.id,
          apiKey.userId,
          apiKey.name,
          apiKey.keyPrefix,
          apiKey.keyHash,
          apiKey.role,
          apiKey.expiresAt,
          apiKey.lastUsedAt,
          apiKey.createdAt,
        ],
      );
      return mapApiKey(res.rows[0]!);
    },
    findApiKeyByHash: async (keyHash) => {
      const res = await db.query('SELECT * FROM api_keys WHERE key_hash = $1', [keyHash]);
      return res.rows[0] ? mapApiKey(res.rows[0]) : null;
    },
    touchApiKey: async (id, usedAt) => {
      await db.query('UPDATE api_keys SET last_used_at = $2 WHERE id = $1', [id, usedAt]);
    },
  };

  const idempotency: IIdempotencyRepository = {
    find: async (key, scope, now) => {
      const res = await db.query(
        'SELECT * FROM idempotency_keys WHERE key = $1 AND scope = $2 AND expires_at > $3',
        [key, scope, now],
      );
      const row = res.rows[0];
      if (!row) return null;
      return {
        key: String(row.key),
        scope: String(row.scope),
        requestHash: String(row.request_hash),
        statusCode: Number(row.status_code),
        responseBody: row.response_body,
        createdAt: new Date(String(row.created_at)),
        expiresAt: new Date(String(row.expires_at)),
      };
    },
    save: async (record) => {
      await db.query(
        `INSERT INTO idempotency_keys (key, scope, request_hash, status_code, response_body, created_at, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (key, scope) DO UPDATE SET request_hash=$3, status_code=$4, response_body=$5, expires_at=$7`,
        [
          record.key,
          record.scope,
          record.requestHash,
          record.statusCode,
          JSON.stringify(record.responseBody),
          record.createdAt,
          record.expiresAt,
        ],
      );
    },
  };

  return {
    workflows,
    instances,
    tokens,
    steps,
    userTasks,
    subscriptions,
    incidents,
    jobs,
    outbox,
    credentials,
    users,
    idempotency,
  };
}

export class PostgresUnitOfWork implements IUnitOfWork {
  public readonly repos: IRepositoryRegistry;

  constructor(private readonly pool: Pool) {
    this.repos = buildRegistry(pool);
  }

  async runInTransaction<T>(fn: (repos: IRepositoryRegistry) => Promise<T>): Promise<T> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const txRepos = buildRegistry(client);
      const result = await fn(txRepos);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
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

