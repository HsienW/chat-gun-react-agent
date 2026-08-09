import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createNoopSpanManager,
  type SpanOptions,
  type SpanManager,
} from "./tracing/span-manager.js";

describe("llmGateway tracing", () => {
  afterEach(async () => {
    const { setSpanManagerForTests } = await import("./tracing/span-manager.js");
    setSpanManagerForTests(undefined);
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("wraps model invocation in an llm.call span", async () => {
    vi.stubEnv("LLM_PROVIDER", "qwen");
    vi.stubEnv("QWEN_BASE_URL", "http://qwen.internal/v1");
    vi.stubEnv("QWEN_CHAT_MODEL", "qwen-test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    );

    const withSpan = vi.fn();
    const noopManager = createNoopSpanManager();
    const manager: SpanManager = {
      startSpan: (name, options) => noopManager.startSpan(name, options),
      endSpan: (span) => noopManager.endSpan(span),
      recordException: (span, error) => noopManager.recordException(span, error),
      setAttributes: (span, attributes) => noopManager.setAttributes(span, attributes),
      getActiveSpan: () => noopManager.getActiveSpan(),
      async withSpan<T>(
        name: string,
        options: SpanOptions,
        operation: () => Promise<T> | T
      ): Promise<T> {
        withSpan(name, options, operation);
        return operation();
      },
    };
    const { setSpanManagerForTests } = await import("./tracing/span-manager.js");
    setSpanManagerForTests(manager);
    const { llmGateway } = await import("./llm-gateway.js");

    await llmGateway.createChatModel({ purpose: "chat" }).invoke("ping", {
      taskId: "task-1",
      stepId: "step-1",
    });

    expect(withSpan).toHaveBeenCalledWith(
      "llm.call",
      {
        attributes: {
          "model.name": "qwen-test",
          "model.provider": "qwen",
          "task.id": "task-1",
          "step.id": "step-1",
        },
      },
      expect.any(Function)
    );
  });

  it("records model.call for primary-only model invocations", async () => {
    vi.stubEnv("LLM_PROVIDER", "qwen");
    vi.stubEnv("QWEN_BASE_URL", "http://qwen.internal/v1");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    );

    const { createMetricsCollector, setMetricsCollector } = await import(
      "./metrics/metrics-collector.js"
    );
    const collector = createMetricsCollector();
    setMetricsCollector(collector);
    const { llmGateway } = await import("./llm-gateway.js");

    await llmGateway.createChatModel({ maxRetries: 0 }).invoke("ping");

    expect(
      collector.entries().filter(
        (entry) => entry.kind === "event" && entry.name === "model.call"
      )
    ).toHaveLength(1);
  });
});
