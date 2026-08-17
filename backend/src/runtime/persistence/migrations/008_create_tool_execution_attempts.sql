-- migrate:up
CREATE TABLE IF NOT EXISTS tool_execution_attempts (
  tool_execution_attempt_id TEXT PRIMARY KEY,
  tool_execution_id TEXT NOT NULL REFERENCES tool_executions(tool_execution_id),
  execution_attempt INTEGER NOT NULL CHECK (execution_attempt > 0),
  dispatch_state TEXT NOT NULL DEFAULT 'before'
    CHECK (dispatch_state IN ('before', 'after', 'unknown')),
  outcome TEXT
    CHECK (outcome IS NULL OR outcome IN (
      'succeeded', 'rejected_before_dispatch', 'failed_not_committed',
      'ambiguous_after_dispatch', 'cancelled'
    )),
  error_code TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  UNIQUE (tool_execution_id, execution_attempt)
);

CREATE INDEX IF NOT EXISTS idx_tool_execution_attempts_execution
  ON tool_execution_attempts(tool_execution_id, execution_attempt);

-- migrate:down
DROP INDEX IF EXISTS idx_tool_execution_attempts_execution;
DROP TABLE IF EXISTS tool_execution_attempts;
