-- migrate:up
CREATE TABLE IF NOT EXISTS decision_evidence_refs (
  evidence_ref_id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL REFERENCES decision_records(decision_id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  resource_tenant_id TEXT NOT NULL,
  resource_owner_scope_id TEXT,
  role TEXT NOT NULL
    CHECK (role IN ('input', 'supporting', 'contradicting', 'policy', 'memory', 'tool_result')),
  observed_at TIMESTAMPTZ NOT NULL,
  resource_version TEXT,
  snapshot_hash TEXT
);

CREATE INDEX IF NOT EXISTS idx_decision_evidence_refs_decision_id
  ON decision_evidence_refs(decision_id);

CREATE INDEX IF NOT EXISTS idx_decision_evidence_refs_resource
  ON decision_evidence_refs(resource_tenant_id, resource_id);

-- migrate:down
DROP INDEX IF EXISTS idx_decision_evidence_refs_resource;
DROP INDEX IF EXISTS idx_decision_evidence_refs_decision_id;
DROP TABLE IF EXISTS decision_evidence_refs;
