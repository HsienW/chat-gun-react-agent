import { describe, expect, it } from "vitest";

import {
  validateConstraint,
  validateRecommendationInput,
} from "./types.js";

const principal = {
  principalId: "principal-1",
  principalType: "user" as const,
  tenantId: "tenant-1",
  roles: [],
  scopes: [],
  authSource: "trusted_gateway" as const,
  authenticatedAt: "2026-08-30T00:00:00.000Z",
};

const scope = {
  scopeId: "scope-1",
  scopeType: "conversation" as const,
  tenantId: "tenant-1",
};

describe("validateConstraint", () => {
  it.each([-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects confidence outside the finite inclusive range: %s",
    (confidence) => {
      expect(() =>
        validateConstraint({
          field: "preference",
          value: "value-1",
          source: "user_text",
          confidence,
          mode: "hard",
        })
      ).toThrow("confidence must be a finite number between 0 and 1");
    }
  );

  it("rejects an unknown constraint mode", () => {
    expect(() =>
      validateConstraint({
        field: "preference",
        value: "value-1",
        source: "user_text",
        confidence: 0.8,
        mode: "required",
      })
    ).toThrow("mode must be a valid constraint mode");
  });
});

describe("validateRecommendationInput", () => {
  it("rejects signals that are not an array", () => {
    expect(() =>
      validateRecommendationInput({
        principal,
        scope,
        signals: "not-an-array",
      })
    ).toThrow("signals must be an array");
  });

  it("accepts trusted identity and validated signals", () => {
    const input = validateRecommendationInput({
      requestId: "request-1",
      principal,
      scope,
      signals: [
        {
          field: "preference",
          value: "value-1",
          source: "selection",
          confidence: 1,
          mode: "soft",
        },
      ],
    });

    expect(input.principal).toBe(principal);
    expect(input.scope).toBe(scope);
    expect(input.signals).toHaveLength(1);
  });

  it("rejects identity values outside the X8.7 protocol enums", () => {
    expect(() =>
      validateRecommendationInput({
        principal: { ...principal, principalType: "guest" },
        scope,
        signals: [],
      })
    ).toThrow("principal must be a valid trusted principal context");
    expect(() =>
      validateRecommendationInput({
        principal,
        scope: { ...scope, scopeType: "global" },
        signals: [],
      })
    ).toThrow("scope must be a valid runtime scope");
  });
});
