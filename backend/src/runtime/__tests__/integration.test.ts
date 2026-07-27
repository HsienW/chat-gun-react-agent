import { describe, expect, it } from "vitest";

import { getPool } from "../persistence/connection.js";
import { PgEventRepository } from "../persistence/event-repository.js";
import { runMigrations } from "../persistence/migration-runner.js";
import { PgStepRepository } from "../persistence/step-repository.js";
import { PgTaskRepository } from "../persistence/task-repository.js";
import {
  transitionStep,
  transitionTask,
  transitionTaskStep,
} from "../state-machine.js";
import type { AgentStep, AgentTask } from "../types.js";

const createdAt = "2026-07-27T00:00:00.000Z";

function createStep(overrides: Partial<AgentStep> = {}): AgentStep {
  return {
    stepId: "step-1",
    stepName: "extract_intent",
    status: "pending",
    attempt: 1,
    maxAttempts: 2,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

function createTask(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    taskId: "task-1",
    taskType: "recommendation",
    status: "created",
    steps: [createStep()],
    metadata: {},
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

describe("runtime task lifecycle integration", () => {
  it("creates a task, transitions steps, and reaches completed", () => {
    const task = createTask();
    const runningTask = transitionTask(task, "running");
    expect(runningTask.valid).toBe(true);

    const runningStepTask = runningTask.valid
      ? transitionTaskStep(runningTask.next, "step-1", "running")
      : runningTask;
    expect(runningStepTask.valid).toBe(true);

    const succeededStepTask = runningStepTask.valid
      ? transitionTaskStep(runningStepTask.next, "step-1", "succeeded")
      : runningStepTask;
    expect(succeededStepTask.valid && succeededStepTask.next.steps[0].status).toBe("succeeded");

    const completedTask = succeededStepTask.valid
      ? transitionTask(succeededStepTask.next, "completed")
      : succeededStepTask;
    expect(completedTask.valid && completedTask.next.status).toBe("completed");
  });

  it("rejects step transitions after task cancellation", () => {
    const cancelledTask = createTask({ status: "cancelled" });

    expect(transitionTaskStep(cancelledTask, "step-1", "running")).toEqual({
      valid: false,
      reason: "task is terminal: cancelled",
    });
  });

  it("moves retryable step failures to terminal_failed after maxAttempts", () => {
    const retryableFailure = transitionStep(
      createStep({ status: "retryable_failed", attempt: 2, maxAttempts: 2 }),
      "pending"
    );
    expect(retryableFailure).toEqual({
      valid: false,
      reason: "max attempts exceeded",
    });

    const terminalFailure = transitionStep(
      createStep({ status: "retryable_failed", attempt: 2, maxAttempts: 2 }),
      "terminal_failed",
      { error: { code: "timeout", message: "Timed out" } }
    );
    expect(terminalFailure.valid && terminalFailure.next.status).toBe("terminal_failed");
  });
});

describe.skipIf(!process.env.DATABASE_URL)("runtime PostgreSQL integration", () => {
  it("persists task, step, and event records when DATABASE_URL is configured", async () => {
    const pool = getPool();
    expect(pool).not.toBeNull();
    if (!pool) return;

    await runMigrations("up", pool);

    const taskRepository = new PgTaskRepository(pool);
    const stepRepository = new PgStepRepository(pool);
    const eventRepository = new PgEventRepository(pool);
    const taskId = `task-${globalThis.crypto.randomUUID()}`;
    const stepId = `step-${globalThis.crypto.randomUUID()}`;
    const task = createTask({ taskId, steps: [] });
    const step = createStep({ stepId });

    await taskRepository.create(task);
    await stepRepository.create({ ...step, taskId });
    await eventRepository.append({
      eventId: `event-${globalThis.crypto.randomUUID()}`,
      taskId,
      stepId,
      eventType: "step_started",
      payload: { step },
      createdAt,
    });

    await expect(taskRepository.findById(taskId)).resolves.toEqual(
      expect.objectContaining({
        taskId,
        steps: [expect.objectContaining({ stepId })],
      })
    );
    await expect(eventRepository.findByTaskId(taskId)).resolves.toHaveLength(1);

    await pool.query("DELETE FROM agent_tasks WHERE task_id = $1", [taskId]);
  });
});
