-- migrate:up
CREATE TABLE IF NOT EXISTS result_references (
  result_ref_id TEXT PRIMARY KEY,
  tool_execution_id TEXT NOT NULL REFERENCES tool_executions(tool_execution_id),
  scope_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  tool_version TEXT NOT NULL,
  cache_state TEXT NOT NULL DEFAULT 'reusable'
    CHECK (cache_state IN (
      'reusable', 'expired', 'invalidated',
      'authorization_mismatch', 'version_mismatch'
    )),
  result_hash TEXT NOT NULL,
  payload_ref TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tool_execution_id)
);

CREATE INDEX IF NOT EXISTS idx_result_references_cache_state
  ON result_references(cache_state);

-- migrate:down
DROP INDEX IF EXISTS idx_result_references_cache_state;
DROP TABLE IF EXISTS result_references;
