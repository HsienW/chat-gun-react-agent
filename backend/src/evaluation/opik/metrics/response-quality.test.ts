import { describe, expect, it, vi } from "vitest";

import type { AgentRunResult, EvaluationItem } from "../types.js";
import {
  ResponseQualityMetric,
  type JudgeInvoker,
} from "./response-quality.js";

const item: EvaluationItem = {
  id: "quality-case",
  input: { intent: "weather", parameters: { location: "Tokyo" } },
  expectedOutput: { summary: "Answer the current weather for Tokyo." },
};
const result: AgentRunResult = {
  response: "Tokyo is currently 24°C and clear.",
  toolCalls: [],
};
const config = {
  model: "judge-test",
  provider: "qwen",
  temperature: 0.7,
  promptTemplate: "Score response quality from 0 to 1 and explain why.",
  promptVersion: "v1",
};

describe("ResponseQualityMetric", () => {
  it("returns a high score with reasoning and forces judge temperature to zero", async () => {
    const invoke = vi.fn(async () => ({ score: 0.9, reasoning: "Complete and relevant" }));
    const metric = new ResponseQualityMetric(config, { invoke });

    const score = await metric.evaluate(item, result);

    expect(score).toMatchObject({
      name: "response_quality",
      value: 0.9,
      reason: "Complete and relevant",
      status: "COMPLETED",
      deterministic: false,
    });
    expect(metric.judgeConfig.temperature).toBe(0);
    expect(Object.isFrozen(metric.judgeConfig)).toBe(true);
    expect(metric.judgeConfig.promptTemplateHash).toMatch(/^[a-f0-9]{64}$/);
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 0, model: "judge-test" })
    );
  });

  it("preserves a low judge score for an irrelevant response", async () => {
    const invoker: JudgeInvoker = {
      invoke: async () => ({ score: 0.2, reasoning: "Unrelated to the question" }),
    };
    const metric = new ResponseQualityMetric(config, invoker);

    const score = await metric.evaluate(item, {
      response: "The moon has low gravity.",
      toolCalls: [],
    });

    expect(score.value).toBeLessThan(0.5);
    expect(score.reason).toContain("Unrelated");
  });

  it("marks judge connectivity failures as FAILED without throwing", async () => {
    const metric = new ResponseQualityMetric(config, {
      invoke: async () => {
        throw new Error("judge unavailable");
      },
    });

    await expect(metric.evaluate(item, result)).resolves.toMatchObject({
      name: "response_quality",
      value: 0,
      status: "FAILED",
      failureType: "JUDGE_FAILED",
      reason: "judge unavailable",
    });
  });
});
