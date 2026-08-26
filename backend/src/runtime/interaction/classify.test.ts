import { describe, expect, it, vi } from "vitest";

import {
  classifyInteractionInput,
  confirmTentativeClassification,
  createPendingClassificationConfirmation,
  resolveClassificationDisposition,
  resolveTentativeClassificationTimeout,
  type SemanticInputClassifier,
} from "./classify.js";
import type { InteractionPolicy } from "./policy.js";

const encoder = new TextEncoder();
const policy: InteractionPolicy = {
  strategy: "supersede",
  clarificationReplyMode: "resume_same_task",
  cancellationMode: "compensate_if_needed",
  allowIntentRevision: true,
};

function createClassifier(
  classification: "intent_revision" | "new_independent_task"
): SemanticInputClassifier {
  return {
    version: "semantic-classifier-v1",
    suggest: vi.fn(async () => ({
      classification,
      reasonCode: "SEMANTIC_RELATIONSHIP_SUGGESTED",
    })),
  };
}

describe("classifyInteractionInput", () => {
  it("classifies an explicit structured cancellation signal deterministically", async () => {
    const result = await classifyInteractionInput({
      payload: encoder.encode("內容不參與取消判定"),
      cancelSignal: { requested: true, source: "business_cancel" },
      classifier: createClassifier("new_independent_task"),
    });

    expect(result).toMatchObject({
      status: "final",
      classification: "cancel_request",
      confidence: "deterministic",
      reasonCode: "EXPLICIT_CANCEL_SIGNAL",
    });
  });

  it("classifies duplicate input only when key and payload bytes both match", async () => {
    const originalPayload = encoder.encode("same bytes");
    const duplicate = await classifyInteractionInput({
      payload: originalPayload,
      idempotencyKey: "idem-1",
      priorInput: {
        idempotencyKey: "idem-1",
        payload: originalPayload,
      },
      classifier: createClassifier("intent_revision"),
    });

    expect(duplicate).toMatchObject({
      status: "final",
      classification: "duplicate_input",
      confidence: "deterministic",
      reasonCode: "IDEMPOTENCY_KEY_AND_PAYLOAD_MATCH",
    });

    const classifier = createClassifier("intent_revision");
    const changedPayload = await classifyInteractionInput({
      payload: encoder.encode("different bytes"),
      idempotencyKey: "idem-1",
      priorInput: {
        idempotencyKey: "idem-1",
        payload: originalPayload,
      },
      classifier,
    });

    expect(changedPayload).toMatchObject({
      status: "awaiting_confirmation",
      classification: "intent_revision",
      confidence: "tentative",
    });
    expect(classifier.suggest).toHaveBeenCalledOnce();
  });

  it("correlates a clarification reply to the waiting task deterministically", async () => {
    const result = await classifyInteractionInput({
      payload: encoder.encode("structured reply payload"),
      waitingTask: {
        taskId: "task-waiting",
        runId: "run-waiting",
        confirmationType: "clarification",
      },
      replyToTaskId: "task-waiting",
      classifier: createClassifier("new_independent_task"),
    });

    expect(result).toMatchObject({
      status: "final",
      classification: "clarification_answer",
      confidence: "deterministic",
      reasonCode: "WAITING_TASK_REPLY_CORRELATED",
    });
  });

  it.each(["intent_revision", "new_independent_task"] as const)(
    "keeps semantic classifier suggestion %s tentative and auditable",
    async (classification) => {
      const rawInput = "private user input that must not be persisted";
      const result = await classifyInteractionInput({
        payload: encoder.encode(rawInput),
        classifier: createClassifier(classification),
      });

      expect(result).toMatchObject({
        status: "awaiting_confirmation",
        classification,
        confidence: "tentative",
        reasonCode: "SEMANTIC_RELATIONSHIP_SUGGESTED",
        classifierVersion: "semantic-classifier-v1",
      });
      expect(JSON.stringify(result)).not.toContain(rawInput);
      expect(result.inputDigest).toMatch(/^[a-f0-9]{64}$/);
    }
  );
});

