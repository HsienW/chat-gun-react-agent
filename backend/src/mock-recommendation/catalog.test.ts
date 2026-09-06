import { describe, expect, it } from "vitest";

import { MOCK_CATALOG } from "./catalog.js";
import { validateMockProduct } from "./types.js";

describe("MOCK_CATALOG", () => {
  it("contains 10 to 20 runtime-valid products", () => {
    expect(MOCK_CATALOG.length).toBeGreaterThanOrEqual(10);
    expect(MOCK_CATALOG.length).toBeLessThanOrEqual(20);
    expect(MOCK_CATALOG.map(validateMockProduct)).toHaveLength(
      MOCK_CATALOG.length
    );
  });

  it("contains the A1, A2, and A3 hard-negative set", () => {
    expect(MOCK_CATALOG).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          productId: "A1",
          category: "X",
          color: "red",
        }),
        expect.objectContaining({
          productId: "A2",
          category: "X",
          color: "blue",
        }),
        expect.objectContaining({
          productId: "A3",
          category: "Y",
          color: "red",
        }),
      ])
    );
  });

  it("uses one non-empty demo tenant and owner scope", () => {
    expect(new Set(MOCK_CATALOG.map((product) => product.tenantId)).size).toBe(1);
    expect(
      new Set(MOCK_CATALOG.map((product) => product.ownerScopeId)).size
    ).toBe(1);
    expect(MOCK_CATALOG[0]?.tenantId.trim()).not.toBe("");
    expect(MOCK_CATALOG[0]?.ownerScopeId.trim()).not.toBe("");
  });
});
