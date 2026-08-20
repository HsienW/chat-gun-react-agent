import { createHash, randomUUID } from "node:crypto";

import type { AuditLogger } from "../../platform/observability.js";
import type { SpanManager } from "../../platform/tracing/span-manager.js";
import { redact } from "../audit/redaction.js";
import type { EventRepository } from "../persistence/event-repository.js";
import type { TaskEvent, TaskEventType } from "../types.js";
import type { CancellationPhase } from "./cancel-decision.js";
import type { InputClassification } from "./classify.js";

export const INTERACTION_TASK_EVENT_TYPES = [
  "queued",
  "cancelling",
  "cancelled",
  "superseded",
  "rollback_requested",
  "cancelled_after_commit",
  "manual_intervention_required",
  "input_classification_tentative",
  "clarification_requested",
  "clarification_resumed",
] as const satisfies readonly TaskEventType[];

export type InteractionTaskEventType =
  (typeof INTERACTION_TASK_EVENT_TYPES)[number];

export interface InteractionInputReference {
  digest: string;
  byteLength: number;
  classification?: InputClassification;
}

export interface InteractionEventPayload {
  schemaVersion: "1.0";
  threadId: string;
  priorTaskId: string;
  priorRunId: string;
  replacementTaskId: string | null;
  replacementRunId: string | null;
  generation: number;
  input: InteractionInputReference;
  sideEffectState: CancellationPhase;
  compensationResult: string | null;
  reconciliationResult: string | null;
}

export type InteractionTaskEvent = TaskEvent & {
  eventType: InteractionTaskEventType;
  payload: InteractionEventPayload;
};

export interface InteractionEventFactoryDependencies {
  createEventId: () => string;
  now: () => Date;
}

const DEFAULT_FACTORY_DEPENDENCIES: InteractionEventFactoryDependencies = {
  createEventId: randomUUID,
  now: () => new Date(),
};

function requireOpaqueId(value: string, field: string): void {
  if (value.trim() === "" || value.length > 256) {
    throw new Error(`Invalid interaction ${field}`);
  }
}

function requireGeneration(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("Invalid interaction generation");
  }
}

function isStableMachineIdentifier(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
}

export function createInteractionInputReference(
  payload: Uint8Array,
  classification?: InputClassification
): InteractionInputReference {
  return {
    digest: createHash("sha256").update(payload).digest("hex"),
    byteLength: payload.byteLength,
    ...(classification ? { classification } : {}),
  };
}

export function createInteractionTaskEvent(
  input: Omit<InteractionEventPayload, "schemaVersion"> & {
    eventType: InteractionTaskEventType;
  },
  dependencies: InteractionEventFactoryDependencies = DEFAULT_FACTORY_DEPENDENCIES
): InteractionTaskEvent {
  requireOpaqueId(input.threadId, "threadId");
  requireOpaqueId(input.priorTaskId, "priorTaskId");
  requireOpaqueId(input.priorRunId, "priorRunId");
  if (input.replacementTaskId) {
    requireOpaqueId(input.replacementTaskId, "replacementTaskId");
  }
  if (input.replacementRunId) {
    requireOpaqueId(input.replacementRunId, "replacementRunId");
  }
  requireGeneration(input.generation);
  if (!/^[a-f0-9]{64}$/.test(input.input.digest)) {
    throw new Error("Invalid interaction input digest");
  }

  return {
    eventId: dependencies.createEventId(),
    taskId: input.priorTaskId,
    eventType: input.eventType,
    payload: {
      schemaVersion: "1.0",
      threadId: input.threadId,
      priorTaskId: input.priorTaskId,
      priorRunId: input.priorRunId,
      replacementTaskId: input.replacementTaskId,
      replacementRunId: input.replacementRunId,
      generation: input.generation,
      input: input.input,
      sideEffectState: input.sideEffectState,
      compensationResult: input.compensationResult,
      reconciliationResult: input.reconciliationResult,
    },
    createdAt: dependencies.now().toISOString(),
  };
}

