import { describe, expect, it, vi } from "vitest";

import {
  createCompensationCompletedEvent,
  createCompensationTriggeredEvent,
  createResumedEvent,
  createStepCompletedEvent,
  createStepFailedEvent,
  createStepRetryingEvent,
  createStepStartedEvent,
  createTaskCancelledEvent,
  createTaskCompletedEvent,
  createTaskCreatedEvent,
  createTaskFailedEvent,
  createWaitingConfirmationEvent,
} from "./events.js";
import type { AgentStep, AgentTask, StepError, TaskEvent, TaskEventType } from "./types.js";

const createdAt = "2026-07-27T00:00:00.000Z";

const task: AgentTask = {
  taskId: "task-1",
  taskType: "recommendation",
  status: "running",
  steps: [],
  metadata: {},
  createdAt,
  updatedAt: createdAt,
};

const step: AgentStep = {
  stepId: "step-1",
  stepName: "extract_intent",
  status: "running",
  attempt: 1,
  maxAttempts: 2,
  createdAt,
  updatedAt: createdAt,
};

const error: StepError = { code: "timeout", message: "Timed out" };

describe("TaskEvent factories", () => {
  it("creates all 12 task event variants with deterministic identifiers", () => {
    vi.setSystemTime(new Date("2026-07-27T03:00:00.000Z"));
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "00000000-0000-4000-8000-000000000001"
    );

    const events = [
      createTaskCreatedEvent(task),
      createStepStartedEvent(task.taskId, step),
      createStepCompletedEvent(task.taskId, step),
      createStepFailedEvent(task.taskId, step, error),
      createStepRetryingEvent(task.taskId, step),
      createTaskCompletedEvent(task),
      createTaskFailedEvent(task, error),
      createTaskCancelledEvent(task),
      createCompensationTriggeredEvent(task),
      createCompensationCompletedEvent(task),
      createWaitingConfirmationEvent(task, step),
      createResumedEvent(task),
    ];

    expect(events.map((event) => event.eventType)).toEqual([
      "task_created",
      "step_started",
      "step_completed",
      "step_failed",
      "step_retrying",
      "task_completed",
      "task_failed",
      "task_cancelled",
      "compensation_triggered",
      "compensation_completed",
      "waiting_confirmation",
      "resumed",
    ] satisfies TaskEventType[]);
    for (const event of events) {
      expect(event).toEqual(
        expect.objectContaining({
          eventId: "00000000-0000-4000-8000-000000000001",
          taskId: task.taskId,
          createdAt: "2026-07-27T03:00:00.000Z",
        } satisfies Partial<TaskEvent>)
      );
    }
  });

  it("adds stepId only for step-scoped events", () => {
    expect(createStepStartedEvent(task.taskId, step).stepId).toBe(step.stepId);
    expect(createWaitingConfirmationEvent(task).stepId).toBeUndefined();
  });

  it("includes error payloads for failed events", () => {
    expect(createStepFailedEvent(task.taskId, step, error).payload).toEqual({
      step,
      error,
    });
    expect(createTaskFailedEvent(task, error).payload).toEqual({
      task,
      error,
    });
  });
});
