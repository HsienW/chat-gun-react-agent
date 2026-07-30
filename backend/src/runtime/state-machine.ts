import type {
  AgentStep,
  AgentTask,
  StepError,
  StepStatus,
  TaskStatus,
  TransitionResult,
} from "./types.js";

export const TASK_TRANSITIONS: ReadonlyMap<TaskStatus, ReadonlySet<TaskStatus>> =
  new Map<TaskStatus, ReadonlySet<TaskStatus>>([
    ["created", new Set(["running", "cancelled"])],
    [
      "running",
      new Set([
        "waiting_confirmation",
        "completed",
        "partially_failed",
        "failed",
        "cancelled",
      ]),
    ],
    ["waiting_confirmation", new Set(["running", "completed", "cancelled"])],
    ["partially_failed", new Set(["compensating"])],
    ["compensating", new Set(["failed"])],
    ["completed", new Set()],
    ["failed", new Set()],
    ["cancelled", new Set()],
  ]);

export const STEP_TRANSITIONS: ReadonlyMap<StepStatus, ReadonlySet<StepStatus>> =
  new Map<StepStatus, ReadonlySet<StepStatus>>([
    ["pending", new Set(["running", "skipped"])],
    [
      "running",
      new Set([
        "waiting_confirmation",
        "succeeded",
        "retryable_failed",
        "terminal_failed",
        "compensating",
        "skipped",
      ]),
    ],
    ["waiting_confirmation", new Set(["succeeded"])],
    ["retryable_failed", new Set(["pending", "terminal_failed"])],
    ["compensating", new Set(["compensated"])],
    ["succeeded", new Set()],
    ["terminal_failed", new Set()],
    ["compensated", new Set()],
    ["skipped", new Set()],
  ]);

function nowIso(): string {
  return new Date().toISOString();
}

function isTransitionAllowed<TStatus extends string>(
  transitions: ReadonlyMap<TStatus, ReadonlySet<TStatus>>,
  from: TStatus,
  to: TStatus
): boolean {
  return transitions.get(from)?.has(to) ?? false;
}

export function transitionTask<TStep extends string>(
  task: AgentTask<TStep>,
  to: TaskStatus
): TransitionResult<AgentTask<TStep>> {
  if (!isTransitionAllowed(TASK_TRANSITIONS, task.status, to)) {
    return {
      valid: false,
      reason: `invalid task transition: ${task.status} -> ${to}`,
    };
  }

  return {
    valid: true,
    next: {
      ...task,
      status: to,
      updatedAt: nowIso(),
    },
  };
}

export interface StepTransitionOptions {
  error?: StepError;
  output?: unknown;
}

export function transitionStep<TStep extends string>(
  step: AgentStep<TStep>,
  to: StepStatus,
  opts: StepTransitionOptions = {}
): TransitionResult<AgentStep<TStep>> {
  if (!isTransitionAllowed(STEP_TRANSITIONS, step.status, to)) {
    return {
      valid: false,
      reason: `invalid step transition: ${step.status} -> ${to}`,
    };
  }

  if (step.status === "retryable_failed" && to === "pending") {
    if (step.attempt >= step.maxAttempts) {
      return { valid: false, reason: "max attempts exceeded" };
    }
  }

  const nextAttempt =
    step.status === "retryable_failed" && to === "pending"
      ? step.attempt + 1
      : step.attempt;
  const isStarting = to === "running" && step.startedAt === undefined;
  const isCompleted =
    to === "succeeded" ||
    to === "terminal_failed" ||
    to === "compensated" ||
    to === "skipped";

  return {
    valid: true,
    next: {
      ...step,
      status: to,
      attempt: nextAttempt,
      ...(isStarting ? { startedAt: nowIso() } : {}),
      ...(isCompleted ? { completedAt: nowIso() } : {}),
      ...(opts.output !== undefined ? { output: opts.output } : {}),
      ...(opts.error !== undefined ? { error: opts.error } : {}),
      updatedAt: nowIso(),
    },
  };
}

export function transitionTaskStep<TStep extends string>(
  task: AgentTask<TStep>,
  stepId: string,
  to: StepStatus,
  opts: StepTransitionOptions = {}
): TransitionResult<AgentTask<TStep>> {
  if (task.status === "completed" || task.status === "failed" || task.status === "cancelled") {
    return {
      valid: false,
      reason: `task is terminal: ${task.status}`,
    };
  }

  const step = task.steps.find((candidateStep) => candidateStep.stepId === stepId);
  if (!step) {
    return {
      valid: false,
      reason: `step not found: ${stepId}`,
    };
  }

  const stepTransition = transitionStep(step, to, opts);
  if (!stepTransition.valid) {
    return stepTransition;
  }

  return {
    valid: true,
    next: {
      ...task,
      steps: task.steps.map((candidateStep) =>
        candidateStep.stepId === stepId ? stepTransition.next : candidateStep
      ),
      updatedAt: stepTransition.next.updatedAt,
    },
  };
}
