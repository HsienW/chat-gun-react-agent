-- migrate:up
CREATE TABLE IF NOT EXISTS compensation_executions (
  compensation_execution_id TEXT PRIMARY KEY,
  business_effect_id TEXT NOT NULL REFERENCES business_effects(business_effect_id),
  tool_execution_id TEXT NOT NULL REFERENCES tool_executions(tool_execution_id),
  compensation_action_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'prepared'
    CHECK (status IN (
      'prepared', 'executing', 'compensated', 'failed',
      'manual_intervention_required'
    )),
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compensation_executions_tool
  ON compensation_executions(tool_execution_id, status);

-- migrate:down
DROP INDEX IF EXISTS idx_compensation_executions_tool;
DROP TABLE IF EXISTS compensation_executions;
