-- migrate:up
CREATE TABLE IF NOT EXISTS task_events (
  event_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES agent_tasks(task_id) ON DELETE CASCADE,
  step_id TEXT,
  event_type TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_events_task_id ON task_events(task_id);
CREATE INDEX IF NOT EXISTS idx_task_events_created_at ON task_events(created_at);

-- migrate:down
DROP INDEX IF EXISTS idx_task_events_created_at;
DROP INDEX IF EXISTS idx_task_events_task_id;
DROP TABLE IF EXISTS task_events;
