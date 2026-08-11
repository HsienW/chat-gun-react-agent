import { describe, expect, it } from "vitest";

import type { AgentRunResult, EvaluationItem } from "../types.js";
import { ToolCallCorrectnessMetric } from "./tool-call-correctness.js";

const metric = new ToolCallCorrectnessMetric();
const item: EvaluationItem = {
  id: "tokyo-weather",
  input: { intent: "weather", parameters: { location: "Tokyo" } },
  expectedOutput: {
    toolCalls: [{ name: "get_weather", arguments: { city: "Tokyo" } }],
  },
};

describe("ToolCallCorrectnessMetric", () => {
  it("returns 1.0 for an exact tool call match", () => {
    const result: AgentRunResult = {
      response: "Tokyo weather",
      toolCalls: [{ name: "get_weather", arguments: { city: "Tokyo" } }],
    };

    expect(metric.evaluate(item, result)).toEqual({
      name: "tool_call_correctness",
      value: 1,
      reason: "Tool call matches expected",
      status: "COMPLETED",
      deterministic: true,
    });
  });

  it("returns a partial score and explains mismatched arguments", () => {
    const result: AgentRunResult = {
      response: "Osaka weather",
      toolCalls: [{ name: "get_weather", arguments: { city: "Osaka" } }],
    };

    const score = metric.evaluate(item, result);
    expect(score.value).toBeGreaterThan(0);
    expect(score.value).toBeLessThan(1);
    expect(score.reason).toContain("city");
  });

  it("returns zero when no tool call was executed", () => {
    const score = metric.evaluate(item, { response: "No tools", toolCalls: [] });

    expect(score).toMatchObject({
      name: "tool_call_correctness",
      value: 0,
      reason: "No tool calls executed",
    });
  });
});
