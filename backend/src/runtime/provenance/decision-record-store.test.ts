import { describe, expect, it, vi } from "vitest";

import type { Queryable } from "../persistence/rows.js";
import type { DecisionRecord } from "./decision-record.js";
import { PgDecisionRecordStore } from "./decision-record-store.js";

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

function record(overrides: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    decisionId: "decision-1",
    requestId: "request-1",
    threadId: "thread-1",
    runId: "run-1",
    taskId: "task-1",
    stepId: "step-1",
    decisionType: "routing",
    outcome: "selected",
    reasonCode: "POLICY_MATCH",
    confidence: 0.8,
    policyVersion: "policy-v1",
    createdAt: "2026-08-27T00:00:00.000Z",
    ...overrides,
  };
}

function recordRow(overrides: Record<string, unknown> = {}) {
  return {
    decision_id: "decision-1",
    request_id: "request-1",
    thread_id: "thread-1",
    run_id: "run-1",
    task_id: "task-1",
    step_id: "step-1",
    decision_type: "routing",
    outcome: "selected",
    reason_code: "POLICY_MATCH",
    confidence: 0.8,
    policy_version: "policy-v1",
    created_at: "2026-08-27T00:00:00.000Z",
    ...overrides,
  };
}

describe("PgDecisionRecordStore", () => {
  it("records a decision with correlation fields", async () => {
    let insertValues: readonly unknown[] = [];
    const db: Queryable = {
      query: createFakeQuery(async (text, values) => {
        expect(text).toContain("INSERT INTO decision_records");
        insertValues = values;
        return { rows: [recordRow()], rowCount: 1 };
      }),
    };
    const store = new PgDecisionRecordStore(db);

    await expect(store.record(record())).resolves.toMatchObject({
      decisionId: "decision-1",
      taskId: "task-1",
      stepId: "step-1",
    });
    expect(insertValues).toEqual([
      "decision-1",
      "request-1",
      "thread-1",
      "run-1",
      "task-1",
      "step-1",
      "routing",
      "selected",
      "POLICY_MATCH",
      0.8,
      "policy-v1",
      "2026-08-27T00:00:00.000Z",
    ]);
  });

  it("finds records by decisionId, taskId, and stepId", async () => {
    const seenQueries: string[] = [];
    const db: Queryable = {
      query: createFakeQuery(async (text) => {
        seenQueries.push(text);
        return { rows: [recordRow()], rowCount: 1 };
      }),
    };
    const store = new PgDecisionRecordStore(db);

    await expect(store.findByDecisionId("decision-1")).resolves.toMatchObject({
      decisionId: "decision-1",
    });
    await expect(store.findByTaskId("task-1")).resolves.toHaveLength(1);
    await expect(store.findByStepId("step-1")).resolves.toHaveLength(1);
    expect(seenQueries.join("\n")).toContain("WHERE decision_id = $1");
    expect(seenQueries.join("\n")).toContain("WHERE task_id = $1");
    expect(seenQueries.join("\n")).toContain("WHERE step_id = $1");
  });

  it("rejects long open strings instead of truncating them", async () => {
    const db: Queryable = {
      query: vi.fn(async () => {
        throw new Error("write should not run");
      }),
    };
    const store = new PgDecisionRecordStore(db);

    await expect(
      store.record(record({ decisionType: "x".repeat(129) }))
    ).rejects.toThrow("decisionType must be at most 128 characters");
    expect(db.query).not.toHaveBeenCalled();
  });
});
