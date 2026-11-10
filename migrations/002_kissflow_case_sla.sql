-- Kissflow Case Management, SLA Escalation, Delegation & Multi-Approver Quorum Extensions

ALTER TABLE workflow_instances
  ADD COLUMN IF NOT EXISTS current_stage TEXT,
  ADD COLUMN IF NOT EXISTS sla_status TEXT NOT NULL DEFAULT 'ON_TRACK'
    CHECK (sla_status IN ('ON_TRACK', 'BREACHED'));

ALTER TABLE user_tasks
  ADD COLUMN IF NOT EXISTS stage TEXT,
  ADD COLUMN IF NOT EXISTS delegated_from TEXT,
  ADD COLUMN IF NOT EXISTS required_approvals INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS approvals_received JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS sla_breached BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS escalate_to TEXT,
  ADD COLUMN IF NOT EXISTS escalation_level INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_user_tasks_sla
  ON user_tasks (due_at)
  WHERE status IN ('OPEN', 'CLAIMED') AND sla_breached = FALSE AND due_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS case_comments (
  id UUID PRIMARY KEY,
  instance_id UUID NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL,
  author_email TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_case_comments_instance
  ON case_comments (instance_id, created_at ASC);

