import type { AgentStep, AgentTask, StepError, StepStatus, TaskEvent, TaskEventType, TaskStatus } from "../types.js";
import { STEP_STATUSES, TASK_EVENT_TYPES, TASK_STATUSES } from "../types.js";

export interface Queryable {
  query<TResult extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[]
  ): Promise<{ rows: TResult[]; rowCount: number | null }>;
}

export interface TaskRow extends Record<string, unknown> {
  task_id: string;
  task_type: string;
  status: string;
  metadata: unknown;
  created_at: string | Date;
  updated_at: string | Date;
}

export interface StepRow extends Record<string, unknown> {
  step_id: string;
  task_id: string;
  step_name: string;
  status: string;
  attempt: number;
  max_attempts: number;
  input: unknown;
  output: unknown;
  error_code: string | null;
  error_message: string | null;
  error_details: unknown;
  started_at: string | Date | null;
  completed_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
}

export interface EventRow extends Record<string, unknown> {
  event_id: string;
  task_id: string;
  step_id: string | null;
  event_type: string;
  payload: unknown;
  created_at: string | Date;
}

function isTaskStatus(value: string): value is TaskStatus {
  return TASK_STATUSES.includes(value as TaskStatus);
}

function isStepStatus(value: string): value is StepStatus {
  return STEP_STATUSES.includes(value as StepStatus);
}

function isTaskEventType(value: string): value is TaskEventType {
  return TASK_EVENT_TYPES.includes(value as TaskEventType);
}

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toOptionalIsoString(value: string | Date | null): string | undefined {
  return value === null ? undefined : toIsoString(value);
}

function toMetadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toStepError(row: StepRow): StepError | undefined {
  if (!row.error_code || !row.error_message) {
    return undefined;
  }

  return {
    code: row.error_code,
    message: row.error_message,
    ...(row.error_details !== null ? { details: row.error_details } : {}),
  };
}

export function mapTaskRow(row: TaskRow, steps: AgentStep[] = []): AgentTask {
  if (!isTaskStatus(row.status)) {
    throw new Error(`Unknown task status from database: ${row.status}`);
  }

  return {
    taskId: row.task_id,
    taskType: row.task_type,
    status: row.status,
    steps,
    metadata: toMetadataRecord(row.metadata),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

export function mapStepRow(row: StepRow): AgentStep {
  if (!isStepStatus(row.status)) {
    throw new Error(`Unknown step status from database: ${row.status}`);
  }

  return {
    stepId: row.step_id,
    stepName: row.step_name,
    status: row.status,
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    ...(row.input !== null ? { input: row.input } : {}),
    ...(row.output !== null ? { output: row.output } : {}),
    ...(toStepError(row) ? { error: toStepError(row) } : {}),
    ...(toOptionalIsoString(row.started_at) ? { startedAt: toOptionalIsoString(row.started_at) } : {}),
    ...(toOptionalIsoString(row.completed_at) ? { completedAt: toOptionalIsoString(row.completed_at) } : {}),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

export function mapEventRow(row: EventRow): TaskEvent {
  if (!isTaskEventType(row.event_type)) {
    throw new Error(`Unknown task event type from database: ${row.event_type}`);
  }

  return {
    eventId: row.event_id,
    taskId: row.task_id,
    ...(row.step_id ? { stepId: row.step_id } : {}),
    eventType: row.event_type,
    ...(row.payload !== null ? { payload: row.payload } : {}),
    createdAt: toIsoString(row.created_at),
  };
}
