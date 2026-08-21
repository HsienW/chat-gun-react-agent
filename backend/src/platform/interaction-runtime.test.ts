import { describe, expect, it, vi } from "vitest";

import type { ActiveRunOwnership } from "../runtime/interaction/ownership.js";
import type { InputClassificationResult } from "../runtime/interaction/classify.js";
import type { InteractionTaskEvent } from "../runtime/interaction/events.js";
import {
  applyInteractionGovernance,
  createInteractionOrchestrator,
  createProductionInteractionOrchestrator,
  type InteractionOrchestratorConfig,
} from "./interaction-runtime.js";

const configuredPolicy = (strategy: "reject" | "enqueue" | "supersede") =>
  JSON.stringify({
    strategy,
    clarificationReplyMode: "new_task",
    cancellationMode: "cancel_if_read_only",
    allowIntentRevision: true,
  });

const finalRevision: InputClassificationResult = {
  status: "final",
  classification: "intent_revision",
  confidence: "deterministic",
  reasonCode: "CONFIRMED_REVISION",
  inputDigest: "a".repeat(64),
  inputByteLength: 12,
};

function ownership(input: Partial<ActiveRunOwnership> = {}): ActiveRunOwnership {
  return {
    threadId: "thread-1",
    scopeId: "scope-1",
    taskId: "task-1",
    runId: "run-1",
    status: "active",
    generation: 3,
    updatedAt: "2026-08-21T00:00:00.000Z",
    ...input,
  };
}

function runConfig(runId = "run-2") {
  return {
    runId,
    configurable: {
      thread_id: "thread-1",
      scope_id: "scope-1",
      task_id: `task-${runId}`,
      "x-request-id": "request-2",
      "x-idempotency-key": "idempotency-2",
      "x-active-run-id": "client-stale-run",
      "x-active-run-generation": "99",
    },
  };
}

function configuredDependencies(strategy: "reject" | "enqueue" | "supersede") {
  const active = ownership();
  const replacement = ownership({
    taskId: "task-run-2",
    runId: "run-2",
    generation: 4,
  });
  const ownershipRepository = {
    findActive: vi.fn(async () => active),
    claim: vi.fn(async () => replacement),
    supersede: vi.fn(async () => replacement),
    markTerminal: vi.fn(async () => replacement),
  };
  const eventRecorder = {
    record: vi.fn(async (_event: InteractionTaskEvent) => undefined),
  };
  const recordMetric = vi.fn();
  const decideCancellation = vi.fn(async () => ({
    phase: "read_only" as const,
    path: "interrupt_or_supersede" as const,
  }));

  const config: InteractionOrchestratorConfig = {
    rawPolicy: configuredPolicy(strategy),
    ownershipRepository,
    classify: vi.fn(async () => finalRevision),
    decideCancellation,
    eventRecorder,
    ensureTask: vi.fn(async () => undefined),
    recordMetric,
  };

  return {
    config,
    ownershipRepository,
    eventRecorder,
    recordMetric,
    decideCancellation,
  };
}

