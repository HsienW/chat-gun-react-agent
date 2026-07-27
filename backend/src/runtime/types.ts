export const TASK_STATUSES = [
  "created",
  "running",
  "waiting_confirmation",
  "completed",
  "partially_failed",
  "compensating",
  "failed",
  "cancelled",
] as const;

export type TaskStatus =
  | "created"
  | "running"
  | "waiting_confirmation"
  | "completed"
  | "partially_failed"
  | "compensating"
  | "failed"
  | "cancelled";

export const STEP_STATUSES = [
  "pending",
  "running",
  "waiting_confirmation",
  "succeeded",
  "retryable_failed",
  "terminal_failed",
  "compensating",
  "compensated",
  "skipped",
] as const;

export type StepStatus =
  | "pending"
  | "running"
  | "waiting_confirmation"
  | "succeeded"
  | "retryable_failed"
  | "terminal_failed"
  | "compensating"
  | "compensated"
  | "skipped";

export interface StepError {
  code: string;
  message: string;
  details?: unknown;
}

export interface AgentStep<TStep extends string = string> {
  stepId: string;
  stepName: TStep;
  status: StepStatus;
  attempt: number;
  maxAttempts: number;
  input?: unknown;
  output?: unknown;
  error?: StepError;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentTask<TStep extends string = string> {
  taskId: string;
  taskType: string;
  status: TaskStatus;
  steps: AgentStep<TStep>[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export const TASK_EVENT_TYPES = [
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
] as const;

export type TaskEventType =
  | "task_created"
  | "step_started"
  | "step_completed"
  | "step_failed"
  | "step_retrying"
  | "task_completed"
  | "task_failed"
  | "task_cancelled"
  | "compensation_triggered"
  | "compensation_completed"
  | "waiting_confirmation"
  | "resumed";

export interface TaskEvent {
  eventId: string;
  taskId: string;
  stepId?: string;
  eventType: TaskEventType;
  payload?: unknown;
  createdAt: string;
}

export type TransitionResult<T> =
  | { valid: true; next: T }
  | { valid: false; reason: string };
