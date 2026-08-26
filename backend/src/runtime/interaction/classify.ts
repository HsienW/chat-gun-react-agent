import { createHash, randomUUID } from "node:crypto";

import type { InteractionPolicy } from "./policy.js";

export const INPUT_CLASSIFICATIONS = [
  "clarification_answer",
  "intent_revision",
  "cancel_request",
  "new_independent_task",
  "duplicate_input",
] as const;

export type InputClassification = (typeof INPUT_CLASSIFICATIONS)[number];
export type SemanticInputClassification = Extract<
  InputClassification,
  "intent_revision" | "new_independent_task"
>;

export interface SemanticInputClassifier {
  version: string;
  suggest(input: {
    payload: Uint8Array;
    inputDigest: string;
    inputByteLength: number;
    waitingTask?: WaitingTaskReference;
  }): Promise<{
    classification: SemanticInputClassification;
    reasonCode: string;
  }>;
}

export interface WaitingTaskReference {
  taskId: string;
  runId: string;
  confirmationType: "clarification" | "input_classification" | string;
}

interface ClassificationBase {
  classification: InputClassification;
  confidence: "deterministic" | "tentative";
  reasonCode: string;
  inputDigest: string;
  inputByteLength: number;
  correlatedTaskId?: string;
}

export interface DeterministicClassification extends ClassificationBase {
  status: "final";
  confidence: "deterministic";
}

export interface TentativeClassification extends ClassificationBase {
  status: "awaiting_confirmation";
  classification: SemanticInputClassification;
  confidence: "tentative";
  classifierVersion: string;
}

export interface ConfirmedTentativeClassification extends ClassificationBase {
  status: "final";
  classification: SemanticInputClassification;
  confidence: "tentative";
  classifierVersion: string;
  confirmation: {
    confirmedBy: string;
    confirmedAt: string;
  };
  audit: {
    decision: "classification_confirmed";
    confirmedBy: string;
    confirmedClassification: SemanticInputClassification;
    confirmedAt: string;
  };
}

export type InputClassificationResult =
  | DeterministicClassification
  | TentativeClassification
  | ConfirmedTentativeClassification;

export interface PendingClassificationConfirmation {
  confirmationId: string;
  confirmationType: "input_classification";
  taskStatus: "waiting_confirmation";
  taskId: string;
  priorTaskId: string;
  priorRunId: string;
  generation: number;
  tentative: TentativeClassification;
  requestedAt: string;
  expiresAt: string;
  audit: {
    decision: "pending_confirmation";
    reasonCode: string;
    classifierVersion: string;
  };
}

export class InputClassificationContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputClassificationContractError";
  }
}

function digestPayload(payload: Uint8Array): string {
  return createHash("sha256").update(payload).digest("hex");
}

function areBytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  return left.every((byte, index) => byte === right[index]);
}

function isStableReasonCode(value: string): boolean {
  return /^[A-Z][A-Z0-9_]{0,63}$/.test(value);
}

function createDeterministicClassification(input: {
  classification: DeterministicClassification["classification"];
  reasonCode: string;
  inputDigest: string;
  inputByteLength: number;
  correlatedTaskId?: string;
}): DeterministicClassification {
  return {
    status: "final",
    classification: input.classification,
    confidence: "deterministic",
    reasonCode: input.reasonCode,
    inputDigest: input.inputDigest,
    inputByteLength: input.inputByteLength,
    ...(input.correlatedTaskId
      ? { correlatedTaskId: input.correlatedTaskId }
      : {}),
  };
}

function createTentativeClassification(input: {
  classification: SemanticInputClassification;
  reasonCode: string;
  classifierVersion: string;
  inputDigest: string;
  inputByteLength: number;
}): TentativeClassification {
  return {
    status: "awaiting_confirmation",
    classification: input.classification,
    confidence: "tentative",
    reasonCode: input.reasonCode,
    classifierVersion: input.classifierVersion,
    inputDigest: input.inputDigest,
    inputByteLength: input.inputByteLength,
  };
}

