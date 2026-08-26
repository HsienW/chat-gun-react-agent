-- migrate:up
CREATE TABLE IF NOT EXISTS active_run_ownership (
  thread_id TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  task_id TEXT NOT NULL REFERENCES agent_tasks(task_id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('active', 'superseded', 'completed', 'cancelled')),
  generation INTEGER NOT NULL CHECK (generation > 0),
  superseded_by_run_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (thread_id, scope_id, generation),
  UNIQUE (run_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_active_run_ownership_single_active
  ON active_run_ownership(thread_id, scope_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_active_run_ownership_updated_at
  ON active_run_ownership(updated_at);

-- migrate:down
DROP INDEX IF EXISTS idx_active_run_ownership_updated_at;
DROP INDEX IF EXISTS idx_active_run_ownership_single_active;
DROP TABLE IF EXISTS active_run_ownership;
