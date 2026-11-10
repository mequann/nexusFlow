-- Enterprise Dynamic Steps: Camunda External Tasks & Dynamic Sub-Workflow Call Activities

ALTER TABLE workflow_instances
  ADD COLUMN IF NOT EXISTS parent_instance_id UUID,
  ADD COLUMN IF NOT EXISTS parent_token_id UUID;

CREATE INDEX IF NOT EXISTS idx_instances_parent
  ON workflow_instances (parent_instance_id)
  WHERE parent_instance_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS external_tasks (
  id UUID PRIMARY KEY,
  instance_id UUID NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
  token_id UUID NOT NULL REFERENCES execution_tokens(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  worker_id TEXT,
  lock_expires_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'LOCKED', 'COMPLETED', 'FAILED')),
  variables JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_variables JSONB,
  retries INTEGER NOT NULL DEFAULT 3,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_external_tasks_topic_poll
  ON external_tasks (topic, created_at ASC)
  WHERE status IN ('OPEN', 'LOCKED');