export async function classifyInteractionInput(input: {
  payload: Uint8Array;
  idempotencyKey?: string;
  priorInput?: { idempotencyKey: string; payload: Uint8Array };
  cancelSignal?: { requested: boolean; source: "business_cancel" };
  waitingTask?: WaitingTaskReference;
  replyToTaskId?: string;
  classifier: SemanticInputClassifier;
}): Promise<InputClassificationResult> {
  const inputDigest = digestPayload(input.payload);
  const inputByteLength = input.payload.byteLength;

  if (input.cancelSignal?.requested === true) {
    return createDeterministicClassification({
      classification: "cancel_request",
      reasonCode: "EXPLICIT_CANCEL_SIGNAL",
      inputDigest,
      inputByteLength,
    });
  }

  if (
    input.idempotencyKey !== undefined &&
    input.priorInput?.idempotencyKey === input.idempotencyKey &&
    areBytesEqual(input.payload, input.priorInput.payload)
  ) {
    return createDeterministicClassification({
      classification: "duplicate_input",
      reasonCode: "IDEMPOTENCY_KEY_AND_PAYLOAD_MATCH",
      inputDigest,
      inputByteLength,
    });
  }

  if (
    input.waitingTask?.confirmationType === "clarification" &&
    input.replyToTaskId === input.waitingTask.taskId
  ) {
    return createDeterministicClassification({
      classification: "clarification_answer",
      reasonCode: "WAITING_TASK_REPLY_CORRELATED",
      inputDigest,
      inputByteLength,
      correlatedTaskId: input.waitingTask.taskId,
    });
  }

  try {
    const suggestion = await input.classifier.suggest({
      payload: input.payload,
      inputDigest,
      inputByteLength,
      ...(input.waitingTask ? { waitingTask: input.waitingTask } : {}),
    });
    if (!isStableReasonCode(suggestion.reasonCode)) {
      throw new InputClassificationContractError(
        "Classifier reasonCode must be a stable machine identifier"
      );
    }
    return createTentativeClassification({
      classification: suggestion.classification,
      reasonCode: suggestion.reasonCode,
      classifierVersion: input.classifier.version,
      inputDigest,
      inputByteLength,
    });
  } catch {
    return createTentativeClassification({
      classification: "new_independent_task",
      reasonCode: "CLASSIFIER_UNAVAILABLE",
      classifierVersion: input.classifier.version,
      inputDigest,
      inputByteLength,
    });
  }
}

function requireIsoTimestamp(value: string, field: string): number {
  const epochMs = Date.parse(value);
  if (!Number.isFinite(epochMs)) {
    throw new InputClassificationContractError(`Invalid ${field}`);
  }
  return epochMs;
}

function requireTentative(
  value: InputClassificationResult
): TentativeClassification {
  if (value.status !== "awaiting_confirmation") {
    throw new InputClassificationContractError(
      "Only tentative classifications can await confirmation"
    );
  }
  return value;
}

export function createPendingClassificationConfirmation(input: {
  taskId: string;
  priorTaskId: string;
  priorRunId: string;
  generation: number;
  tentative: InputClassificationResult;
  requestedAt: string;
  timeoutMs: number;
}): PendingClassificationConfirmation {
  const requestedAtEpochMs = requireIsoTimestamp(input.requestedAt, "requestedAt");
  if (!Number.isSafeInteger(input.generation) || input.generation < 1) {
    throw new InputClassificationContractError("Invalid generation");
  }
  if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1) {
    throw new InputClassificationContractError("Invalid confirmation timeout");
  }

  const tentative = requireTentative(input.tentative);
  return {
    confirmationId: randomUUID(),
    confirmationType: "input_classification",
    taskStatus: "waiting_confirmation",
    taskId: input.taskId,
    priorTaskId: input.priorTaskId,
    priorRunId: input.priorRunId,
    generation: input.generation,
    tentative,
    requestedAt: new Date(requestedAtEpochMs).toISOString(),
    expiresAt: new Date(requestedAtEpochMs + input.timeoutMs).toISOString(),
    audit: {
      decision: "pending_confirmation",
      reasonCode: tentative.reasonCode,
      classifierVersion: tentative.classifierVersion,
    },
  };
}

export function confirmTentativeClassification(
  pending: PendingClassificationConfirmation,
  confirmation: {
    classification: SemanticInputClassification;
    confirmedBy: string;
    confirmedAt: string;
  }
): ConfirmedTentativeClassification {
  const confirmedAtEpochMs = requireIsoTimestamp(
    confirmation.confirmedAt,
    "confirmedAt"
  );
  if (confirmedAtEpochMs > Date.parse(pending.expiresAt)) {
    throw new InputClassificationContractError(
      "Classification confirmation has expired"
    );
  }
  if (confirmation.confirmedBy.trim() === "") {
    throw new InputClassificationContractError("confirmedBy is required");
  }

  const confirmedAt = new Date(confirmedAtEpochMs).toISOString();
  return {
    status: "final",
    classification: confirmation.classification,
    confidence: "tentative",
    reasonCode: pending.tentative.reasonCode,
    classifierVersion: pending.tentative.classifierVersion,
    inputDigest: pending.tentative.inputDigest,
    inputByteLength: pending.tentative.inputByteLength,
    confirmation: {
      confirmedBy: confirmation.confirmedBy,
      confirmedAt,
    },
    audit: {
      decision: "classification_confirmed",
      confirmedBy: confirmation.confirmedBy,
      confirmedClassification: confirmation.classification,
      confirmedAt,
    },
  };
}

