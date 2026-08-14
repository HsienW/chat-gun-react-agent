import {
  createStepCompletedEvent,
  createStepFailedEvent,
  createStepRetryingEvent,
} from "../events.js";
import { transitionStep } from "../state-machine.js";
import type { AgentStep, StepError, TaskEvent } from "../types.js";
import { computeBackoff } from "./backoff.js";
import { classifyError } from "./error-classification.js";
import {
  checkBudget,
  createBudget,
  recordAttempt,
} from "./retry-budget.js";
import type {
  BudgetCheckResult,
  RetryBudget,
} from "./retry-budget.js";
import { DEFAULT_RETRY_POLICY } from "./retry-policy.js";
import type { RetryPolicy } from "./retry-policy.js";
import {
  getOpikTracer,
  type RetrySpanMetadata,
} from "../../platform/tracing/opik/opik-tracer.js";

export interface RetryConfig<TStep extends string = string> {
  policy?: RetryPolicy;
  step: AgentStep<TStep>;
  taskId: string;
  signal?: AbortSignal;
  onEvent: (event: TaskEvent) => Promise<void>;
}

export interface RetryResult<TStep extends string = string> {
  finalStep: AgentStep<TStep>;
  budget: RetryBudget;
  succeeded: boolean;
}

export interface RetryOperationResult {
  output?: unknown;
  error?: StepError;
  statusCode?: number;
  retryAfterHeader?: string;
}

function createBudgetError(check: BudgetCheckResult): StepError {
  if (check.reason === "cancelled") {
    return {
      code: "USER_CANCELLED",
      message: "Retry execution was cancelled",
    };
  }
  return {
    code: "RETRY_BUDGET_EXHAUSTED",
    message: `Retry budget exhausted: ${check.reason ?? "unknown"}`,
  };
}

async function waitForBackoff(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (delayMs <= 0 || signal?.aborted === true) {
    return;
  }

  await new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const timeout = setTimeout(finish, delayMs);
    signal?.addEventListener("abort", finish, { once: true });
  });
}

async function transitionToTerminalFailure<TStep extends string>(
  step: AgentStep<TStep>,
  budget: RetryBudget,
  error: StepError,
  config: RetryConfig<TStep>
): Promise<RetryResult<TStep>> {
  const transition = transitionStep(step, "terminal_failed", { error });
  if (!transition.valid) {
    return { finalStep: step, budget, succeeded: false };
  }

  await config.onEvent(createStepFailedEvent(config.taskId, transition.next, error));
  return { finalStep: transition.next, budget, succeeded: false };
}

export async function executeWithRetry<TStep extends string = string>(
  operation: () => Promise<RetryOperationResult>,
  config: RetryConfig<TStep>
): Promise<RetryResult<TStep>> {
  const policy = config.policy ?? DEFAULT_RETRY_POLICY;
  let budget = createBudget(config.step.stepId, policy);
  let currentStep: AgentStep<TStep> = {
    ...config.step,
    maxAttempts: policy.maxAttempts,
  };
  let retrySpanMetadata: RetrySpanMetadata | undefined;

  while (true) {
    const preExecutionCheck = checkBudget(budget, config.signal);
    if (preExecutionCheck.exhausted) {
      return transitionToTerminalFailure(
        currentStep,
        budget,
        createBudgetError(preExecutionCheck),
        config
      );
    }

    const operationResult = retrySpanMetadata
      ? await getOpikTracer().withRetrySpan(retrySpanMetadata, operation)
      : await operation();
    retrySpanMetadata = undefined;
    budget = recordAttempt(budget);

    if (operationResult.error === undefined) {
      const successTransition = transitionStep(currentStep, "succeeded", {
        output: operationResult.output,
      });
      if (!successTransition.valid) {
        return { finalStep: currentStep, budget, succeeded: false };
      }
      currentStep = successTransition.next;
      await config.onEvent(createStepCompletedEvent(config.taskId, currentStep));
      return { finalStep: currentStep, budget, succeeded: true };
    }

    const classifiedError = classifyError(operationResult.error, {
      statusCode: operationResult.statusCode,
      retryAfterHeader: operationResult.retryAfterHeader,
    });
    const canRetryCategory = policy.retryableCategories.includes(
      classifiedError.category
    );
    if (!canRetryCategory) {
      return transitionToTerminalFailure(
        currentStep,
        budget,
        operationResult.error,
        config
      );
    }

    const postExecutionCheck = checkBudget(budget, config.signal);
    if (postExecutionCheck.exhausted) {
      const terminalError =
        postExecutionCheck.reason === "cancelled"
          ? createBudgetError(postExecutionCheck)
          : operationResult.error;
      return transitionToTerminalFailure(
        currentStep,
        budget,
        terminalError,
        config
      );
    }

    const failureTransition = transitionStep(currentStep, "retryable_failed", {
      error: operationResult.error,
    });
    if (!failureTransition.valid) {
      return { finalStep: currentStep, budget, succeeded: false };
    }
    currentStep = failureTransition.next;
    await config.onEvent(
      createStepFailedEvent(config.taskId, currentStep, operationResult.error)
    );
    await config.onEvent(createStepRetryingEvent(config.taskId, currentStep));

    const delayMs = computeBackoff(policy.backoffStrategy, budget.attempts, {
      retryAfterMs: classifiedError.retryAfterMs,
      jitter: policy.jitter,
    });
    await waitForBackoff(delayMs, config.signal);

    const postBackoffCheck = checkBudget(budget, config.signal);
    if (postBackoffCheck.exhausted) {
      const terminalError =
        postBackoffCheck.reason === "cancelled"
          ? createBudgetError(postBackoffCheck)
          : operationResult.error;
      return transitionToTerminalFailure(
        currentStep,
        budget,
        terminalError,
        config
      );
    }

    const pendingTransition = transitionStep(currentStep, "pending");
    if (!pendingTransition.valid) {
      return transitionToTerminalFailure(
        currentStep,
        budget,
        operationResult.error,
        config
      );
    }
    currentStep = pendingTransition.next;

    const runningTransition = transitionStep(currentStep, "running");
    if (!runningTransition.valid) {
      return { finalStep: currentStep, budget, succeeded: false };
    }
    currentStep = runningTransition.next;
    retrySpanMetadata = {
      attempt: budget.attempts + 1,
      reason: classifiedError.category,
      stepId: config.step.stepId,
    };
  }
}