describe("interaction runtime production wrapper", () => {
  it("is a true no-op when no InteractionPolicy is configured", async () => {
    let markFirstStarted: (() => void) | undefined;
    let releaseFirst: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const graph = {
      invoke: vi.fn(async (input: { request: string }, config?: unknown) => {
        if (input.request === "first") {
          markFirstStarted?.();
          await firstGate;
        }
        return { input, config };
      }),
    };
    const orchestrator = createProductionInteractionOrchestrator({ rawPolicy: " " });
    const governed = applyInteractionGovernance(graph, orchestrator);

    expect(governed).toBe(graph);
    const firstRun = governed.invoke({ request: "first" }, runConfig("run-1"));
    await firstStarted;
    await expect(
      governed.invoke({ request: "second" }, runConfig("run-2"))
    ).resolves.toEqual({
      input: { request: "second" },
      config: runConfig("run-2"),
    });
    releaseFirst?.();
    await expect(firstRun).resolves.toEqual({
      input: { request: "first" },
      config: runConfig("run-1"),
    });
    expect(graph.invoke).toHaveBeenCalledTimes(2);
  });

  it("uses authoritative ownership instead of a conflicting client hint", async () => {
    const dependencies = configuredDependencies("supersede");
    const graph = {
      invoke: vi.fn(async (_input: unknown, _config?: unknown) => ({ ok: true })),
    };
    const governed = applyInteractionGovernance(
      graph,
      createInteractionOrchestrator(dependencies.config)
    );

    await expect(
      governed.invoke({ messages: ["change the request"] }, runConfig())
    ).resolves.toEqual({ ok: true });

    expect(dependencies.ownershipRepository.supersede).toHaveBeenCalledWith({
      threadId: "thread-1",
      scopeId: "scope-1",
      expectedGeneration: 3,
      replacementTaskId: "task-run-2",
      replacementRunId: "run-2",
    });
    expect(dependencies.eventRecorder.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "superseded",
        payload: expect.objectContaining({
          priorRunId: "run-1",
          replacementRunId: "run-2",
          generation: 4,
        }),
      })
    );
    expect(dependencies.recordMetric).toHaveBeenCalledWith(
      "interaction.decision",
      expect.not.objectContaining({
        threadId: expect.anything(),
        runId: expect.anything(),
        generation: expect.anything(),
      })
    );
  });

  it.each([
    { strategy: "reject" as const, invokesGraph: false },
    { strategy: "enqueue" as const, invokesGraph: true },
  ])("applies the $strategy policy path", async ({ strategy, invokesGraph }) => {
    const dependencies = configuredDependencies(strategy);
    const graph = {
      invoke: vi.fn(async (_input: unknown, _config?: unknown) => ({ ok: true })),
    };
    const governed = applyInteractionGovernance(
      graph,
      createInteractionOrchestrator(dependencies.config)
    );

    const execution = governed.invoke(
      { messages: ["new input"] },
      runConfig()
    );
    if (strategy === "reject") {
      await expect(execution).rejects.toMatchObject({
        name: "InteractionGovernanceRejectedError",
      });
    } else {
      await expect(execution).resolves.toEqual({ ok: true });
    }
    expect(graph.invoke).toHaveBeenCalledTimes(invokesGraph ? 1 : 0);
    expect(dependencies.ownershipRepository.supersede).not.toHaveBeenCalled();
    expect(dependencies.eventRecorder.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "interaction_decision",
        payload: expect.objectContaining({
          decision: expect.objectContaining({ strategy }),
        }),
      })
    );
  });

  it("emits the generation before stream chunks and marks terminal ownership", async () => {
    const dependencies = configuredDependencies("supersede");
    const graph = {
      async stream(_input: unknown, _config?: unknown) {
        return {
          async *[Symbol.asyncIterator]() {
            yield { messages: ["new answer"] };
          },
        };
      },
    };
    const governed = applyInteractionGovernance(
      graph,
      createInteractionOrchestrator(dependencies.config)
    );

    const stream = await governed.stream({}, runConfig());
    const chunks: unknown[] = [];
    for await (const chunk of stream) chunks.push(chunk);

    expect(chunks[0]).toMatchObject({
      interaction_runtime: {
        taskEvent: {
          eventType: "superseded",
          payload: { generation: 4, replacementRunId: "run-2" },
        },
      },
    });
    expect(chunks[1]).toEqual({ messages: ["new answer"] });
    expect(dependencies.ownershipRepository.markTerminal).toHaveBeenCalledWith({
      threadId: "thread-1",
      scopeId: "scope-1",
      runId: "run-2",
      status: "completed",
    });
  });

  it("marks ownership terminal when stream setup fails", async () => {
    const dependencies = configuredDependencies("supersede");
    const graph = {
      stream: vi.fn(async (_input: unknown, _config?: unknown) => {
        throw new Error("stream setup failed");
      }),
    };
    const governed = applyInteractionGovernance(
      graph,
      createInteractionOrchestrator(dependencies.config)
    );

    await expect(governed.stream({}, runConfig())).rejects.toThrow(
      "stream setup failed"
    );
    expect(dependencies.ownershipRepository.markTerminal).toHaveBeenCalledWith({
      threadId: "thread-1",
      scopeId: "scope-1",
      runId: "run-2",
      status: "completed",
    });
  });

  it("does not supersede ownership when cancellation requires manual handling", async () => {
    const dependencies = configuredDependencies("supersede");
    dependencies.config.decideCancellation = vi.fn(async () => ({
      phase: "irreversible_committed" as const,
      path: "manual_intervention_required" as const,
    }));
    const graph = {
      invoke: vi.fn(async (_input: unknown, _config?: unknown) => ({ ok: true })),
    };
    const governed = applyInteractionGovernance(
      graph,
      createInteractionOrchestrator(dependencies.config)
    );

    await expect(governed.invoke({}, runConfig())).rejects.toMatchObject({
      reasonCode: "ACTIVE_RUN_REQUIRES_CORRECTIVE_OR_MANUAL_HANDLING",
    });
    expect(dependencies.ownershipRepository.supersede).not.toHaveBeenCalled();
    expect(dependencies.eventRecorder.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "manual_intervention_required" })
    );
  });
});
