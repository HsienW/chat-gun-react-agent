import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../state-machine.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../state-machine.js")>();
  return {
    ...actual,
    transitionStep: vi.fn(actual.transitionStep),
  };
});

import { transitionStep } from "../state-machine.js";
import {
  createNoopOpikTracer,
  setOpikTracerForTests,
  type RetrySpanMetadata,
} from "../../platform/tracing/opik/opik-tracer.js";
import type { AgentStep, TaskEvent } from "../types.js";
import { executeWithRetry } from "./retry-executor.js";
import { DEFAULT_RETRY_POLICY } from "./retry-policy.js";
import type { RetryPolicy } from "./retry-policy.js";

const createdAt = "2026-07-29T00:00:00.000Z";

function createStep(status: AgentStep["status"] = "running"): AgentStep {
  return {
    stepId: "step-1",
    stepName: "generic_step",
    status,
    attempt: 1,
    maxAttempts: 9,
    createdAt,
    updatedAt: createdAt,
  };
}

function createPolicy(overrides: Partial<RetryPolicy> = {}): RetryPolicy {
  return {
    ...DEFAULT_RETRY_POLICY,
    backoffStrategy: "fixed",
    jitter: false,
    ...overrides,
  };
}

describe("executeWithRetry", () => {
  const events: TaskEvent[] = [];
  const onEvent = async (event: TaskEvent): Promise<void> => {
    events.push(event);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(createdAt));
    vi.mocked(transitionStep).mockClear();
    events.length = 0;
    setOpikTracerForTests(undefined);
  });

  afterEach(() => {
    setOpikTracerForTests(undefined);
    vi.useRealTimers();
  });

  it("completes on the first successful execution", async () => {
    const operation = vi.fn(async () => ({ output: "result" }));
    const originalStep = createStep();

    const result = await executeWithRetry(operation, {
      step: originalStep,
      taskId: "task-1",
      onEvent,
    });

    expect(result.succeeded).toBe(true);
    expect(result.finalStep).toMatchObject({
      status: "succeeded",
      output: "result",
      maxAttempts: DEFAULT_RETRY_POLICY.maxAttempts,
    });
    expect(result.budget.attempts).toBe(1);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(events.map((event) => event.eventType)).toEqual(["step_completed"]);
    expect(originalStep).toEqual(createStep());
  });

  it.each([
    [{ maxElapsedMs: 0 }, "RETRY_BUDGET_EXHAUSTED"],
    [{ maxAttempts: 0 }, "RETRY_BUDGET_EXHAUSTED"],
  ] satisfies [Partial<RetryPolicy>, string][])(
    "does not execute when the initial budget is exhausted",
    async (policyOverrides, expectedCode) => {
      const operation = vi.fn(async () => ({ output: "unexpected" }));

      const result = await executeWithRetry(operation, {
        policy: createPolicy(policyOverrides),
        step: createStep(),
        taskId: "task-1",
        onEvent,
      });

      expect(result.succeeded).toBe(false);
      expect(result.finalStep).toMatchObject({
        status: "terminal_failed",
        error: { code: expectedCode },
      });
      expect(result.budget.attempts).toBe(0);
      expect(operation).not.toHaveBeenCalled();
    }
  );

  it("does not execute when already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const operation = vi.fn(async () => ({ output: "unexpected" }));

    const result = await executeWithRetry(operation, {
      signal: controller.signal,
      step: createStep(),
      taskId: "task-1",
      onEvent,
    });

    expect(result.finalStep).toMatchObject({
      status: "terminal_failed",
      error: { code: "USER_CANCELLED" },
    });
    expect(operation).not.toHaveBeenCalled();
  });

  it("retries one timeout and then succeeds in the required transition order", async () => {
    const retrySpans: RetrySpanMetadata[] = [];
    const tracer = createNoopOpikTracer();
    tracer.withRetrySpan = async function withRetrySpanForTest<T>(
      metadata: RetrySpanMetadata,
      execution: () => Promise<T>
    ): Promise<T> {
      retrySpans.push(metadata);
      return execution();
    };
    setOpikTracerForTests(tracer);
    const operation = vi
      .fn()
      .mockResolvedValueOnce({ error: { code: "TIMEOUT", message: "Timed out" } })
      .mockResolvedValueOnce({ output: "result" });

    const execution = executeWithRetry(operation, {
      policy: createPolicy(),
      step: createStep(),
      taskId: "task-1",
      onEvent,
    });
    await vi.runAllTimersAsync();
    const result = await execution;

    expect(result.succeeded).toBe(true);
    expect(result.finalStep).toMatchObject({ status: "succeeded", attempt: 2 });
    expect(result.budget.attempts).toBe(2);
    expect(operation).toHaveBeenCalledTimes(2);
    expect(retrySpans).toEqual([
      { attempt: 2, reason: "timeout", stepId: "step-1" },
    ]);
    expect(vi.mocked(transitionStep).mock.calls.map((call) => call[1])).toEqual([
      "retryable_failed",
      "pending",
      "running",
      "succeeded",
    ]);
    expect(events.map((event) => event.eventType)).toEqual([
      "step_failed",
      "step_retrying",
      "step_completed",
    ]);
  });

  it("stops after the configured total execution cap", async () => {
    const operation = vi.fn(async () => ({
      error: { code: "TIMEOUT", message: "Timed out" },
    }));

    const execution = executeWithRetry(operation, {
      policy: createPolicy({ maxAttempts: 2 }),
      step: createStep(),
      taskId: "task-1",
      onEvent,
    });
    await vi.runAllTimersAsync();
    const result = await execution;

    expect(result.succeeded).toBe(false);
    expect(result.finalStep.status).toBe("terminal_failed");
    expect(result.budget.attempts).toBe(2);
    expect(operation).toHaveBeenCalledTimes(2);
    expect(vi.mocked(transitionStep).mock.calls.map((call) => call[1])).toEqual([
      "retryable_failed",
      "pending",
      "running",
      "terminal_failed",
    ]);
  });

  it("fails a non-retryable error without scheduling another execution", async () => {
    const operation = vi.fn(async () => ({
      error: { code: "PERMISSION_DENIED", message: "Denied" },
    }));

    const result = await executeWithRetry(operation, {
      step: createStep(),
      taskId: "task-1",
      onEvent,
    });

    expect(result.succeeded).toBe(false);
    expect(result.finalStep.status).toBe("terminal_failed");
    expect(result.budget.attempts).toBe(1);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(events.map((event) => event.eventType)).toEqual(["step_failed"]);
  });

  it("allows schema_invalid when the policy explicitly opts in", async () => {
    const operation = vi
      .fn()
      .mockResolvedValueOnce({
        error: { code: "SCHEMA_INVALID", message: "Invalid schema" },
      })
      .mockResolvedValueOnce({ output: "repaired" });

    const execution = executeWithRetry(operation, {
      policy: createPolicy({
        maxAttempts: 2,
        retryableCategories: [
          "timeout",
          "rate_limit",
          "server_error",
          "schema_invalid",
        ],
      }),
      step: createStep(),
      taskId: "task-1",
      onEvent,
    });
    await vi.runAllTimersAsync();
    const result = await execution;

    expect(result.succeeded).toBe(true);
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("cancels during backoff without entering pending or running", async () => {
    const controller = new AbortController();
    const operation = vi.fn(async () => ({
      error: { code: "TIMEOUT", message: "Timed out" },
    }));
    const execution = executeWithRetry(operation, {
      policy: createPolicy(),
      signal: controller.signal,
      step: createStep(),
      taskId: "task-1",
      onEvent,
    });
    await vi.advanceTimersByTimeAsync(0);

    controller.abort();
    const result = await execution;

    expect(result.succeeded).toBe(false);
    expect(result.finalStep).toMatchObject({
      status: "terminal_failed",
      error: { code: "USER_CANCELLED" },
    });
    expect(operation).toHaveBeenCalledTimes(1);
    expect(vi.mocked(transitionStep).mock.calls.map((call) => call[1])).toEqual([
      "retryable_failed",
      "terminal_failed",
    ]);
    expect(events.map((event) => event.eventType)).toEqual([
      "step_failed",
      "step_retrying",
      "step_failed",
    ]);
  });

  it("does not retry when the current step cannot enter retryable_failed", async () => {
    const step = createStep("succeeded");
    const operation = vi.fn(async () => ({
      error: { code: "TIMEOUT", message: "Timed out" },
    }));

    const result = await executeWithRetry(operation, {
      step,
      taskId: "task-1",
      onEvent,
    });

    expect(result).toMatchObject({
      finalStep: { status: "succeeded", maxAttempts: 3 },
      succeeded: false,
    });
    expect(step.maxAttempts).toBe(9);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(transitionStep).toHaveBeenCalledTimes(1);
    expect(events).toEqual([]);
  });
});
