-- migrate:up
CREATE TABLE IF NOT EXISTS context_refs (
  context_ref_id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_tenant_id TEXT NOT NULL,
  source_owner_scope_id TEXT,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_tenant_id TEXT NOT NULL,
  target_owner_scope_id TEXT,
  relation_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_context_refs_source
  ON context_refs(source_tenant_id, source_id);

CREATE INDEX IF NOT EXISTS idx_context_refs_target
  ON context_refs(target_tenant_id, target_id);

CREATE INDEX IF NOT EXISTS idx_context_refs_relation_type
  ON context_refs(relation_type);

-- migrate:down
DROP INDEX IF EXISTS idx_context_refs_relation_type;
DROP INDEX IF EXISTS idx_context_refs_target;
DROP INDEX IF EXISTS idx_context_refs_source;
DROP TABLE IF EXISTS context_refs;
