import type { AuditLogger } from "../../platform/observability.js";
import {
  createCompensationCompletedEvent,
  createCompensationTriggeredEvent,
} from "../events.js";
import type { EventRepository } from "../persistence/event-repository.js";
import type { StepRepository } from "../persistence/step-repository.js";
import type { TaskRepository } from "../persistence/task-repository.js";
import type { AgentStep, AgentTask, TaskEvent } from "../types.js";
import type {
  CompensateOptions,
  CompensationError,
  CompensationFailureEntry,
  CompensationResult,
  SkippedIrreversibleEntry,
} from "./compensation-action.js";
import type { CompensationRegistry } from "./compensation-registry.js";

const IRREVERSIBLE_REASON: SkippedIrreversibleEntry["reason"] =
  "irreversible_requires_manual_intervention";
const ACTION_REPORTED_FAILURE_MESSAGE =
  "Compensation action reported failure";
const UNKNOWN_ACTION_FAILURE_MESSAGE = "Unknown compensation action failure";

export interface SagaOrchestrator {
  compensate(
    taskId: string,
    opts?: CompensateOptions
  ): Promise<CompensationResult>;
}

export class SagaOrchestratorImpl implements SagaOrchestrator {
  constructor(
    private readonly registry: CompensationRegistry,
    private readonly taskRepository: TaskRepository,
    private readonly stepRepository: StepRepository,
    private readonly eventRepository: EventRepository,
    private readonly auditLogger: AuditLogger
  ) {}

  async compensate(
    taskId: string,
    opts: CompensateOptions = {}
  ): Promise<CompensationResult> {
    const task = await this.taskRepository.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (task.status !== "partially_failed" && task.status !== "cancelled") {
      throw new Error(`Task status does not allow compensation: ${task.status}`);
    }

    const steps = await this.stepRepository.findByTaskId(taskId);
    const failureStepIndex = steps.findIndex(
      (step) => step.status === "terminal_failed"
    );
    const failureStep =
      failureStepIndex >= 0 ? steps[failureStepIndex] : undefined;
    const completedSteps = steps.filter(
      (step, index) =>
        step.status === "succeeded" &&
        (failureStepIndex < 0 || index < failureStepIndex)
    );

    if (completedSteps.length === 0) {
      return createEmptyResult(taskId);
    }

    const reasonCode =
      opts.reason ??
      (task.status === "cancelled"
        ? "user_cancelled"
        : failureStep
          ? "terminal_failed"
          : "partially_failed");
    const compensatingTask = await this.taskRepository.updateStatus(
      taskId,
      "compensating"
    );

    await this.auditLogger.record("compensation.triggered", {
      ...createCompensationAuditResource(taskId),
      taskId,
      failureStepId: failureStep?.stepId ?? null,
      completedStepIds: completedSteps.map((step) => step.stepId),
      reasonCode,
    });
    await this.eventRepository.append(
      createTriggeredTaskEvent(compensatingTask, reasonCode)
    );

    const failures: CompensationFailureEntry[] = [];
    const skippedIrreversibleActions: SkippedIrreversibleEntry[] = [];
    let totalActions = 0;
    let succeeded = 0;
    let failed = 0;

    for (const step of [...completedSteps].reverse()) {
      await this.stepRepository.updateStatus(step.stepId, "compensating");
      const actions = this.registry.getActions(step.stepName);

      for (const action of [...actions].reverse()) {
        totalActions += 1;
        if (!action.isReversible) {
          const skippedEntry: SkippedIrreversibleEntry = {
            stepId: step.stepId,
            actionId: action.actionId,
            reason: IRREVERSIBLE_REASON,
          };
          skippedIrreversibleActions.push(skippedEntry);
          await this.auditLogger.record(
            "compensation.action_skipped_irreversible",
            {
              ...createCompensationActionAuditResource(action.actionId),
              taskId,
              ...skippedEntry,
            }
          );
          continue;
        }

        try {
          const actionResult = await action.execute({
            ...opts.context,
            taskId,
            stepId: step.stepId,
          });
          if (actionResult.status === "failed") {
            failed += 1;
            const compensationError =
              actionResult.error ?? {
                message: ACTION_REPORTED_FAILURE_MESSAGE,
              };
            const failureEntry = createFailureEntry(
              step,
              action.actionId,
              compensationError
            );
            failures.push(failureEntry);
            await this.recordActionFailure(taskId, failureEntry);
            continue;
          }

          succeeded += 1;
          await this.auditLogger.record("compensation.action_succeeded", {
            ...createCompensationActionAuditResource(action.actionId),
            taskId,
            stepId: step.stepId,
            actionId: action.actionId,
          });
        } catch (error) {
          failed += 1;
          const failureEntry = createFailureEntry(
            step,
            action.actionId,
            normalizeThrownError(error)
          );
          failures.push(failureEntry);
          await this.recordActionFailure(taskId, failureEntry);
        }
      }

      await this.stepRepository.updateStatus(step.stepId, "compensated");
    }

    const result: CompensationResult = {
      taskId,
      totalActions,
      succeeded,
      failed,
      skippedIrreversible: skippedIrreversibleActions.length,
      overallStatus: resolveOverallStatus(
        totalActions,
        failed,
        skippedIrreversibleActions.length
      ),
      failures,
      skippedIrreversibleActions,
    };

    const failedTask = await this.taskRepository.updateStatus(taskId, "failed");
    await this.auditLogger.record("compensation.completed", {
      ...createCompensationAuditResource(taskId),
      taskId,
      result,
    });
    await this.eventRepository.append(
      createCompensationCompletedEvent(failedTask)
    );

    return result;
  }

