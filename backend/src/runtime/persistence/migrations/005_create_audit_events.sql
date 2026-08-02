-- migrate:up
CREATE TABLE IF NOT EXISTS audit_events (
  event_id TEXT PRIMARY KEY,
  task_id TEXT,
  step_id TEXT,
  tool_execution_id TEXT,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  reason_code TEXT,
  payload JSONB,
  before_state_ref TEXT,
  after_state_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_events_task_id
  ON audit_events(task_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_action
  ON audit_events(action);
CREATE INDEX IF NOT EXISTS idx_audit_events_created_at
  ON audit_events(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_events_resource
  ON audit_events(resource_type, resource_id);

-- migrate:down
DROP INDEX IF EXISTS idx_audit_events_resource;
DROP INDEX IF EXISTS idx_audit_events_created_at;
DROP INDEX IF EXISTS idx_audit_events_action;
DROP INDEX IF EXISTS idx_audit_events_task_id;
DROP TABLE IF EXISTS audit_events;