export type ClassificationDisposition =
  | { action: "await_confirmation"; isIrreversible: false }
  | { action: "reuse_existing"; isIrreversible: false }
  | { action: "resume_same_task"; taskId: string; isIrreversible: false }
  | { action: "create_new_task"; isIrreversible: false }
  | { action: "resolve_hitl_first"; isIrreversible: false }
  | { action: "reject"; isIrreversible: false }
  | { action: "cancel_waiting_task"; isIrreversible: true }
  | { action: "cancel_active_task"; isIrreversible: true }
  | {
      action: "apply_policy";
      strategy: InteractionPolicy["strategy"];
      isIrreversible: boolean;
    };

export function resolveClassificationDisposition(input: {
  classification: InputClassificationResult;
  policy: InteractionPolicy;
  hasWaitingHitl: boolean;
}): ClassificationDisposition {
  const classification = input.classification;
  if (classification.status === "awaiting_confirmation") {
    return { action: "await_confirmation", isIrreversible: false };
  }

  if (classification.classification === "duplicate_input") {
    return { action: "reuse_existing", isIrreversible: false };
  }

  if (classification.classification === "clarification_answer") {
    if (
      input.policy.clarificationReplyMode === "resume_same_task" &&
      classification.correlatedTaskId
    ) {
      return {
        action: "resume_same_task",
        taskId: classification.correlatedTaskId,
        isIrreversible: false,
      };
    }
    return { action: "create_new_task", isIrreversible: false };
  }

  if (classification.classification === "cancel_request") {
    return input.hasWaitingHitl
      ? { action: "cancel_waiting_task", isIrreversible: true }
      : { action: "cancel_active_task", isIrreversible: true };
  }

  if (
    classification.classification === "intent_revision" &&
    input.hasWaitingHitl
  ) {
    return { action: "resolve_hitl_first", isIrreversible: false };
  }

  if (
    classification.classification === "intent_revision" &&
    !input.policy.allowIntentRevision
  ) {
    return { action: "reject", isIrreversible: false };
  }

  if (classification.classification === "new_independent_task") {
    return { action: "create_new_task", isIrreversible: false };
  }

  return {
    action: "apply_policy",
    strategy: input.policy.strategy,
    isIrreversible:
      input.policy.strategy === "interrupt" ||
      input.policy.strategy === "supersede" ||
      input.policy.strategy === "rollback",
  };
}

export type ClassificationTimeoutFallback = "reject" | "new_independent_task";

export function resolveTentativeClassificationTimeout(input: {
  pending: PendingClassificationConfirmation;
  fallback: ClassificationTimeoutFallback;
  resolvedAt: string;
}):
  | {
      type: "rejected";
      isIrreversible: false;
      audit: {
        decision: "timeout_fallback";
        fallback: "reject";
        resolvedAt: string;
      };
    }
  | {
      type: "classified";
      classification: "new_independent_task";
      isIrreversible: false;
      audit: {
        decision: "timeout_fallback";
        fallback: "new_independent_task";
        resolvedAt: string;
      };
    } {
  const resolvedAtEpochMs = requireIsoTimestamp(input.resolvedAt, "resolvedAt");
  if (resolvedAtEpochMs < Date.parse(input.pending.expiresAt)) {
    throw new InputClassificationContractError(
      "Classification confirmation has not expired"
    );
  }
  const resolvedAt = new Date(resolvedAtEpochMs).toISOString();

  return input.fallback === "reject"
    ? {
        type: "rejected",
        isIrreversible: false,
        audit: {
          decision: "timeout_fallback",
          fallback: "reject",
          resolvedAt,
        },
      }
    : {
        type: "classified",
        classification: "new_independent_task",
        isIrreversible: false,
        audit: {
          decision: "timeout_fallback",
          fallback: "new_independent_task",
          resolvedAt,
        },
      };
}
