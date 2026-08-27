import { describe, expect, it } from "vitest";

import { createDecisionRecord } from "./decision-record.js";

describe("createDecisionRecord", () => {
  it("creates a decision record with correlation fields and policy version", () => {
    const record = createDecisionRecord({
      decisionId: "decision-1",
      requestId: "request-1",
      threadId: "thread-1",
      runId: "run-1",
      taskId: "task-1",
      stepId: "step-1",
      decisionType: "routing",
      outcome: "selected",
      reasonCode: "POLICY_MATCH",
      confidence: 0.75,
      policyVersion: "policy-v1",
      now: () => new Date("2026-08-27T00:00:00.000Z"),
    });

    expect(record).toEqual({
      decisionId: "decision-1",
      requestId: "request-1",
      threadId: "thread-1",
      runId: "run-1",
      taskId: "task-1",
      stepId: "step-1",
      decisionType: "routing",
      outcome: "selected",
      reasonCode: "POLICY_MATCH",
      confidence: 0.75,
      policyVersion: "policy-v1",
      createdAt: "2026-08-27T00:00:00.000Z",
    });
  });

  it("rejects missing required fields", () => {
    expect(() =>
      createDecisionRecord({
        decisionId: "",
        decisionType: "routing",
        outcome: "selected",
        reasonCode: "POLICY_MATCH",
      })
    ).toThrow("decisionId is required");
    expect(() =>
      createDecisionRecord({
        decisionId: "decision-1",
        decisionType: "",
        outcome: "selected",
        reasonCode: "POLICY_MATCH",
      })
    ).toThrow("decisionType is required");
  });

  it("rejects confidence outside the finite inclusive range", () => {
    const baseInput = {
      decisionId: "decision-1",
      decisionType: "routing",
      outcome: "selected",
      reasonCode: "POLICY_MATCH",
    };

    expect(() =>
      createDecisionRecord({ ...baseInput, confidence: -0 })
    ).toThrow("confidence must be a finite number between 0 and 1");
    expect(() =>
      createDecisionRecord({ ...baseInput, confidence: Number.NaN })
    ).toThrow("confidence must be a finite number between 0 and 1");
    expect(() =>
      createDecisionRecord({ ...baseInput, confidence: Number.POSITIVE_INFINITY })
    ).toThrow("confidence must be a finite number between 0 and 1");
    expect(() =>
      createDecisionRecord({ ...baseInput, confidence: 1.1 })
    ).toThrow("confidence must be a finite number between 0 and 1");
  });

  it("does not expose raw chain-of-thought fields", () => {
    const record = createDecisionRecord({
      decisionId: "decision-1",
      decisionType: "routing",
      outcome: "selected",
      reasonCode: "POLICY_MATCH",
    });

    expect(record).not.toHaveProperty("rawReasoning");
    expect(record).not.toHaveProperty("chainOfThought");
    expect(record).not.toHaveProperty("prompt");
  });
});
