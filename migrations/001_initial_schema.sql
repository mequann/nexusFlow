-- NexusFlow: Hybrid Camunda BPMN + n8n Workflow Orchestration Schema

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN', 'OPERATOR', 'BUILDER', 'VIEWER')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('ADMIN', 'OPERATOR', 'BUILDER', 'VIEWER')),
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS credentials (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  key_id TEXT NOT NULL,
  iv TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workflows (
  id UUID PRIMARY KEY,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  definition JSONB NOT NULL,
  webhook_path TEXT,
  webhook_secret_hash TEXT,
  cron_expression TEXT,
  cron_next_run_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (key, version)
);

CREATE INDEX IF NOT EXISTS idx_workflows_webhook_active
  ON workflows (webhook_path)
  WHERE status = 'PUBLISHED' AND webhook_path IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_workflows_cron_due
  ON workflows (cron_next_run_at)
  WHERE status = 'PUBLISHED' AND cron_expression IS NOT NULL;

CREATE TABLE IF NOT EXISTS workflow_instances (
  id UUID PRIMARY KEY,
  workflow_id UUID NOT NULL REFERENCES workflows(id),
  workflow_key TEXT NOT NULL,
  workflow_version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'PENDING', 'RUNNING', 'WAITING', 'INCIDENT_OPEN',
    'COMPENSATING', 'COMPENSATED', 'COMPLETED', 'FAILED', 'CANCELLED'
  )),
  trigger_type TEXT NOT NULL,
  trigger_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  variables JSONB NOT NULL DEFAULT '{}'::jsonb,
  correlation_key TEXT,
  started_by TEXT,
  occ_version INTEGER NOT NULL DEFAULT 1,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_instances_status ON workflow_instances (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_instances_workflow ON workflow_instances (workflow_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_instances_correlation ON workflow_instances (correlation_key) WHERE correlation_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS execution_tokens (
  id UUID PRIMARY KEY,
  instance_id UUID NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
  current_node_id TEXT NOT NULL,
  parent_token_id UUID,
  join_group_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'WAITING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tokens_instance ON execution_tokens (instance_id, status);

CREATE TABLE IF NOT EXISTS step_executions (
  id UUID PRIMARY KEY,
  instance_id UUID NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
  token_id UUID NOT NULL REFERENCES execution_tokens(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  node_type TEXT NOT NULL,
  node_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'RUNNING', 'WAITING', 'COMPLETED', 'FAILED', 'SKIPPED', 'COMPENSATED', 'COMPENSATION_FAILED'
  )),
  attempt INTEGER NOT NULL DEFAULT 1,
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  output JSONB,
  error_message TEXT,
  compensate_node_id TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_steps_instance ON step_executions (instance_id, started_at ASC);

CREATE TABLE IF NOT EXISTS user_tasks (
  id UUID PRIMARY KEY,
  instance_id UUID NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
  token_id UUID NOT NULL REFERENCES execution_tokens(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  candidate_group TEXT,
  assignee TEXT,
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'CLAIMED', 'COMPLETED', 'REJECTED', 'CANCELLED', 'EXPIRED')),
  form_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolution JSONB,
  due_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_user_tasks_status ON user_tasks (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_tasks_instance ON user_tasks (instance_id);

CREATE TABLE IF NOT EXISTS event_subscriptions (
  id UUID PRIMARY KEY,
  instance_id UUID NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
  token_id UUID NOT NULL REFERENCES execution_tokens(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('MESSAGE', 'TIMER')),
  message_name TEXT,
  correlation_key TEXT,
  trigger_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'TRIGGERED', 'CANCELLED')),
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  triggered_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_message
  ON event_subscriptions (message_name, correlation_key)
  WHERE status = 'ACTIVE' AND type = 'MESSAGE';

CREATE INDEX IF NOT EXISTS idx_subscriptions_timer
  ON event_subscriptions (trigger_at)
  WHERE status = 'ACTIVE' AND type = 'TIMER';

CREATE TABLE IF NOT EXISTS incidents (
  id UUID PRIMARY KEY,
  instance_id UUID NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
  token_id UUID NOT NULL REFERENCES execution_tokens(id) ON DELETE CASCADE,
  step_execution_id UUID REFERENCES step_executions(id) ON DELETE SET NULL,
  node_id TEXT NOT NULL,
  incident_type TEXT NOT NULL,
  message TEXT NOT NULL,
  stack_trace TEXT,
  payload_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'RESOLVED', 'DISMISSED')),
  resolved_by TEXT,
  resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents (status, created_at DESC);

CREATE TABLE IF NOT EXISTS execution_jobs (
  id UUID PRIMARY KEY,
  instance_id UUID NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
  token_id UUID NOT NULL REFERENCES execution_tokens(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  job_type TEXT NOT NULL CHECK (job_type IN ('EXECUTE_NODE', 'RESUME_TOKEN', 'COMPENSATE')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'DEAD')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_by TEXT,
  locked_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jobs_poll
  ON execution_jobs (available_at ASC)
  WHERE status = 'PENDING';

CREATE TABLE IF NOT EXISTS outbox_events (
  id UUID PRIMARY KEY,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'PUBLISHED', 'FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_outbox_pending
  ON outbox_events (created_at ASC)
  WHERE status = 'PENDING';

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT NOT NULL,
  scope TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  response_body JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (key, scope)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_keys (expires_at);
