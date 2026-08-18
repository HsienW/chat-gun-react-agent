-- migrate:up
CREATE TABLE IF NOT EXISTS tool_executions (
  tool_execution_id TEXT PRIMARY KEY,
  business_effect_id TEXT REFERENCES business_effects(business_effect_id),
  replay_key TEXT NOT NULL,
  request_id TEXT,
  thread_id TEXT,
  run_id TEXT NOT NULL,
  task_id TEXT,
  step_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  tool_version TEXT NOT NULL,
  call_index INTEGER NOT NULL CHECK (call_index >= 0),
  status TEXT NOT NULL DEFAULT 'prepared'
    CHECK (status IN (
      'prepared', 'executing', 'committed', 'failed', 'unknown',
      'compensating', 'compensated', 'manual_intervention_required'
    )),
  request_hash TEXT NOT NULL,
  result_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (replay_key)
);

CREATE INDEX IF NOT EXISTS idx_tool_executions_business_effect
  ON tool_executions(business_effect_id);
CREATE INDEX IF NOT EXISTS idx_tool_executions_step_status
  ON tool_executions(step_id, status);

-- migrate:down
DROP INDEX IF EXISTS idx_tool_executions_step_status;
DROP INDEX IF EXISTS idx_tool_executions_business_effect;
DROP TABLE IF EXISTS tool_executions;
