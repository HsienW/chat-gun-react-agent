-- migrate:up
CREATE TABLE IF NOT EXISTS permission_grants (
  grant_id TEXT PRIMARY KEY,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  resource_tenant_id TEXT NOT NULL,
  resource_owner_scope_id TEXT,
  grantee_scope_id TEXT NOT NULL,
  grantee_tenant_id TEXT NOT NULL,
  actions TEXT[] NOT NULL,
  granted_by_principal_id TEXT NOT NULL,
  granted_by_scope_id TEXT NOT NULL,
  can_delegate BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  UNIQUE (resource_tenant_id, resource_id, grantee_scope_id)
);

CREATE INDEX IF NOT EXISTS idx_permission_grants_active_match
  ON permission_grants(
    resource_type,
    resource_id,
    resource_tenant_id,
    resource_owner_scope_id,
    grantee_scope_id,
    grantee_tenant_id
  )
  WHERE revoked_at IS NULL;

-- migrate:down
DROP INDEX IF EXISTS idx_permission_grants_active_match;
DROP TABLE IF EXISTS permission_grants;
