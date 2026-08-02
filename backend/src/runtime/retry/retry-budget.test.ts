import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkBudget, createBudget, recordAttempt } from "./retry-budget.js";
import { DEFAULT_RETRY_POLICY } from "./retry-policy.js";
import type { RetryBudget } from "./retry-budget.js";
import type { RetryPolicy } from "./retry-policy.js";

const now = new Date("2026-07-29T00:00:00.000Z");

function createPolicy(overrides: Partial<RetryPolicy> = {}): RetryPolicy {
  return {
    ...DEFAULT_RETRY_POLICY,
    jitter: false,
    ...overrides,
  };
}

function createTestBudget(overrides: Partial<RetryBudget> = {}): RetryBudget {
  return {
    stepId: "step-1",
    maxAttempts: 3,
    maxElapsedMs: 60_000,
    startedAt: now.getTime() - 10_000,
    attempts: 1,
    ...overrides,
  };
}

describe("retry policy and budget", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("provides the approved default retry policy", () => {
    expect(DEFAULT_RETRY_POLICY).toEqual({
      maxAttempts: 3,
      maxElapsedMs: 60_000,
      retryableCategories: ["timeout", "rate_limit", "server_error"],
      backoffStrategy: "exponential",
      jitter: true,
    });
  });

  it("creates a budget from policy without recording an execution", () => {
    expect(
      createBudget("step-1", createPolicy({ maxAttempts: 5, maxElapsedMs: 30_000 }))
    ).toEqual({
      stepId: "step-1",
      maxAttempts: 5,
      maxElapsedMs: 30_000,
      startedAt: now.getTime(),
      attempts: 0,
    });
  });

  it("allows retry while attempts and elapsed time remain", () => {
    expect(checkBudget(createTestBudget())).toEqual({
      exhausted: false,
      canRetry: true,
    });
  });

  it("reports max attempts exhaustion", () => {
    expect(checkBudget(createTestBudget({ attempts: 3 }))).toEqual({
      exhausted: true,
      reason: "max_attempts",
      canRetry: false,
    });
  });

  it("reports elapsed time exhaustion at the boundary", () => {
    expect(
      checkBudget(createTestBudget({ startedAt: now.getTime() - 60_000 }))
    ).toEqual({
      exhausted: true,
      reason: "max_elapsed",
      canRetry: false,
    });
  });

  it("gives cancellation priority over all other exhaustion reasons", () => {
    const controller = new AbortController();
    controller.abort();

    expect(
      checkBudget(
        createTestBudget({ attempts: 3, startedAt: now.getTime() - 60_000 }),
        controller.signal
      )
    ).toEqual({
      exhausted: true,
      reason: "cancelled",
      canRetry: false,
    });
  });

  it("gives max attempts priority over elapsed time", () => {
    expect(
      checkBudget(createTestBudget({ attempts: 3, startedAt: now.getTime() - 60_000 }))
    ).toEqual({
      exhausted: true,
      reason: "max_attempts",
      canRetry: false,
    });
  });

  it("records an attempt immutably", () => {
    const budget = createTestBudget({ attempts: 0 });

    const updatedBudget = recordAttempt(budget);

    expect(updatedBudget).toEqual({ ...budget, attempts: 1 });
    expect(updatedBudget).not.toBe(budget);
    expect(budget.attempts).toBe(0);
  });
});
