import { describe, expect, it, vi } from "vitest";

import type { Queryable, StepRow } from "../persistence/rows.js";
import { NoopStepLock, type StepLock } from "./step-lock.js";
import { DefaultStepTransitionGuard } from "./step-transition-guard.js";

const createdAt = "2026-08-03T00:00:00.000Z";

function createStepRow(overrides: Partial<StepRow> = {}): StepRow {
  return {
    step_id: "step-1",
    task_id: "task-1",
    step_name: "runtime-step",
    status: "pending",
    attempt: 1,
    max_attempts: 2,
    input: null,
    output: null,
    error_code: null,
    error_message: null,
    error_details: null,
    started_at: null,
    completed_at: null,
    created_at: createdAt,
    updated_at: createdAt,
    ...overrides,
  };
}

function createDatabase(): Queryable {
  return { query: vi.fn() };
}

function createLock(): StepLock & {
  getCurrentOwner(stepId: string): Promise<string | undefined>;
} {
  return {
    acquire: vi.fn(async () => true),
    extend: vi.fn(async () => true),
    getCurrentOwner: vi.fn(async () => undefined),
    release: vi.fn(async () => undefined),
  };
}

describe("DefaultStepTransitionGuard", () => {
  it("performs a valid transition with DB CAS and releases the lock", async () => {
    const db = createDatabase();
    const lock = createLock();
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [createStepRow()], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [
          createStepRow({
            status: "running",
            output: { accepted: true },
            error_code: "warning",
            error_message: "Recoverable warning",
            error_details: { retryable: true },
            started_at: "2026-08-03T00:00:01.000Z",
            updated_at: "2026-08-03T00:00:01.000Z",
          }),
        ],
        rowCount: 1,
      });
    const guard = new DefaultStepTransitionGuard({ db, lock });

    const result = await guard.transition(
      "step-1",
      "pending",
      "running",
      "worker-A",
      {
        output: { accepted: true },
        error: {
          code: "warning",
          message: "Recoverable warning",
          details: { retryable: true },
        },
      }
    );

    expect(result).toEqual({
      outcome: "success",
      step: expect.objectContaining({
        error: {
          code: "warning",
          message: "Recoverable warning",
          details: { retryable: true },
        },
        output: { accepted: true },
        startedAt: "2026-08-03T00:00:01.000Z",
        status: "running",
      }),
    });
    expect(db.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("WHERE step_id = $1 AND status = $7"),
      [
        "step-1",
        "running",
        { accepted: true },
        "warning",
        "Recoverable warning",
        { retryable: true },
        "pending",
      ]
    );
    expect(lock.release).toHaveBeenCalledOnce();
  });

  it("returns the completed timestamp for a terminal transition", async () => {
    const db = createDatabase();
    const lock = createLock();
    vi.mocked(db.query)
      .mockResolvedValueOnce({
        rows: [createStepRow({ status: "running" })],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [
          createStepRow({
            status: "succeeded",
            completed_at: "2026-08-03T00:00:02.000Z",
            updated_at: "2026-08-03T00:00:02.000Z",
          }),
        ],
        rowCount: 1,
      });
    const guard = new DefaultStepTransitionGuard({ db, lock });

    await expect(
      guard.transition("step-1", "running", "succeeded", "worker-A")
    ).resolves.toEqual({
      outcome: "success",
      step: expect.objectContaining({
        completedAt: "2026-08-03T00:00:02.000Z",
        status: "succeeded",
      }),
    });
    expect(lock.release).toHaveBeenCalledOnce();
  });

  it("returns lock_contention with the best-effort current owner", async () => {
    const db = createDatabase();
    const lock = createLock();
    vi.mocked(db.query).mockResolvedValueOnce({
      rows: [createStepRow()],
      rowCount: 1,
    });
    vi.mocked(lock.acquire).mockResolvedValueOnce(false);
    vi.mocked(lock.getCurrentOwner).mockResolvedValueOnce("worker-B");
    const guard = new DefaultStepTransitionGuard({ db, lock });

    await expect(
      guard.transition("step-1", "pending", "running", "worker-A")
    ).resolves.toEqual({
      outcome: "lock_contention",
      currentOwner: "worker-B",
    });
    expect(lock.release).not.toHaveBeenCalled();
  });

  it("omits currentOwner when the best-effort lookup fails", async () => {
    const db = createDatabase();
    const lock = createLock();
    vi.mocked(db.query).mockResolvedValueOnce({
      rows: [createStepRow()],
      rowCount: 1,
    });
    vi.mocked(lock.acquire).mockResolvedValueOnce(false);
    vi.mocked(lock.getCurrentOwner).mockRejectedValueOnce(
      new Error("Redis unavailable")
    );
    const guard = new DefaultStepTransitionGuard({ db, lock });

    await expect(
      guard.transition("step-1", "pending", "running", "worker-A")
    ).resolves.toEqual({ outcome: "lock_contention" });
  });

  it("returns lock_contention when Redis acquire throws", async () => {
    const db = createDatabase();
    const lock = createLock();
    vi.mocked(db.query).mockResolvedValueOnce({
      rows: [createStepRow()],
      rowCount: 1,
    });
    vi.mocked(lock.acquire).mockRejectedValueOnce(
      new Error("Redis connection lost")
    );
    const guard = new DefaultStepTransitionGuard({ db, lock });

    await expect(
      guard.transition("step-1", "pending", "running", "worker-A")
    ).resolves.toEqual({ outcome: "lock_contention" });
    expect(db.query).toHaveBeenCalledOnce();
    expect(lock.release).not.toHaveBeenCalled();
  });

  it("returns the current status after a DB CAS mismatch", async () => {
    const db = createDatabase();
    const lock = createLock();
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [createStepRow()], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({
        rows: [createStepRow({ status: "running" })],
        rowCount: 1,
      });
    const guard = new DefaultStepTransitionGuard({ db, lock });

    await expect(
      guard.transition("step-1", "pending", "running", "worker-A")
    ).resolves.toEqual({
      outcome: "cas_mismatch",
      currentStatus: "running",
    });
    expect(lock.release).toHaveBeenCalledOnce();
  });

  it("rejects an illegal transition without acquiring the lock", async () => {
    const db = createDatabase();
    const lock = createLock();
    vi.mocked(db.query).mockResolvedValueOnce({
      rows: [createStepRow({ status: "succeeded" })],
      rowCount: 1,
    });
    const guard = new DefaultStepTransitionGuard({ db, lock });

    await expect(
      guard.transition("step-1", "succeeded", "running", "worker-A")
    ).resolves.toEqual({
      outcome: "invalid_transition",
      reason: "invalid step transition: succeeded -> running",
    });
    expect(lock.acquire).not.toHaveBeenCalled();
    expect(lock.release).not.toHaveBeenCalled();
  });

  it("returns invalid_transition when the step does not exist", async () => {
    const db = createDatabase();
    const lock = createLock();
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const guard = new DefaultStepTransitionGuard({ db, lock });

    await expect(
      guard.transition("missing-step", "pending", "running", "worker-A")
    ).resolves.toEqual({
      outcome: "invalid_transition",
      reason: "step not found: missing-step",
    });
    expect(lock.acquire).not.toHaveBeenCalled();
  });

  it("releases the lock when the DB CAS query throws", async () => {
    const db = createDatabase();
    const lock = createLock();
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [createStepRow()], rowCount: 1 })
      .mockRejectedValueOnce(new Error("Database unavailable"));
    const guard = new DefaultStepTransitionGuard({ db, lock });

    await expect(
      guard.transition("step-1", "pending", "running", "worker-A")
    ).rejects.toThrow("Database unavailable");
    expect(lock.release).toHaveBeenCalledOnce();
  });

  it("performs DB CAS through the NoopStepLock path", async () => {
    const db = createDatabase();
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [createStepRow()], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [createStepRow({ status: "running" })],
        rowCount: 1,
      });
    const guard = new DefaultStepTransitionGuard({
      db,
      lock: new NoopStepLock(),
    });

    await expect(
      guard.transition("step-1", "pending", "running", "worker-A")
    ).resolves.toEqual({
      outcome: "success",
      step: expect.objectContaining({ status: "running" }),
    });
    expect(db.query).toHaveBeenCalledTimes(2);
  });
});
