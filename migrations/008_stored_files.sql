-- Migration 008: Tier-1 Enterprise Stored Files Table
CREATE TABLE IF NOT EXISTS stored_files (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default' REFERENCES tenants(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  checksum_sha256 TEXT NOT NULL,
  storage_driver TEXT NOT NULL DEFAULT 'local',
  storage_path TEXT NOT NULL,
  content_data TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  uploaded_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stored_files_tenant ON stored_files (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stored_files_checksum ON stored_files (checksum_sha256);

