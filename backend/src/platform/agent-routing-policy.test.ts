import { describe, expect, it } from "vitest";

import { createPlannerFailureRoutingDecision } from "./agent-routing-policy.js";

describe("createPlannerFailureRoutingDecision", () => {
  it("does not extract a weather location by stripping configured keywords", () => {
    const decision = createPlannerFailureRoutingDecision(
      "\u53f0\u5317\u73fe\u5728\u5929\u6c23\u5982\u4f55\uFF1F",
      "mock planner failure"
    );

    expect(decision.answerMode).toBe("clarify");
    expect(decision.weather).toBeUndefined();
    expect(decision.clarification).toContain("\u57ce\u5e02\u6216\u5730\u5340");
    expect(decision.rationale).toContain("location extraction requires planner");
  });

  it("keeps calculation keyword cleanup scoped to calculation fallback", () => {
    const decision = createPlannerFailureRoutingDecision("calculate 2 + 2");

    expect(decision.answerMode).toBe("calculation");
    expect(decision.calculation?.expression).toBe("2 + 2");
  });
});