export function createTentativeClassificationTaskEvents(
  input: {
    threadId: string;
    priorTaskId: string;
    priorRunId: string;
    generation: number;
    input: InteractionInputReference;
    classificationReasonCode: string;
    classifierVersion: string;
  },
  dependencies: InteractionEventFactoryDependencies = DEFAULT_FACTORY_DEPENDENCIES
): readonly [TaskEvent, TaskEvent] {
  if (!isStableMachineIdentifier(input.classificationReasonCode)) {
    throw new Error("Invalid classification reason code");
  }
  if (!isStableMachineIdentifier(input.classifierVersion)) {
    throw new Error("Invalid classifier version");
  }

  const basePayload = {
    schemaVersion: "1.0" as const,
    threadId: input.threadId,
    priorTaskId: input.priorTaskId,
    priorRunId: input.priorRunId,
    replacementTaskId: null,
    replacementRunId: null,
    generation: input.generation,
    input: input.input,
    sideEffectState: "read_only" as const,
    compensationResult: null,
    reconciliationResult: null,
  };
  const createdAt = dependencies.now().toISOString();

  return [
    {
      eventId: dependencies.createEventId(),
      taskId: input.priorTaskId,
      eventType: "input_classification_tentative",
      payload: {
        ...basePayload,
        classificationReasonCode: input.classificationReasonCode,
        classifierVersion: input.classifierVersion,
      },
      createdAt,
    },
    {
      eventId: dependencies.createEventId(),
      taskId: input.priorTaskId,
      eventType: "waiting_confirmation",
      payload: {
        ...basePayload,
        confirmationType: "input_classification",
      },
      createdAt,
    },
  ];
}

function asInteractionEventPayload(
  payload: unknown
): InteractionEventPayload | undefined {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  const candidate = payload as Partial<InteractionEventPayload>;
  return candidate.schemaVersion === "1.0" &&
    typeof candidate.threadId === "string" &&
    typeof candidate.priorTaskId === "string" &&
    typeof candidate.priorRunId === "string" &&
    typeof candidate.generation === "number"
    ? (candidate as InteractionEventPayload)
    : undefined;
}

export class InteractionEventRecorder {
  constructor(
    private readonly eventRepository: EventRepository,
    private readonly auditLogger: AuditLogger,
    private readonly spanManager: SpanManager
  ) {}

  async record(event: InteractionTaskEvent): Promise<void> {
    const payload = asInteractionEventPayload(event.payload);
    if (!payload) throw new Error("Invalid interaction event payload");

    await this.eventRepository.append(event);
    const reasonCode = `INTERACTION_${event.eventType.toUpperCase()}`;
    const auditPayload = redact({
      threadId: payload.threadId,
      taskId: payload.priorTaskId,
      runId: payload.priorRunId,
      replacementTaskId: payload.replacementTaskId,
      replacementRunId: payload.replacementRunId,
      generation: payload.generation,
      eventType: event.eventType,
      reasonCode,
      sideEffectState: payload.sideEffectState,
      inputDigest: payload.input.digest,
      inputByteLength: payload.input.byteLength,
    });
    if (auditPayload === null || typeof auditPayload !== "object") {
      throw new Error("Invalid redacted interaction audit payload");
    }
    await this.auditLogger.record(
      `interaction.${event.eventType}`,
      auditPayload as Record<string, unknown>
    );

    const span = this.spanManager.getActiveSpan();
    if (span) {
      this.spanManager.setAttributes(span, {
        "interaction.event_type": event.eventType,
        "interaction.thread_id": payload.threadId,
        "interaction.task_id": payload.priorTaskId,
        "interaction.run_id": payload.priorRunId,
        "interaction.generation": payload.generation,
        "interaction.side_effect_state": payload.sideEffectState,
        ...(payload.replacementRunId
          ? { "interaction.replacement_run_id": payload.replacementRunId }
          : {}),
      });
    }
  }
}
