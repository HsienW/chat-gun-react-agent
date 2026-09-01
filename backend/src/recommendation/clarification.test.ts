import { describe, expect, it } from "vitest";

import {
  ClarificationFlow,
  type ClarificationFlowOptions,
} from "./clarification.js";
import type { ResolvedConstraint } from "./constraint-engine.js";
import type { RecommendationInput } from "./types.js";

const resolvedHardConstraint: ResolvedConstraint = {
  field: "category",
  value: "required",
  source: "user_text",
  confidence: 1,
  mode: "hard",
};

const input = {
  taskId: "task-1",
} as RecommendationInput;

function options(
  overrides: Partial<ClarificationFlowOptions> = {}
): ClarificationFlowOptions {
  return {
    confidenceThreshold: 0.7,
    requiredHardConstraintFields: ["category"],
    buildQuestion: async (_input, reasonCode) => `Question for ${reasonCode}`,
    createClarificationId: () => "clarification-1",
    now: () => new Date("2026-08-30T00:00:00.000Z"),
    ...overrides,
  };
}

describe("ClarificationFlow", () => {
  it("requests clarification below the configured confidence threshold", () => {
    const flow = new ClarificationFlow(options());

    expect(flow.shouldClarify(0.69, [resolvedHardConstraint])).toBe(true);
  });

  it("does not clarify for high confidence with all required hard fields", () => {
    const flow = new ClarificationFlow(options());

    expect(flow.shouldClarify(0.9, [resolvedHardConstraint])).toBe(false);
  });

  it("uses the injected threshold and required hard fields", () => {
    const strictFlow = new ClarificationFlow(
      options({ confidenceThreshold: 0.95 })
    );

    expect(strictFlow.shouldClarify(0.9, [resolvedHardConstraint])).toBe(true);
    expect(strictFlow.shouldClarify(1, [])).toBe(true);
  });

  it("creates an existing waiting_confirmation contract projection", async () => {
    const flow = new ClarificationFlow(options());

    await expect(
      flow.request(input, "LOW_CONFIDENCE_CLARIFICATION")
    ).resolves.toEqual({
      clarificationId: "clarification-1",
      taskId: "task-1",
      reasonCode: "LOW_CONFIDENCE_CLARIFICATION",
      question: "Question for LOW_CONFIDENCE_CLARIFICATION",
      requestedAt: "2026-08-30T00:00:00.000Z",
      confirmationType: "clarification",
      taskStatus: "waiting_confirmation",
    });
  });
});
