-- migrate:up
CREATE TABLE IF NOT EXISTS decision_records (
  decision_id TEXT PRIMARY KEY,
  request_id TEXT,
  thread_id TEXT,
  run_id TEXT,
  task_id TEXT,
  step_id TEXT,
  decision_type TEXT NOT NULL,
  outcome TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  confidence DOUBLE PRECISION CHECK (
    confidence IS NULL OR (confidence >= 0 AND confidence <= 1)
  ),
  policy_version TEXT,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_decision_records_task_id
  ON decision_records(task_id)
  WHERE task_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_decision_records_step_id
  ON decision_records(step_id)
  WHERE step_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_decision_records_decision_type
  ON decision_records(decision_type);

-- migrate:down
DROP INDEX IF EXISTS idx_decision_records_decision_type;
DROP INDEX IF EXISTS idx_decision_records_step_id;
DROP INDEX IF EXISTS idx_decision_records_task_id;
DROP TABLE IF EXISTS decision_records;
