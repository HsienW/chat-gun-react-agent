import { describe, expect, it, vi } from "vitest";

import { PgResultReferenceStore } from "./result-reference-store.js";
import type {
  ResultReferencePolicy,
  TrustedScope,
} from "./side-effect-descriptor.js";
import type { Queryable } from "../persistence/rows.js";

function createFakeQuery(
  handler: (
    text: string,
    values: readonly unknown[]
  ) => Promise<{
    rows: Record<string, unknown>[];
    rowCount: number | null;
  }>
): Queryable["query"] {
  return async <TResult extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = []
  ) => {
    const result = await handler(text, values);
    return { rows: result.rows as TResult[], rowCount: result.rowCount };
  };
}

type TestResult = { operationId: string; sensitivePayload: string };

const scope: TrustedScope = {
  scopeId: "scope-1",
  tenantId: "tenant-1",
  principalId: "principal-1",
};

function createPolicy(): ResultReferencePolicy<TestResult> {
  return {
    toResultRef: ({ operationId }) => ({
      resultHash: `hash-${operationId}`,
      payloadRef: `payload://${operationId}`,
    }),
    resolveResultRef: vi.fn(async (payloadRef: string) => ({
      operationId: payloadRef.slice("payload://".length),
      sensitivePayload: "resolved-outside-ledger",
    })),
    isReusable: (cacheState) => cacheState === "reusable",
  };
}

function resultReferenceRow(overrides: Record<string, unknown> = {}) {
  return {
    result_ref_id: "result-ref-1",
    tool_execution_id: "execution-1",
    scope_id: "scope-1",
    tenant_id: "tenant-1",
    principal_id: "principal-1",
    tool_version: "1",
    cache_state: "reusable",
    result_hash: "hash-operation-1",
    payload_ref: "payload://operation-1",
    created_at: new Date("2026-08-17T00:00:00.000Z"),
    updated_at: new Date("2026-08-17T00:00:00.000Z"),
    ...overrides,
  };
}

describe("PgResultReferenceStore", () => {
  it("stores only the opaque payload reference and result hash", async () => {
    let insertValues: readonly unknown[] = [];
    const db: Queryable = {
      query: createFakeQuery(async (text, values) => {
        expect(text).toContain("INSERT INTO result_references");
        insertValues = values;
        return { rows: [resultReferenceRow()], rowCount: 1 };
      }),
    };
    const store = new PgResultReferenceStore(db);

    await store.save({
      toolExecutionId: "execution-1",
      result: {
        operationId: "operation-1",
        sensitivePayload: "must-not-enter-ledger",
      },
      policy: createPolicy(),
      scope,
      toolVersion: "1",
    });

    expect(insertValues).toContain("hash-operation-1");
    expect(insertValues).toContain("payload://operation-1");
    expect(JSON.stringify(insertValues)).not.toContain("must-not-enter-ledger");
  });

  it("rejects incomplete external operation metadata before persistence", async () => {
    let queryCalled = false;
    const db: Queryable = {
      query: async <TResult extends Record<string, unknown> = Record<string, unknown>>() => {
        queryCalled = true;
        return { rows: [] as TResult[], rowCount: 0 };
      },
    };
    const store = new PgResultReferenceStore(db);
    const policy = createPolicy();
    policy.toResultRef = () => ({
      resultHash: "hash-operation-1",
      payloadRef: "payload://operation-1",
      externalSystemNamespace: "test-system",
    });

    await expect(
      store.save({
        toolExecutionId: "execution-1",
        result: {
          operationId: "operation-1",
          sensitivePayload: "must-not-enter-ledger",
        },
        policy,
        scope,
        toolVersion: "1",
      })
    ).rejects.toThrow(
      "Result reference external system namespace and operation ID must be provided together"
    );
    expect(queryCalled).toBe(false);
  });

  it("resolves a reusable reference for the same scope and tool version", async () => {
    const db: Queryable = {
      query: createFakeQuery(async () => ({
        rows: [resultReferenceRow()],
        rowCount: 1,
      })),
    };
    const policy = createPolicy();
    const store = new PgResultReferenceStore(db);

    await expect(
      store.resolve({ resultRefId: "result-ref-1", policy, scope, toolVersion: "1" })
    ).resolves.toEqual({
      operationId: "operation-1",
      sensitivePayload: "resolved-outside-ledger",
    });
    expect(policy.resolveResultRef).toHaveBeenCalledWith("payload://operation-1");
  });

  it("marks and rejects authorization or version mismatches", async () => {
    const updates: string[] = [];
    const updateValues: Array<readonly unknown[]> = [];
    const db: Queryable = {
      query: createFakeQuery(async (text, values) => {
        if (text.includes("SELECT")) {
          return { rows: [resultReferenceRow()], rowCount: 1 };
        }
        updates.push(text);
        updateValues.push(values);
        return { rows: [], rowCount: 1 };
      }),
    };
    const store = new PgResultReferenceStore(db);

    await expect(
      store.resolve({
        resultRefId: "result-ref-1",
        policy: createPolicy(),
        scope: { ...scope, principalId: "other-principal" },
        toolVersion: "1",
      })
    ).resolves.toBeNull();
    await expect(
      store.resolve({
        resultRefId: "result-ref-1",
        policy: createPolicy(),
        scope,
        toolVersion: "2",
      })
    ).resolves.toBeNull();
    expect(updates).toHaveLength(2);
    expect(updateValues).toContainEqual([
      "result-ref-1",
      "authorization_mismatch",
    ]);
    expect(updateValues).toContainEqual(["result-ref-1", "version_mismatch"]);
  });

  it("cannot resolve a result when the reference store has no record", async () => {
    const db: Queryable = {
      query: createFakeQuery(async () => ({ rows: [], rowCount: 0 })),
    };
    const store = new PgResultReferenceStore(db);

    await expect(
      store.resolve({ resultRefId: "missing", policy: createPolicy(), scope, toolVersion: "1" })
    ).resolves.toBeNull();
  });
});
