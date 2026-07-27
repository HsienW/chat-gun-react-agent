import type { AgentStep, AgentTask, StepError, TaskEvent, TaskEventType } from "./types.js";

function createEvent(
  eventType: TaskEventType,
  taskId: string,
  options: { stepId?: string; payload?: unknown } = {}
): TaskEvent {
  return {
    eventId: globalThis.crypto.randomUUID(),
    taskId,
    ...(options.stepId ? { stepId: options.stepId } : {}),
    eventType,
    ...(options.payload !== undefined ? { payload: options.payload } : {}),
    createdAt: new Date().toISOString(),
  };
}

export function createTaskCreatedEvent(task: AgentTask): TaskEvent {
  return createEvent("task_created", task.taskId, { payload: { task } });
}

export function createStepStartedEvent(taskId: string, step: AgentStep): TaskEvent {
  return createEvent("step_started", taskId, {
    stepId: step.stepId,
    payload: { step },
  });
}

export function createStepCompletedEvent(taskId: string, step: AgentStep): TaskEvent {
  return createEvent("step_completed", taskId, {
    stepId: step.stepId,
    payload: { step },
  });
}

export function createStepFailedEvent(
  taskId: string,
  step: AgentStep,
  error: StepError
): TaskEvent {
  return createEvent("step_failed", taskId, {
    stepId: step.stepId,
    payload: { step, error },
  });
}

export function createStepRetryingEvent(taskId: string, step: AgentStep): TaskEvent {
  return createEvent("step_retrying", taskId, {
    stepId: step.stepId,
    payload: { step },
  });
}

export function createTaskCompletedEvent(task: AgentTask): TaskEvent {
  return createEvent("task_completed", task.taskId, { payload: { task } });
}

export function createTaskFailedEvent(task: AgentTask, error: StepError): TaskEvent {
  return createEvent("task_failed", task.taskId, { payload: { task, error } });
}

export function createTaskCancelledEvent(task: AgentTask): TaskEvent {
  return createEvent("task_cancelled", task.taskId, { payload: { task } });
}

export function createCompensationTriggeredEvent(task: AgentTask): TaskEvent {
  return createEvent("compensation_triggered", task.taskId, { payload: { task } });
}

export function createCompensationCompletedEvent(task: AgentTask): TaskEvent {
  return createEvent("compensation_completed", task.taskId, { payload: { task } });
}

export function createWaitingConfirmationEvent(
  task: AgentTask,
  step?: AgentStep
): TaskEvent {
  return createEvent("waiting_confirmation", task.taskId, {
    ...(step ? { stepId: step.stepId } : {}),
    payload: step ? { task, step } : { task },
  });
}

export function createResumedEvent(task: AgentTask): TaskEvent {
  return createEvent("resumed", task.taskId, { payload: { task } });
}
