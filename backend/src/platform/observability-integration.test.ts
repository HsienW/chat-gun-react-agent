import { AIMessage } from "@langchain/core/messages";
import type { Span, Tracer } from "@opentelemetry/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { deepResearcherTracingTestInternals } from "../agents/deep-researcher.js";
import {
  FallbackChatModelInvoker,
  ProviderExhaustedError,
  type ModelFallbackPolicy,
} from "./llm-fallback.js";
import type { ChatModelInvoker } from "./llm-gateway.js";
import {
  createMetricsCollector,
  setMetricsCollector,
  type MetricsCollector,
} from "./metrics/metrics-collector.js";
import { recordTaskMetric } from "./metrics/instrumentation.js";
import { repairStructuredOutput } from "./structured-output-repair.js";
import {
  createNoopSpanManager,
  createSpanManager,
  setSpanManagerForTests,
  type SpanManager,
  type SpanOptions,
} from "./tracing/span-manager.js";

const fallbackPolicy: ModelFallbackPolicy = {
  primaryProvider: "ccr",
  fallbackProviders: ["qwen"],
  maxTotalAttempts: 2,
  repairStrategy: "retry_with_hint",
  perProviderTimeoutMs: 1_000,
};

function model(invoke: ChatModelInvoker["invoke"]): ChatModelInvoker {
  return { invoke };
}

function freshCollector(): MetricsCollector {
  const collector = createMetricsCollector({ isEnabled: true, maxEntries: 100 });
  setMetricsCollector(collector);
  return collector;
}

function fakeSpan(): Span {
  return {
    spanContext: vi.fn(() => ({
      traceId: "1".repeat(32),
      spanId: "2".repeat(16),
      traceFlags: 1,
    })),
    setAttribute: vi.fn(function (this: Span) { return this; }),
    setAttributes: vi.fn(function (this: Span) { return this; }),
    addEvent: vi.fn(function (this: Span) { return this; }),
    addLink: vi.fn(function (this: Span) { return this; }),
    addLinks: vi.fn(function (this: Span) { return this; }),
    setStatus: vi.fn(function (this: Span) { return this; }),
    updateName: vi.fn(function (this: Span) { return this; }),
    end: vi.fn(),
    isRecording: vi.fn(() => true),
    recordException: vi.fn(),
  };
}

function activeSpanManager(span: Span): SpanManager {
  const noop = createNoopSpanManager();
  return {
    startSpan: (name, options) => noop.startSpan(name, options),
    endSpan: (target) => noop.endSpan(target),
    recordException: (target, error) => noop.recordException(target, error),
    setAttributes: (target, attributes) => target.setAttributes(attributes),
    getActiveSpan: () => span,
    async withSpan<T>(
      _name: string,
      _options: SpanOptions,
      operation: () => Promise<T> | T
    ): Promise<T> {
      return operation();
    },
  };
}

describe("observability cross-layer integration", () => {
  afterEach(() => {
    setSpanManagerForTests(undefined);
    vi.restoreAllMocks();
  });

  it("collects metrics while a traced deep-researcher node executes", async () => {
    const collector = freshCollector();
    const span = fakeSpan();
    const tracer: Tracer = {
      startSpan: vi.fn(() => span),
      startActiveSpan: vi.fn(),
    };
    const manager = createSpanManager({ tracer, serviceName: "backend" });
    const tracedNode = deepResearcherTracingTestInternals.traceNode(
      "plan_research",
      async (_state: unknown, _config: unknown) => {
        recordTaskMetric({
          taskId: "task-1",
          status: "completed",
          durationMs: 12,
        });
        return { completed: true };
      },
      manager
    );

    await tracedNode({}, { configurable: { task_id: "task-1" } });

    expect(collector.snapshot().metrics.tasks).toMatchObject({
      total: 1,
      completed: 1,
    });
    expect(tracer.startSpan).toHaveBeenCalledWith(
      "langgraph.node.plan_research",
      expect.anything(),
      expect.anything()
    );
    expect(span.end).toHaveBeenCalledTimes(1);
  });

  it("increments modelFallbackRate when fallback succeeds", async () => {
    const collector = freshCollector();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const invoker = new FallbackChatModelInvoker(
      [
        {
          provider: "ccr",
          invoker: model(async () => {
            throw Object.assign(new Error("unavailable"), { statusCode: 502 });
          }),
        },
        { provider: "qwen", invoker: model(async () => new AIMessage("ok")) },
      ],
      fallbackPolicy
    );

    await invoker.invoke("ping");

    expect(collector.snapshot().metrics.rates.modelFallbackRate).toBe(1);
  });

  it("records repair attempts on the active span", async () => {
    freshCollector();
    const span = fakeSpan();
    setSpanManagerForTests(activeSpanManager(span));
    const invoke = vi
      .fn()
      .mockResolvedValueOnce('{"answer":')
      .mockResolvedValueOnce('{"answer":"fixed"}');

    const result = await repairStructuredOutput({
      invoke,
      schema: z.object({ answer: z.string() }),
      strategy: "retry_with_hint",
    });

    expect(result.status).toBe("repaired");
    expect(span.setAttributes).toHaveBeenCalledWith({
      "repair.attempts": 2,
      "repair.status": "repaired",
    });
  });

  it("keeps metrics enabled while tracing is no-op", () => {
    const collector = freshCollector();
    const manager = createNoopSpanManager();
    setSpanManagerForTests(manager);

    recordTaskMetric({ taskId: "task-disabled-tracing", status: "running" });
    const span = manager.startSpan("disabled");
    manager.endSpan(span);

    expect(manager.getActiveSpan()).toBeUndefined();
    expect(collector.snapshot().metrics.tasks.total).toBe(1);
  });

  it("records exhaustion with provider error categories", async () => {
    const collector = freshCollector();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const failingModel = () =>
      model(async () => {
        throw Object.assign(new Error("unavailable"), { statusCode: 503 });
      });
    const invoker = new FallbackChatModelInvoker(
      [
        { provider: "ccr", invoker: failingModel() },
        { provider: "qwen", invoker: failingModel() },
      ],
      fallbackPolicy
    );

    const error = await invoker.invoke("ping").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderExhaustedError);
    if (!(error instanceof ProviderExhaustedError)) {
      throw new Error("Expected ProviderExhaustedError");
    }
    expect(error.attempts.map(({ category }) => category)).toEqual([
      "provider_unavailable",
      "provider_unavailable",
    ]);
    expect(
      collector.entries().some(
        (entry) => entry.kind === "event" && entry.name === "modelFallbackExhausted"
      )
    ).toBe(true);
  });
});
