import { describe, expect, it } from "vitest";

import { createMetricsCollector } from "./metrics-collector.js";

describe("MetricsCollector", () => {
  it("keeps only the latest entries within the configured capacity", () => {
    const collector = createMetricsCollector({ maxEntries: 2 });

    collector.record({ kind: "task", taskId: "task-1", status: "completed", ts: 1 });
    collector.record({ kind: "task", taskId: "task-2", status: "failed", ts: 2 });
    collector.record({ kind: "task", taskId: "task-3", status: "running", ts: 3 });

    expect(collector.entries()).toEqual([
      { kind: "task", taskId: "task-2", status: "failed", ts: 2 },
      { kind: "task", taskId: "task-3", status: "running", ts: 3 },
    ]);
  });

  it("returns the zero-value snapshot for an empty collector", () => {
    const snapshot = createMetricsCollector().snapshot();

    expect(snapshot.metrics.tasks.total).toBe(0);
    expect(snapshot.metrics.tools.total).toBe(0);
    expect(snapshot.metrics.rates.taskSuccessRate).toBe(1);
    expect(snapshot.metrics.rates.toolSuccessRate).toBe(1);
  });

  it("aggregates task, step, tool, token, cost, latency, and rate metrics", () => {
    const collector = createMetricsCollector();

    collector.record({ kind: "task", taskId: "task-1", status: "completed", durationMs: 100, ts: 1 });
    collector.record({ kind: "task", taskId: "task-2", status: "failed", durationMs: 300, ts: 2 });
    collector.record({ kind: "step", taskId: "task-1", stepId: "step-1", nodeName: "plan", status: "retrying", attempt: 1, ts: 3 });
    collector.record({ kind: "step", taskId: "task-1", stepId: "step-1", nodeName: "plan", status: "completed", attempt: 2, durationMs: 20, ts: 4 });
    collector.record({ kind: "tool", taskId: "task-1", stepId: "step-1", toolName: "search", status: "success", durationMs: 10, ts: 5 });
    collector.record({ kind: "tool", taskId: "task-2", stepId: "step-2", toolName: "search", status: "timeout", durationMs: 50, ts: 6 });
    collector.record({ kind: "token", taskId: "task-1", stepId: "step-1", model: "model-a", provider: "qwen", inputTokens: 10, outputTokens: 5, totalTokens: 15, ts: 7 });
    collector.record({ kind: "cost", taskId: "task-1", totalCost: 0.25, currency: "USD", breakdown: { modelCost: 0.2, toolCost: 0.05 }, ts: 8 });

    expect(collector.snapshot().metrics).toMatchObject({
      tasks: { total: 2, completed: 1, failed: 1 },
      steps: { total: 2, completed: 1, retrying: 1 },
      tools: { total: 2, success: 1, timeout: 1 },
      tokens: { totalInput: 10, totalOutput: 5, totalTokens: 15, avgTokensPerTask: 15 },
      cost: { totalCost: 0.25, currency: "USD", modelCost: 0.2, toolCost: 0.05 },
      latency: { avgTaskDurationMs: 200, p95TaskDurationMs: 300 },
      rates: { taskSuccessRate: 0.5, toolSuccessRate: 0.5, retryRecoveryRate: 1 },
    });
  });

  it("does not retain entries when collection is disabled", () => {
    const collector = createMetricsCollector({ isEnabled: false });

    collector.record({ kind: "task", taskId: "task-1", status: "running", ts: 1 });

    expect(collector.entries()).toEqual([]);
  });

  it("counts fallback rate by logical model call rather than provider transition", () => {
    const collector = createMetricsCollector();
    collector.record({
      kind: "event",
      name: "model.call",
      value: 1,
      attributes: { callId: "call-1" },
      ts: 1,
    });
    collector.record({
      kind: "event",
      name: "model.call",
      value: 1,
      attributes: { callId: "call-2" },
      ts: 2,
    });
    collector.record({
      kind: "event",
      name: "model.fallback.attempt",
      value: 1,
      attributes: { callId: "call-1" },
      ts: 3,
    });
    collector.record({
      kind: "event",
      name: "model.fallback.attempt",
      value: 1,
      attributes: { callId: "call-1" },
      ts: 4,
    });

    expect(collector.snapshot().metrics.rates.modelFallbackRate).toBe(0.5);
  });
});
