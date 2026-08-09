import { describe, expect, it, vi } from "vitest";

import {
  createNoopSpanManager,
  type SpanOptions,
  type SpanManager,
} from "../platform/tracing/span-manager.js";
import { deepResearcherTracingTestInternals } from "./deep-researcher.js";

describe("deep researcher tracing", () => {
  it("wraps a graph node with node, task, and step attributes", async () => {
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
    const node = vi.fn(async (_state: unknown, _config: unknown) => ({ completed: true }));
    const traced = deepResearcherTracingTestInternals.traceNode(
      "plan_research",
      node,
      manager
    );

    await expect(
      traced({}, { configurable: { task_id: "task-1" } })
    ).resolves.toEqual({ completed: true });
    expect(withSpan).toHaveBeenCalledWith(
      "langgraph.node.plan_research",
      {
        attributes: {
          "node.name": "plan_research",
          "step.id": "plan_research",
          "task.id": "task-1",
        },
      },
      expect.any(Function)
    );
  });
});