  private async recordActionFailure(
    taskId: string,
    failureEntry: CompensationFailureEntry
  ): Promise<void> {
    await this.auditLogger.record("compensation.action_failed", {
      ...createCompensationActionAuditResource(failureEntry.actionId),
      taskId,
      stepId: failureEntry.stepId,
      actionId: failureEntry.actionId,
      error: toAuditError(failureEntry.error),
    });
  }
}

function createCompensationAuditResource(taskId: string): {
  resourceType: "compensation";
  resourceId: string;
} {
  return { resourceType: "compensation", resourceId: taskId };
}

function createCompensationActionAuditResource(actionId: string): {
  resourceType: "compensation_action";
  resourceId: string;
} {
  return { resourceType: "compensation_action", resourceId: actionId };
}

function createEmptyResult(taskId: string): CompensationResult {
  return {
    taskId,
    totalActions: 0,
    succeeded: 0,
    failed: 0,
    skippedIrreversible: 0,
    overallStatus: "no_actions_needed",
    failures: [],
    skippedIrreversibleActions: [],
  };
}

function createTriggeredTaskEvent(
  task: AgentTask,
  reasonCode: NonNullable<CompensateOptions["reason"]>
): TaskEvent {
  const event = createCompensationTriggeredEvent(task);
  return {
    ...event,
    payload: { task, reasonCode },
  };
}

function createFailureEntry(
  step: AgentStep,
  actionId: string,
  error: CompensationError
): CompensationFailureEntry {
  return {
    stepId: step.stepId,
    actionId,
    error,
  };
}

function normalizeThrownError(error: unknown): CompensationError {
  if (error instanceof Error) {
    return { message: error.message };
  }
  if (typeof error === "string") {
    return { message: error };
  }
  return { message: UNKNOWN_ACTION_FAILURE_MESSAGE };
}

function toAuditError(
  error: CompensationError
): Pick<CompensationError, "message" | "code"> {
  return {
    message: error.message,
    ...(error.code ? { code: error.code } : {}),
  };
}

function resolveOverallStatus(
  totalActions: number,
  failed: number,
  skippedIrreversible: number
): CompensationResult["overallStatus"] {
  if (totalActions === 0) {
    return "no_actions_needed";
  }
  if (failed > 0 || skippedIrreversible > 0) {
    return "partial_failure";
  }
  return "all_compensated";
}
