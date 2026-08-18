-- migrate:up
CREATE TABLE IF NOT EXISTS business_effects (
  business_effect_id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  business_effect_key TEXT NOT NULL,
  external_system_namespace TEXT,
  external_operation_id TEXT,
  commit_state TEXT NOT NULL DEFAULT 'prepared'
    CHECK (commit_state IN ('prepared', 'committed', 'compensated', 'unknown')),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  committed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, scope_id, business_effect_key),
  UNIQUE (external_system_namespace, external_operation_id),
  CHECK (
    (external_system_namespace IS NULL AND external_operation_id IS NULL)
    OR
    (external_system_namespace IS NOT NULL AND external_operation_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_business_effects_commit_state
  ON business_effects(commit_state);

-- migrate:down
DROP INDEX IF EXISTS idx_business_effects_commit_state;
DROP TABLE IF EXISTS business_effects;
