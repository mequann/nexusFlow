-- Migration 007: Expand user and api_key role check constraints to include HR and USER
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('ADMIN', 'OPERATOR', 'BUILDER', 'VIEWER', 'HR', 'USER'));

ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_role_check;
ALTER TABLE api_keys ADD CONSTRAINT api_keys_role_check CHECK (role IN ('ADMIN', 'OPERATOR', 'BUILDER', 'VIEWER', 'HR', 'USER'));

