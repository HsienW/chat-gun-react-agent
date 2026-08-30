import { describe, expect, it } from "vitest";

import { BusinessPolicyGate } from "./business-policy-gate.js";
import type { CandidateDecision } from "./types.js";

describe("BusinessPolicyGate", () => {
  const gate = new BusinessPolicyGate();

  it("excludes a hard violation instead of applying a score", () => {
    const decision: CandidateDecision = {
      eligible: true,
      reasonCode: "HARD_CONSTRAINT_VIOLATION",
      adjustedScore: 0.5,
    };

    const gated = gate.apply(decision);

    expect(gated.eligible).toBe(false);
    expect(gated).not.toHaveProperty("adjustedScore");
    expect(decision).toHaveProperty("adjustedScore", 0.5);
  });

  it("keeps a soft violation eligible and score-adjusted", () => {
    const decision: CandidateDecision = {
      eligible: true,
      reasonCode: "SOFT_CONSTRAINT_ADJUSTED",
      adjustedScore: 0.8,
    };

    expect(gate.apply(decision)).toEqual(decision);
  });

  it("fails closed for an unresolved hard conflict", () => {
    const gated = gate.apply(
      { eligible: true },
      {
        conflicts: [
          {
            field: "preference",
            constraints: [
              {
                field: "preference",
                value: "a",
                source: "user_text",
                confidence: 1,
                mode: "hard",
              },
              {
                field: "preference",
                value: "b",
                source: "user_text",
                confidence: 1,
                mode: "hard",
              },
            ],
          },
        ],
      }
    );

    expect(gated).toEqual({
      eligible: false,
      reason: "Hard constraints contain an unresolved conflict",
      reasonCode: "HARD_CONSTRAINT_CONFLICT",
    });
  });

  it("never flips an excluded decision to eligible", () => {
    const decision: CandidateDecision = {
      eligible: false,
      reasonCode: "UPSTREAM_EXCLUSION",
    };

    expect(gate.apply(decision)).toEqual(decision);
  });
});
