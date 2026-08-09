import { describe, expect, it } from "vitest";

import { computeTokenCost, DEFAULT_TOKEN_RATE, recordCostMetric } from "./cost-tracker.js";
import { createMetricsCollector } from "./metrics-collector.js";

describe("cost tracking", () => {
  it("computes input, output, and total USD costs using per-million rates", () => {
    expect(
      computeTokenCost(
        { provider: "qwen", inputTokens: 1_000, outputTokens: 500 },
        { qwen: { inputPerMillion: 0.15, outputPerMillion: 0.6, currency: "USD" } }
      )
    ).toEqual({
      inputCost: 0.00015,
      outputCost: 0.0003,
      totalCost: 0.00045,
      currency: "USD",
      rateSource: "provider",
    });
  });

  it("uses the conservative default rate for an unknown provider", () => {
    const cost = computeTokenCost({ provider: "unknown", inputTokens: 1_000, outputTokens: 500 });

    expect(cost.rateSource).toBe("default");
    expect(cost.totalCost).toBe(
      DEFAULT_TOKEN_RATE.inputPerMillion / 1_000 + DEFAULT_TOKEN_RATE.outputPerMillion / 2_000
    );
  });

  it("records the model and tool cost breakdown for a task", () => {
    const collector = createMetricsCollector();

    recordCostMetric({ taskId: "task-1", modelCost: 0.2, toolCost: 0.05 }, collector);

    expect(collector.entries()[0]).toMatchObject({
      kind: "cost",
      taskId: "task-1",
      totalCost: 0.25,
      currency: "USD",
      breakdown: { modelCost: 0.2, toolCost: 0.05 },
    });
  });
});
