import { describe, expect, it, vi } from "vitest";

import type { Queryable, StepRow } from "../persistence/rows.js";
import {
  RedisStepLock,
  type RedisLockClient,
} from "./step-lock.js";
import { DefaultStepTransitionGuard } from "./step-transition-guard.js";

const createdAt = "2026-08-03T00:00:00.000Z";

function createStepRow(): StepRow {
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
  };
}

function createStatefulRedisClient(): RedisLockClient {
  const owners = new Map<string, string>();
  return {
    async set(key, owner) {
      if (owners.has(key)) {
        return null;
      }
      owners.set(key, owner);
      return "OK";
    },
    async get(key) {
      return owners.get(key) ?? null;
    },
    async eval(script, _numberOfKeys, key, owner) {
      if (owners.get(key) !== owner) {
        return 0;
      }
      if (script.includes('redis.call("DEL"')) {
        owners.delete(key);
      }
      return 1;
    },
  };
}

function createDatabase(): Queryable {
  return { query: vi.fn() };
}

describe("distributed step lock integration", () => {
  it("blocks a competing guard and then completes the DB CAS flow", async () => {
    const db = createDatabase();
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [createStepRow()], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [createStepRow()], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [
          {
            ...createStepRow(),
            status: "running",
            output: { accepted: true },
            started_at: "2026-08-03T00:00:01.000Z",
            updated_at: "2026-08-03T00:00:01.000Z",
          },
        ],
        rowCount: 1,
      });
    const redisClient = createStatefulRedisClient();
    const lock = new RedisStepLock(redisClient);
    const guard = new DefaultStepTransitionGuard({ db, lock });

    await expect(lock.acquire("step-1", "worker-B", 30_000)).resolves.toBe(
      true
    );
    await lock.release("step-1", "worker-A");
    await expect(lock.acquire("step-1", "worker-C", 30_000)).resolves.toBe(
      false
    );
    await expect(
      guard.transition("step-1", "pending", "running", "worker-A")
    ).resolves.toEqual({
      outcome: "lock_contention",
      currentOwner: "worker-B",
    });

    await lock.release("step-1", "worker-B");

    await expect(
      guard.transition("step-1", "pending", "running", "worker-A", {
        output: { accepted: true },
      })
    ).resolves.toEqual({
      outcome: "success",
      step: expect.objectContaining({
        output: { accepted: true },
        startedAt: "2026-08-03T00:00:01.000Z",
        status: "running",
      }),
    });
    await expect(lock.acquire("step-1", "worker-C", 30_000)).resolves.toBe(
      true
    );
  });
});