describe("classification confirmation and disposition", () => {
  it("waits for human confirmation before any irreversible disposition", async () => {
    const tentative = await classifyInteractionInput({
      payload: encoder.encode("revise this"),
      classifier: createClassifier("intent_revision"),
    });
    expect(tentative.status).toBe("awaiting_confirmation");

    const pending = createPendingClassificationConfirmation({
      taskId: "task-1",
      priorTaskId: "task-1",
      priorRunId: "run-1",
      generation: 3,
      tentative,
      requestedAt: "2026-08-20T00:00:00.000Z",
      timeoutMs: 60_000,
    });

    expect(pending).toMatchObject({
      taskStatus: "waiting_confirmation",
      confirmationType: "input_classification",
      generation: 3,
      expiresAt: "2026-08-20T00:01:00.000Z",
      audit: { decision: "pending_confirmation" },
    });
    expect(
      resolveClassificationDisposition({
        classification: tentative,
        policy,
        hasWaitingHitl: false,
      })
    ).toEqual({ action: "await_confirmation", isIrreversible: false });

    const confirmed = confirmTentativeClassification(pending, {
      classification: "intent_revision",
      confirmedBy: "reviewer-1",
      confirmedAt: "2026-08-20T00:00:30.000Z",
    });
    expect(confirmed).toMatchObject({
      status: "final",
      classification: "intent_revision",
      confidence: "tentative",
      confirmation: {
        confirmedBy: "reviewer-1",
        confirmedAt: "2026-08-20T00:00:30.000Z",
      },
      audit: {
        decision: "classification_confirmed",
        confirmedBy: "reviewer-1",
        confirmedClassification: "intent_revision",
        confirmedAt: "2026-08-20T00:00:30.000Z",
      },
    });
    expect(
      resolveClassificationDisposition({
        classification: confirmed,
        policy,
        hasWaitingHitl: false,
      })
    ).toEqual({ action: "apply_policy", strategy: "supersede", isIrreversible: true });
  });

  it("routes clarification according to resume_same_task or new_task mode", async () => {
    const clarification = await classifyInteractionInput({
      payload: encoder.encode("answer"),
      waitingTask: {
        taskId: "task-1",
        runId: "run-1",
        confirmationType: "clarification",
      },
      replyToTaskId: "task-1",
      classifier: createClassifier("new_independent_task"),
    });

    expect(
      resolveClassificationDisposition({
        classification: clarification,
        policy,
        hasWaitingHitl: true,
      })
    ).toEqual({ action: "resume_same_task", taskId: "task-1", isIrreversible: false });
    expect(
      resolveClassificationDisposition({
        classification: clarification,
        policy: { ...policy, clarificationReplyMode: "new_task" },
        hasWaitingHitl: true,
      })
    ).toEqual({ action: "create_new_task", isIrreversible: false });
  });

  it("gives HITL priority except for an explicit cancellation", async () => {
    const revision = confirmTentativeClassification(
      createPendingClassificationConfirmation({
        taskId: "task-1",
        priorTaskId: "task-1",
        priorRunId: "run-1",
        generation: 1,
        tentative: await classifyInteractionInput({
          payload: encoder.encode("revision"),
          classifier: createClassifier("intent_revision"),
        }),
        requestedAt: "2026-08-20T00:00:00.000Z",
        timeoutMs: 60_000,
      }),
      {
        classification: "intent_revision",
        confirmedBy: "reviewer-1",
        confirmedAt: "2026-08-20T00:00:10.000Z",
      }
    );
    const cancellation = await classifyInteractionInput({
      payload: encoder.encode("ignored"),
      cancelSignal: { requested: true, source: "business_cancel" },
      classifier: createClassifier("new_independent_task"),
    });

    expect(
      resolveClassificationDisposition({
        classification: revision,
        policy,
        hasWaitingHitl: true,
      })
    ).toEqual({ action: "resolve_hitl_first", isIrreversible: false });
    expect(
      resolveClassificationDisposition({
        classification: cancellation,
        policy,
        hasWaitingHitl: true,
      })
    ).toEqual({ action: "cancel_waiting_task", isIrreversible: true });
  });

  it.each([
    ["reject", "rejected"],
    ["new_independent_task", "classified"],
  ] as const)("applies %s timeout fallback without the tentative action", async (fallback, type) => {
    const tentative = await classifyInteractionInput({
      payload: encoder.encode("tentative"),
      classifier: createClassifier("intent_revision"),
    });
    const pending = createPendingClassificationConfirmation({
      taskId: "task-1",
      priorTaskId: "task-1",
      priorRunId: "run-1",
      generation: 1,
      tentative,
      requestedAt: "2026-08-20T00:00:00.000Z",
      timeoutMs: 1_000,
    });

    const resolved = resolveTentativeClassificationTimeout({
      pending,
      fallback,
      resolvedAt: "2026-08-20T00:00:02.000Z",
    });

    expect(resolved).toMatchObject({
      type,
      isIrreversible: false,
      audit: { decision: "timeout_fallback", fallback },
    });
    expect(JSON.stringify(resolved)).not.toContain("intent_revision");
  });
});
