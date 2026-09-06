import { describe, expect, it } from "vitest";

import type { RecommendationInput } from "../recommendation/index.js";
import {
  MOCK_CATALOG_OWNER_SCOPE_ID,
  MOCK_CATALOG_TENANT_ID,
} from "./catalog.js";
import { createMockRecommendationEngine } from "./compose.js";

const input: RecommendationInput = {
  principal: {
    principalId: "principal-1",
    principalType: "user",
    tenantId: MOCK_CATALOG_TENANT_ID,
    roles: [],
    scopes: [],
    authSource: "trusted_gateway",
    authenticatedAt: "2026-09-01T00:00:00.000Z",
  },
  scope: {
    scopeId: MOCK_CATALOG_OWNER_SCOPE_ID,
    scopeType: "conversation",
    tenantId: MOCK_CATALOG_TENANT_ID,
  },
  signals: [
    {
      field: "category",
      value: "X",
      source: "user_text",
      confidence: 1,
      mode: "hard",
    },
  ],
};

describe("createMockRecommendationEngine", () => {
  it("creates a usable engine that deterministically routes to mock", async () => {
    const engine = createMockRecommendationEngine({
      candidateLimit: 2,
      now: () => new Date("2026-09-01T00:00:00.000Z"),
    });

    const result = await engine.recommend(input);

    expect(result.domain).toBe("mock");
    expect(result.cards).toHaveLength(2);
    expect(result.clarificationRequested).toBe(false);
  });

  it("uses fail-closed zero confidence for empty signals", async () => {
    const engine = createMockRecommendationEngine({ candidateLimit: 1 });

    const result = await engine.recommend({ ...input, signals: [] });

    expect(result.domain).toBe("mock");
    expect(result.clarificationRequested).toBe(true);
  });
});
