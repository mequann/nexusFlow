-- 004_notifications_and_user_scoping.sql
-- Enterprise Notifications, High-Performance Indexing and HRIS User Extensions

-- 1. Notifications Table for Task Creation, SLA Escalations, and Delegations
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY,
  recipient_id TEXT NOT NULL,
  recipient_group TEXT,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('TASK_ASSIGNED', 'TASK_ESCALATED', 'TASK_DELEGATED', 'WORKFLOW_FAILED', 'INFO')),
  task_id UUID REFERENCES user_tasks(id) ON DELETE CASCADE,
  instance_id UUID REFERENCES workflow_instances(id) ON DELETE CASCADE,
  read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications (recipient_id, read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_group ON notifications (recipient_group, read, created_at DESC) WHERE recipient_group IS NOT NULL;

-- 2. Performance Indexes for User Scoping and CP Concurrency
CREATE INDEX IF NOT EXISTS idx_instances_started_by ON workflow_instances (started_by, started_at DESC) WHERE started_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_assignee_status ON user_tasks (assignee, status, created_at DESC) WHERE assignee IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_candidate_group_status ON user_tasks (candidate_group, status, created_at DESC) WHERE candidate_group IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tokens_join_barrier ON execution_tokens (instance_id, current_node_id, status);

-- 3. Users Table Extensions for HRIS / Org Hierarchy
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS department TEXT,
  ADD COLUMN IF NOT EXISTS manager_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS out_of_office BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS delegate_id UUID REFERENCES users(id) ON DELETE SET NULL;
