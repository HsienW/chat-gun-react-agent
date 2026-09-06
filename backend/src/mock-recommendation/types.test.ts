import { describe, expect, it } from "vitest";

import {
  validateMockCardPayload,
  validateMockIntent,
  validateMockProduct,
} from "./types.js";

describe("mock recommendation runtime validation", () => {
  it("validates a product with finite price and non-empty scope identifiers", () => {
    expect(
      validateMockProduct({
        productId: "A1",
        category: "X",
        color: "red",
        price: 10,
        tenantId: "demo-tenant",
        ownerScopeId: "demo-scope",
      })
    ).toEqual({
      productId: "A1",
      category: "X",
      color: "red",
      price: 10,
      tenantId: "demo-tenant",
      ownerScopeId: "demo-scope",
    });
  });

  it.each([
    ["productId", ""],
    ["tenantId", "   "],
    ["ownerScopeId", ""],
    ["price", Number.POSITIVE_INFINITY],
  ])("rejects an invalid %s", (field, invalidValue) => {
    expect(() =>
      validateMockProduct({
        productId: "A1",
        category: "X",
        color: "red",
        price: 10,
        tenantId: "demo-tenant",
        ownerScopeId: "demo-scope",
        [field]: invalidValue,
      })
    ).toThrow();
  });

  it("validates intent confidence and optional known fields", () => {
    expect(
      validateMockIntent({ category: "X", price: "10", confidence: 0.75 })
    ).toEqual({ category: "X", price: "10", confidence: 0.75 });
    expect(() => validateMockIntent({ confidence: Number.NaN })).toThrow(
      "confidence"
    );
    expect(() => validateMockIntent({ confidence: 1.1 })).toThrow(
      "confidence"
    );
  });

  it("validates card payload display fields", () => {
    expect(
      validateMockCardPayload({
        title: "Mock product A1",
        category: "X",
        color: "red",
        price: 10,
      })
    ).toEqual({
      title: "Mock product A1",
      category: "X",
      color: "red",
      price: 10,
    });
  });
});
