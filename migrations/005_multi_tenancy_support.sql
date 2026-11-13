-- 005_multi_tenancy_support.sql
-- Native Multi-Tenancy Architecture: Strict isolation for enterprise workflows across companies/tenants

-- 1. Tenants Table
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY, -- Tenant code or slug, e.g., 'default', 'acme_corp', 'globex'
  name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'ENTERPRISE',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default tenant so all existing data gracefully belongs to 'default'
INSERT INTO tenants (id, name, plan, is_active)
VALUES ('default', 'Default Organization', 'ENTERPRISE', TRUE)
ON CONFLICT (id) DO NOTHING;

-- 2. Add tenant_id to users and api_keys
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default' REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default' REFERENCES tenants(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_users_tenant ON users (tenant_id, is_active);

-- 3. Add tenant_id to workflows and workflow_instances
-- Make workflow (tenant_id, key, version) unique instead of just (key, version) so different tenants can have their own custom workflows with identical keys!
ALTER TABLE workflows
  ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default' REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE workflow_instances
  ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default' REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE user_tasks
  ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default' REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default' REFERENCES tenants(id) ON DELETE CASCADE;

ALTER TABLE credentials
  ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default' REFERENCES tenants(id) ON DELETE CASCADE;

-- 4. Multi-Tenant Composite Indexes for High Performance & Zero Cross-Tenant Leakage
CREATE INDEX IF NOT EXISTS idx_workflows_tenant_key_ver ON workflows (tenant_id, key, version DESC);
CREATE INDEX IF NOT EXISTS idx_instances_tenant_status ON workflow_instances (tenant_id, status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_tenant_assignee ON user_tasks (tenant_id, assignee, status);
CREATE INDEX IF NOT EXISTS idx_notifications_tenant_recipient ON notifications (tenant_id, recipient_id, read);
CREATE INDEX IF NOT EXISTS idx_credentials_tenant_name ON credentials (tenant_id, name);

