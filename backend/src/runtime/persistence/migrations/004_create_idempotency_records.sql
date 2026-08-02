-- migrate:up
CREATE TABLE IF NOT EXISTS idempotency_records (
  key TEXT PRIMARY KEY,
  namespace TEXT NOT NULL,
  resource_key TEXT NOT NULL,
  version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'locked',
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_idempotency_expires
  ON idempotency_records(expires_at);

-- migrate:down
DROP INDEX IF EXISTS idx_idempotency_expires;
DROP TABLE IF EXISTS idempotency_records;
