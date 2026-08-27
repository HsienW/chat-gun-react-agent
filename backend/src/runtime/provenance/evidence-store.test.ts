import { describe, expect, it } from "vitest";

import type { Queryable } from "../persistence/rows.js";
import type { EvidenceRef } from "./evidence-ref.js";
import { PgEvidenceStore } from "./evidence-store.js";

function createFakeQuery(
  handler: (
    text: string,
    values: readonly unknown[]
  ) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>
): Queryable["query"] {
  return async <TResult extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = []
  ) => {
    const result = await handler(text, values);
    return { rows: result.rows as TResult[], rowCount: result.rowCount };
  };
}

function evidence(overrides: Partial<EvidenceRef> = {}): EvidenceRef {
  return {
    evidenceRefId: "evidence-1",
    decisionId: "decision-1",
    resource: {
      resourceType: "tool_execution",
      resourceId: "tool-execution-1",
      tenantId: "tenant-1",
      ownerScopeId: "scope-1",
    },
    role: "tool_result",
    observedAt: "2026-08-27T00:00:00.000Z",
    resourceVersion: "v1",
    snapshotHash: "sha256:abc",
    ...overrides,
  };
}

function evidenceRow(overrides: Record<string, unknown> = {}) {
  return {
    evidence_ref_id: "evidence-1",
    decision_id: "decision-1",
    resource_type: "tool_execution",
    resource_id: "tool-execution-1",
    resource_tenant_id: "tenant-1",
    resource_owner_scope_id: "scope-1",
    role: "tool_result",
    observed_at: "2026-08-27T00:00:00.000Z",
    resource_version: "v1",
    snapshot_hash: "sha256:abc",
    ...overrides,
  };
}

describe("PgEvidenceStore", () => {
  it("records evidence as ResourceRef plus version and hash", async () => {
    let insertValues: readonly unknown[] = [];
    const db: Queryable = {
      query: createFakeQuery(async (text, values) => {
        expect(text).toContain("INSERT INTO decision_evidence_refs");
        insertValues = values;
        return { rows: [evidenceRow()], rowCount: 1 };
      }),
    };
    const store = new PgEvidenceStore(db);

    await expect(store.record(evidence())).resolves.toMatchObject({
      evidenceRefId: "evidence-1",
      resource: { resourceType: "tool_execution", tenantId: "tenant-1" },
    });
    expect(insertValues).toEqual([
      "evidence-1",
      "decision-1",
      "tool_execution",
      "tool-execution-1",
      "tenant-1",
      "scope-1",
      "tool_result",
      "2026-08-27T00:00:00.000Z",
      "v1",
      "sha256:abc",
    ]);
  });

  it("finds evidence by decisionId and resource identity", async () => {
    const seenQueries: string[] = [];
    const seenValues: (readonly unknown[])[] = [];
    const db: Queryable = {
      query: createFakeQuery(async (text, values) => {
        seenQueries.push(text);
        seenValues.push(values);
        return { rows: [evidenceRow()], rowCount: 1 };
      }),
    };
    const store = new PgEvidenceStore(db);

    await expect(store.findByDecisionId("decision-1")).resolves.toHaveLength(1);
    await expect(
      store.findByResource(evidence().resource)
    ).resolves.toHaveLength(1);
    expect(seenQueries.join("\n")).toContain("WHERE decision_id = $1");
    expect(seenQueries.join("\n")).toContain("resource_owner_scope_id IS NOT DISTINCT FROM $4");
    expect(seenValues[1]).toEqual([
      "tool_execution",
      "tool-execution-1",
      "tenant-1",
      "scope-1",
    ]);
  });
});
