import type { RetryPolicy } from "./retry-policy.js";

export type BudgetExhaustionReason = "max_attempts" | "max_elapsed" | "cancelled";

export interface RetryBudget {
  stepId: string;
  maxAttempts: number;
  maxElapsedMs: number;
  startedAt: number;
  attempts: number;
}

export interface BudgetCheckResult {
  exhausted: boolean;
  reason?: BudgetExhaustionReason;
  canRetry: boolean;
}

export function createBudget(stepId: string, policy: RetryPolicy): RetryBudget {
  return {
    stepId,
    maxAttempts: policy.maxAttempts,
    maxElapsedMs: policy.maxElapsedMs,
    startedAt: Date.now(),
    attempts: 0,
  };
}

export function checkBudget(
  budget: RetryBudget,
  signal?: AbortSignal
): BudgetCheckResult {
  if (signal?.aborted === true) {
    return { exhausted: true, reason: "cancelled", canRetry: false };
  }
  if (budget.attempts >= budget.maxAttempts) {
    return { exhausted: true, reason: "max_attempts", canRetry: false };
  }
  if (Date.now() - budget.startedAt >= budget.maxElapsedMs) {
    return { exhausted: true, reason: "max_elapsed", canRetry: false };
  }
  return { exhausted: false, canRetry: true };
}

export function recordAttempt(budget: RetryBudget): RetryBudget {
  return {
    ...budget,
    attempts: budget.attempts + 1,
  };
}
