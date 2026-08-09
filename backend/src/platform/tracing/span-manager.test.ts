import { SpanKind, SpanStatusCode, type Span, type Tracer } from "@opentelemetry/api";
import { describe, expect, it, vi } from "vitest";

import {
  createSpanManager,
  createNoopSpanManager,
} from "./span-manager.js";

function createSpan(): Span {
  return {
    spanContext: vi.fn(() => ({
      traceId: "0".repeat(32),
      spanId: "0".repeat(16),
      traceFlags: 0,
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

describe("SpanManager", () => {
  it("starts and ends spans with service attributes", () => {
    const span = createSpan();
    const tracer: Tracer = {
      startSpan: vi.fn(() => span),
      startActiveSpan: vi.fn(),
    };
    const manager = createSpanManager({ tracer, serviceName: "backend" });

    const started = manager.startSpan("tool.execute", {
      kind: SpanKind.INTERNAL,
      attributes: { "tool.name": "web_search" },
    });
    manager.endSpan(started);

    expect(tracer.startSpan).toHaveBeenCalledWith(
      "tool.execute",
      expect.objectContaining({
        kind: SpanKind.INTERNAL,
        attributes: {
          "service.name": "backend",
          "tool.name": "web_search",
        },
      }),
      expect.anything()
    );
    expect(span.end).toHaveBeenCalledTimes(1);
  });

  it("records exceptions and marks spans as errors", () => {
    const span = createSpan();
    const tracer: Tracer = {
      startSpan: vi.fn(() => span),
      startActiveSpan: vi.fn(),
    };
    const manager = createSpanManager({ tracer, serviceName: "backend" });
    const error = new TypeError("model failed");

    manager.recordException(span, error);

    expect(span.recordException).toHaveBeenCalledWith(
      expect.objectContaining({ name: "TypeError", message: "model failed" })
    );
    expect(span.setAttributes).toHaveBeenCalledWith({
      "error.type": "TypeError",
      "error.message": "model failed",
    });
    expect(span.setStatus).toHaveBeenCalledWith({
      code: SpanStatusCode.ERROR,
      message: "model failed",
    });
  });

  it("redacts credentials from exported exception data", () => {
    const span = createSpan();
    const tracer: Tracer = {
      startSpan: vi.fn(() => span),
      startActiveSpan: vi.fn(),
    };
    const manager = createSpanManager({ tracer, serviceName: "backend" });

    manager.recordException(
      span,
      new Error("authorization=Bearer-secret token=private-value")
    );

    expect(span.recordException).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "authorization=[redacted] token=[redacted]",
      })
    );
    expect(span.setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        "error.message": "authorization=[redacted] token=[redacted]",
      })
    );
  });

  it("keeps the operation result and span lifecycle inside withSpan", async () => {
    const span = createSpan();
    const tracer: Tracer = {
      startSpan: vi.fn(() => span),
      startActiveSpan: vi.fn(),
    };
    const manager = createSpanManager({ tracer, serviceName: "backend" });

    await expect(
      manager.withSpan("langgraph.node.plan", {}, async () => "ok")
    ).resolves.toBe("ok");
    expect(span.end).toHaveBeenCalledTimes(1);
  });

  it("is fully no-op when tracing is disabled", async () => {
    const manager = createNoopSpanManager();
    const span = manager.startSpan("disabled");

    manager.setAttributes(span, { "task.id": "task-1" });
    manager.recordException(span, new Error("ignored"));
    manager.endSpan(span);

    expect(manager.getActiveSpan()).toBeUndefined();
    await expect(manager.withSpan("disabled", {}, async () => 42)).resolves.toBe(42);
  });

  it("continues the operation when span creation fails", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const tracer: Tracer = {
      startSpan: vi.fn(() => {
        throw new Error("tracer unavailable");
      }),
      startActiveSpan: vi.fn(),
    };
    const manager = createSpanManager({ tracer, serviceName: "backend" });

    await expect(
      manager.withSpan("langgraph.node.plan", {}, async () => "still-runs")
    ).resolves.toBe("still-runs");
    expect(warning).toHaveBeenCalled();
  });
});
