import { describe, expect, it } from "vitest";

import {
  ActiveRunOwnershipConflictError,
  PgActiveRunOwnershipRepository,
  type ActiveRunOwnership,
  type OwnershipDatabase,
} from "./ownership.js";
import type { Queryable } from "../persistence/rows.js";

type OwnershipRow = {
  thread_id: string;
  scope_id: string;
  task_id: string;
  run_id: string;
  status: ActiveRunOwnership["status"];
  generation: number;
  superseded_by_run_id: string | null;
  updated_at: string;
};

class FakeOwnershipDatabase implements OwnershipDatabase {
  readonly rows: OwnershipRow[] = [];
  private transactionTail: Promise<void> = Promise.resolve();

  async withTransaction<TResult>(
    operation: (transaction: Queryable) => Promise<TResult>
  ): Promise<TResult> {
    const previousTransaction = this.transactionTail;
    let releaseTransaction: () => void = () => undefined;
    this.transactionTail = new Promise<void>((resolve) => {
      releaseTransaction = resolve;
    });
    await previousTransaction;
    const snapshot = structuredClone(this.rows);
    try {
      return await operation(this);
    } catch (error) {
      this.rows.splice(0, this.rows.length, ...snapshot);
      throw error;
    } finally {
      releaseTransaction();
    }
  }

  async query<TResult extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<{ rows: TResult[]; rowCount: number | null }> {
    if (text.includes("SELECT") && text.includes("status = 'active'")) {
      const row = this.rows.find(
        (candidate) =>
          candidate.thread_id === values[0] &&
          candidate.scope_id === values[1] &&
          candidate.status === "active"
      );
      return {
        rows: row ? [structuredClone(row) as unknown as TResult] : [],
        rowCount: row ? 1 : 0,
      };
    }

    if (text.includes("INSERT INTO active_run_ownership")) {
      const activeExists = this.rows.some(
        (candidate) =>
          candidate.thread_id === values[0] &&
          candidate.scope_id === values[1] &&
          candidate.status === "active"
      );
      if (activeExists) return { rows: [], rowCount: 0 };

      const row: OwnershipRow = {
        thread_id: String(values[0]),
        scope_id: String(values[1]),
        task_id: String(values[2]),
        run_id: String(values[3]),
        status: "active",
        generation: Number(values[4]),
        superseded_by_run_id: null,
        updated_at: "2026-08-20T00:00:00.000Z",
      };
      this.rows.push(row);
      return { rows: [structuredClone(row) as unknown as TResult], rowCount: 1 };
    }

    if (text.includes("SET status = 'superseded'")) {
      const row = this.rows.find(
        (candidate) =>
          candidate.thread_id === values[0] &&
          candidate.scope_id === values[1] &&
          candidate.generation === values[2] &&
          candidate.status === "active"
      );
      if (!row) return { rows: [], rowCount: 0 };
      row.status = "superseded";
      row.superseded_by_run_id = String(values[3]);
      return { rows: [structuredClone(row) as unknown as TResult], rowCount: 1 };
    }

    throw new Error(`Unexpected SQL in fake ownership database: ${text}`);
  }
}

describe("PgActiveRunOwnershipRepository", () => {
  it("claims and reads the single authoritative run at generation one", async () => {
    const repository = new PgActiveRunOwnershipRepository(
      new FakeOwnershipDatabase()
    );

    const claimed = await repository.claim({
      threadId: "thread-1",
      scopeId: "scope-1",
      taskId: "task-1",
      runId: "run-1",
    });

    expect(claimed).toMatchObject({
      status: "active",
      generation: 1,
      runId: "run-1",
    });
    await expect(repository.findActive("thread-1", "scope-1")).resolves.toEqual(
      claimed
    );
  });

  it("atomically supersedes the prior run and increments generation", async () => {
    const database = new FakeOwnershipDatabase();
    const repository = new PgActiveRunOwnershipRepository(database);
    await repository.claim({
      threadId: "thread-1",
      scopeId: "scope-1",
      taskId: "task-1",
      runId: "run-1",
    });

    const replacement = await repository.supersede({
      threadId: "thread-1",
      scopeId: "scope-1",
      expectedGeneration: 1,
      replacementTaskId: "task-2",
      replacementRunId: "run-2",
    });

    expect(replacement).toMatchObject({
      runId: "run-2",
      generation: 2,
      status: "active",
    });
    expect(database.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          run_id: "run-1",
          status: "superseded",
          superseded_by_run_id: "run-2",
        }),
      ])
    );
    expect(database.rows.filter((row) => row.status === "active")).toHaveLength(1);
  });

  it("allows exactly one racing CAS supersede to succeed", async () => {
    const database = new FakeOwnershipDatabase();
    const repository = new PgActiveRunOwnershipRepository(database);
    await repository.claim({
      threadId: "thread-1",
      scopeId: "scope-1",
      taskId: "task-1",
      runId: "run-1",
    });

    const attempts = await Promise.allSettled([
      repository.supersede({
        threadId: "thread-1",
        scopeId: "scope-1",
        expectedGeneration: 1,
        replacementTaskId: "task-2",
        replacementRunId: "run-2",
      }),
      repository.supersede({
        threadId: "thread-1",
        scopeId: "scope-1",
        expectedGeneration: 1,
        replacementTaskId: "task-3",
        replacementRunId: "run-3",
      }),
    ]);

    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
    expect(
      attempts.find((attempt) => attempt.status === "rejected")
    ).toMatchObject({ reason: expect.any(ActiveRunOwnershipConflictError) });
    expect(database.rows.filter((row) => row.status === "active")).toHaveLength(1);
  });
});
