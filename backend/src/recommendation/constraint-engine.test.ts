import { describe, expect, it } from "vitest";

import { ConstraintEngine } from "./constraint-engine.js";
import type { Constraint } from "./types.js";

function constraint(overrides: Partial<Constraint> = {}): Constraint {
  return {
    field: "preference",
    value: "value-1",
    source: "memory",
    confidence: 0.5,
    mode: "soft",
    ...overrides,
  };
}

describe("ConstraintEngine.resolve", () => {
  it("prefers user_text over memory for the same field", () => {
    const engine = new ConstraintEngine();

    const resolution = engine.resolve([
      constraint({ value: "memory-value", source: "memory", confidence: 1 }),
      constraint({ value: "explicit-value", source: "user_text", confidence: 0.3 }),
    ]);

    expect(resolution).toEqual({
      resolved: [
        expect.objectContaining({
          value: "explicit-value",
          source: "user_text",
        }),
      ],
      conflicts: [],
    });
  });

  it("prefers higher confidence within the same source", () => {
    const engine = new ConstraintEngine();

    const resolution = engine.resolve([
      constraint({ value: "low", confidence: 0.3 }),
      constraint({ value: "high", confidence: 0.9 }),
    ]);

    expect(resolution.resolved[0]?.value).toBe("high");
    expect(resolution.conflicts).toEqual([]);
  });

  it("preserves equal-priority equal-confidence value conflicts", () => {
    const engine = new ConstraintEngine();
    const conflicting = [
      constraint({ value: "value-a", confidence: 0.8, mode: "hard" }),
      constraint({ value: "value-b", confidence: 0.8, mode: "hard" }),
    ];

    const resolution = engine.resolve(conflicting);

    expect(resolution.resolved).toEqual([]);
    expect(resolution.conflicts).toEqual([
      { field: "preference", constraints: conflicting },
    ]);
  });

  it("rejects invalid constraints before resolution", () => {
    const engine = new ConstraintEngine();

    expect(() =>
      engine.resolve([constraint({ confidence: Number.NaN })])
    ).toThrow("confidence must be a finite number between 0 and 1");
  });
});

describe("ConstraintEngine.evaluateCandidate", () => {
  it("excludes a candidate that violates a hard constraint", () => {
    const engine = new ConstraintEngine();
    const resolution = engine.resolve([
      constraint({ field: "category", value: "required", mode: "hard" }),
    ]);

    expect(engine.evaluateCandidate(resolution, { category: "other" })).toEqual({
      eligible: false,
      reason: "Candidate violates a hard constraint",
      reasonCode: "HARD_CONSTRAINT_VIOLATION",
    });
  });

  it("adjusts score without excluding for a soft violation", () => {
    const engine = new ConstraintEngine();
    const resolution = engine.resolve([
      constraint({ field: "preference", value: "preferred", mode: "soft" }),
    ]);

    expect(
      engine.evaluateCandidate(resolution, { preference: "other" })
    ).toEqual({
      eligible: true,
      reason: "Candidate violates one or more soft constraints",
      reasonCode: "SOFT_CONSTRAINT_ADJUSTED",
      adjustedScore: 0.9,
    });
  });

  it("supports an injected soft penalty strategy", () => {
    const engine = new ConstraintEngine({
      calculateSoftScore: (violationCount) => 1 - violationCount * 0.25,
    });
    const resolution = engine.resolve([
      constraint({ field: "first", value: "a", mode: "soft" }),
      constraint({ field: "second", value: "b", mode: "soft" }),
    ]);

    expect(
      engine.evaluateCandidate(resolution, { first: "x", second: "y" })
        .adjustedScore
    ).toBe(0.5);
  });

  it("fails closed when a hard conflict is unresolved", () => {
    const engine = new ConstraintEngine();
    const resolution = engine.resolve([
      constraint({ value: "value-a", confidence: 0.8, mode: "hard" }),
      constraint({ value: "value-b", confidence: 0.8, mode: "hard" }),
    ]);

    expect(engine.evaluateCandidate(resolution, {})).toEqual({
      eligible: false,
      reason: "Hard constraints contain an unresolved conflict",
      reasonCode: "HARD_CONSTRAINT_CONFLICT",
    });
  });
});
