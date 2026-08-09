import { describe, expect, it, vi } from "vitest";

import { createMetricsCollector } from "./metrics-collector.js";
import {
  recordStepMetric,
  recordTaskMetric,
  recordTokenMetric,
  recordToolMetric,
} from "./instrumentation.js";

describe("metrics instrumentation", () => {
  it("records task, step, and tool metrics with generated timestamps", () => {
    const collector = createMetricsCollector();

    recordTaskMetric({ taskId: "task-1", status: "running" }, collector);
    recordStepMetric({ taskId: "task-1", stepId: "step-1", nodeName: "plan", status: "completed" }, collector);
    recordToolMetric({ taskId: "task-1", stepId: "step-1", toolName: "search", status: "success", durationMs: 12 }, collector);

    expect(collector.entries()).toEqual([
      expect.objectContaining({ kind: "task", taskId: "task-1", status: "running", ts: expect.any(Number) }),
      expect.objectContaining({ kind: "step", stepId: "step-1", status: "completed", ts: expect.any(Number) }),
      expect.objectContaining({ kind: "tool", toolName: "search", durationMs: 12, ts: expect.any(Number) }),
    ]);
  });

  it("records zero token values when usage metadata is absent", () => {
    const collector = createMetricsCollector();

    recordTokenMetric({ taskId: "task-1", stepId: "step-1", model: "model-a", provider: "qwen", message: {} }, collector);

    expect(collector.entries()[0]).toMatchObject({
      kind: "token",
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    });
  });

  it("isolates collector failures from the agent flow", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const failingCollector = {
      record: () => {
        throw new Error("collector failed");
      },
    };

    expect(() => recordTaskMetric({ taskId: "task-1", status: "running" }, failingCollector)).not.toThrow();
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("metric_collection_failed"));
  });
});
