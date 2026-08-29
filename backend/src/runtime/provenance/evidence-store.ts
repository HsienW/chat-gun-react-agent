import type { ResourceRef } from "../authorization/resource-ref.js";
import type { Queryable } from "../persistence/rows.js";
import { createEvidenceRef, type EvidenceRef } from "./evidence-ref.js";

const EVIDENCE_COLUMNS = `
  evidence_ref_id, decision_id, resource_type, resource_id,
  resource_tenant_id, resource_owner_scope_id, role, observed_at,
  resource_version, snapshot_hash
`;

interface EvidenceRefRow extends Record<string, unknown> {
  evidence_ref_id: unknown;
  decision_id: unknown;
  resource_type: unknown;
  resource_id: unknown;
  resource_tenant_id: unknown;
  resource_owner_scope_id: unknown;
  role: unknown;
  observed_at: unknown;
  resource_version: unknown;
  snapshot_hash: unknown;
}

export interface EvidenceStore {
  record(evidence: EvidenceRef): Promise<EvidenceRef>;
  findByDecisionId(decisionId: string): Promise<EvidenceRef[]>;
  findByResource(resource: ResourceRef): Promise<EvidenceRef[]>;
}

function requiredString(value: unknown, column: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid ${column} returned from decision_evidence_refs`);
  }
  return value;
}

function optionalString(value: unknown, column: string): string | undefined {
  return value === null ? undefined : requiredString(value, column);
}

function isoString(value: unknown, column: string): string {
  if (!(typeof value === "string" || value instanceof Date)) {
    throw new Error(`Invalid ${column} returned from decision_evidence_refs`);
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${column} returned from decision_evidence_refs`);
  }
  return date.toISOString();
}

function mapEvidenceRow(row: EvidenceRefRow): EvidenceRef {
  const ownerScopeId = optionalString(
    row.resource_owner_scope_id,
    "resource_owner_scope_id"
  );
  const resourceVersion = optionalString(row.resource_version, "resource_version");
  const snapshotHash = optionalString(row.snapshot_hash, "snapshot_hash");

  return createEvidenceRef({
    evidenceRefId: requiredString(row.evidence_ref_id, "evidence_ref_id"),
    decisionId: requiredString(row.decision_id, "decision_id"),
    resource: {
      resourceType: requiredString(row.resource_type, "resource_type"),
      resourceId: requiredString(row.resource_id, "resource_id"),
      tenantId: requiredString(row.resource_tenant_id, "resource_tenant_id"),
      ...(ownerScopeId === undefined ? {} : { ownerScopeId }),
    },
    role: requiredString(row.role, "role") as EvidenceRef["role"],
    observedAt: isoString(row.observed_at, "observed_at"),
    ...(resourceVersion === undefined ? {} : { resourceVersion }),
    ...(snapshotHash === undefined ? {} : { snapshotHash }),
  });
}

export class PgEvidenceStore implements EvidenceStore {
  constructor(private readonly db: Queryable) {}

  async record(evidence: EvidenceRef): Promise<EvidenceRef> {
    const safeEvidence = createEvidenceRef(evidence);
    const result = await this.db.query<EvidenceRefRow>(
      `INSERT INTO decision_evidence_refs (
         evidence_ref_id, decision_id, resource_type, resource_id,
         resource_tenant_id, resource_owner_scope_id, role, observed_at,
         resource_version, snapshot_hash
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
       )
       RETURNING ${EVIDENCE_COLUMNS}`,
      [
        safeEvidence.evidenceRefId,
        safeEvidence.decisionId,
        safeEvidence.resource.resourceType,
        safeEvidence.resource.resourceId,
        safeEvidence.resource.tenantId,
        safeEvidence.resource.ownerScopeId ?? null,
        safeEvidence.role,
        safeEvidence.observedAt,
        safeEvidence.resourceVersion ?? null,
        safeEvidence.snapshotHash ?? null,
      ]
    );
    const row = result.rows[0];
    if (!row) throw new Error("Evidence ref insert returned no row");
    return mapEvidenceRow(row);
  }

  async findByDecisionId(decisionId: string): Promise<EvidenceRef[]> {
    const result = await this.db.query<EvidenceRefRow>(
      `SELECT ${EVIDENCE_COLUMNS}
       FROM decision_evidence_refs
       WHERE decision_id = $1
       ORDER BY observed_at DESC`,
      [decisionId]
    );
    return result.rows.map(mapEvidenceRow);
  }

  async findByResource(resource: ResourceRef): Promise<EvidenceRef[]> {
    const result = await this.db.query<EvidenceRefRow>(
      `SELECT ${EVIDENCE_COLUMNS}
       FROM decision_evidence_refs
       WHERE resource_type = $1
         AND resource_id = $2
         AND resource_tenant_id = $3
         AND resource_owner_scope_id IS NOT DISTINCT FROM $4
       ORDER BY observed_at DESC`,
      [
        resource.resourceType,
        resource.resourceId,
        resource.tenantId,
        resource.ownerScopeId ?? null,
      ]
    );
    return result.rows.map(mapEvidenceRow);
  }
}
