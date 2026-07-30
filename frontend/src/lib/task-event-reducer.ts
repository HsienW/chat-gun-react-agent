import {
  TASK_EVENT_TYPES,
  type AgentStep,
  type AgentTask,
  type StepError,
  type StepStatus,
  type TaskEvent,
  type TaskEventType,
  type TaskStatus,
} from './task-types';

export type IncomingTaskEvent = TaskEvent | {
  eventId: string;
  taskId: string;
  stepId?: string;
  eventType: string;
  payload?: unknown;
  createdAt: string;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;
}

function isTaskEventType(value: string): value is TaskEventType {
  return TASK_EVENT_TYPES.includes(value as TaskEventType);
}

function getPayloadTask(value: unknown): AgentTask | undefined {
  return asRecord(asRecord(value)?.task) as AgentTask | undefined;
}

function getPayloadStep(value: unknown): AgentStep | undefined {
  return asRecord(asRecord(value)?.step) as AgentStep | undefined;
}

function getPayloadError(value: unknown): StepError | undefined {
  return asRecord(asRecord(value)?.error) as StepError | undefined;
}

function updateTaskStatus<TStep extends string>(
  state: AgentTask<TStep>,
  status: TaskStatus,
  updatedAt: string
): AgentTask<TStep> {
  return {
    ...state,
    status,
    updatedAt,
  };
}

function updateStep<TStep extends string>(
  state: AgentTask<TStep>,
  stepId: string | undefined,
  updater: (step: AgentStep<TStep>) => AgentStep<TStep>
): AgentTask<TStep> {
  if (!stepId) {
    return state;
  }

  return {
    ...state,
    steps: state.steps.map((step) =>
      step.stepId === stepId ? updater(step) : step
    ),
  };
}

function upsertStep<TStep extends string>(
  state: AgentTask<TStep>,
  incomingStep: AgentStep<TStep>
): AgentTask<TStep> {
  const hasStep = state.steps.some((step) => step.stepId === incomingStep.stepId);

  return {
    ...state,
    steps: hasStep
      ? state.steps.map((step) =>
          step.stepId === incomingStep.stepId ? incomingStep : step
        )
      : [...state.steps, incomingStep],
  };
}

function statusFromFailedStep(step: AgentStep | undefined): StepStatus {
  return step?.status === 'retryable_failed' ? 'retryable_failed' : 'terminal_failed';
}

function applyStepStatus<TStep extends string>(
  state: AgentTask<TStep>,
  event: IncomingTaskEvent,
  status: StepStatus
): AgentTask<TStep> {
  const incomingStep = getPayloadStep(event.payload) as AgentStep<TStep> | undefined;
  const error = getPayloadError(event.payload);

  if (incomingStep) {
    return upsertStep(state, {
      ...incomingStep,
      status,
      ...(error ? { error } : {}),
      updatedAt: event.createdAt,
    });
  }

  return updateStep(state, event.stepId, (step) => ({
    ...step,
    status,
    ...(error ? { error } : {}),
    updatedAt: event.createdAt,
  }));
}

export function taskEventReducer<TStep extends string>(
  state: AgentTask<TStep> | null,
  event: IncomingTaskEvent
): AgentTask<TStep> | null {
  if (!isTaskEventType(event.eventType)) {
    return state;
  }

  if (event.eventType === 'task_created') {
    return getPayloadTask(event.payload) as AgentTask<TStep> | undefined ?? null;
  }

  if (!state) {
    return null;
  }

  switch (event.eventType) {
    case 'step_started':
      return applyStepStatus(state, event, 'running');
    case 'step_completed':
      return applyStepStatus(state, event, 'succeeded');
    case 'step_failed':
      return applyStepStatus(
        state,
        event,
        statusFromFailedStep(getPayloadStep(event.payload))
      );
    case 'step_retrying':
      return updateStep(state, event.stepId, (step) => ({
        ...step,
        status: 'running',
        attempt: getPayloadStep(event.payload)?.attempt ?? step.attempt + 1,
        updatedAt: event.createdAt,
      }));
    case 'task_completed':
      return updateTaskStatus(state, 'completed', event.createdAt);
    case 'task_failed':
      return updateTaskStatus(state, 'failed', event.createdAt);
    case 'task_cancelled':
      return updateTaskStatus(state, 'cancelled', event.createdAt);
    case 'compensation_triggered':
      return updateTaskStatus(state, 'compensating', event.createdAt);
    case 'compensation_completed':
      return updateTaskStatus(
        updateStep(state, event.stepId, (step) => ({
          ...step,
          status: 'compensated',
          updatedAt: event.createdAt,
        })),
        'failed',
        event.createdAt
      );
    case 'waiting_confirmation':
      return updateTaskStatus(
        updateStep(state, event.stepId, (step) => ({
          ...step,
          status: 'waiting_confirmation',
          updatedAt: event.createdAt,
        })),
        'waiting_confirmation',
        event.createdAt
      );
    case 'resumed':
      return updateTaskStatus(state, 'running', event.createdAt);
  }
}
