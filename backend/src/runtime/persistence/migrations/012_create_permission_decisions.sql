-- migrate:up
CREATE TABLE IF NOT EXISTS permission_decisions (
  decision_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  principal_type TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  effect TEXT NOT NULL
    CHECK (effect IN ('allow', 'deny', 'require_confirmation')),
  reason_code TEXT NOT NULL,
  matched_policy TEXT,
  matched_grant_id TEXT,
  policy_version TEXT,
  task_id TEXT,
  step_id TEXT,
  tool_execution_id TEXT,
  context_summary JSONB,
  created_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE tool_executions
  ADD COLUMN IF NOT EXISTS decision_id TEXT;

CREATE INDEX IF NOT EXISTS idx_permission_decisions_tool_execution_id
  ON permission_decisions(tool_execution_id)
  WHERE tool_execution_id IS NOT NULL;

-- migrate:down
DROP INDEX IF EXISTS idx_permission_decisions_tool_execution_id;
ALTER TABLE tool_executions DROP COLUMN IF EXISTS decision_id;
DROP TABLE IF EXISTS permission_decisions;
