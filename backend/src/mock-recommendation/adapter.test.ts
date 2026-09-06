import { describe, expect, it } from "vitest";

import type { RecommendationInput } from "../recommendation/index.js";
import {
  MOCK_RECOMMENDATION_DOMAIN,
  MockRecommendationAdapter,
} from "./adapter.js";
import type { MockProduct } from "./types.js";

const baseInput: RecommendationInput = {
  principal: {
    principalId: "principal-1",
    principalType: "user",
    tenantId: "demo-tenant",
    roles: [],
    scopes: [],
    authSource: "trusted_gateway",
    authenticatedAt: "2026-09-01T00:00:00.000Z",
  },
  scope: {
    scopeId: "demo-scope",
    scopeType: "conversation",
    tenantId: "demo-tenant",
  },
  signals: [],
};

const product: MockProduct = {
  productId: "A1",
  category: "X",
  color: "red",
  price: 10,
  tenantId: "demo-tenant",
  ownerScopeId: "demo-scope",
};

describe("MockRecommendationAdapter", () => {
  it("derives known intent fields and confidence only from resolved signals", async () => {
    const adapter = new MockRecommendationAdapter();
    const intent = await adapter.extractIntent({
      ...baseInput,
      rawText: "category Y, blue, 999",
      signals: [
        { field: "category", value: "X", source: "user_text", confidence: 0.8, mode: "hard" },
        { field: "color", value: "red", source: "selection", confidence: 0.7, mode: "soft" },
        { field: "price", value: "10", source: "vision", confidence: 0.6, mode: "soft" },
        { field: "style", value: "ignored", source: "user_text", confidence: 1, mode: "hard" },
      ],
    });

    expect(intent).toEqual({
      category: "X",
      color: "red",
      price: "10",
      confidence: 0.8,
    });
  });

  it("defaults empty signals to zero confidence", async () => {
    const adapter = new MockRecommendationAdapter();
    await expect(adapter.extractIntent(baseInput)).resolves.toEqual({
      confidence: 0,
    });
  });

  it("builds a mock-domain retrieval policy with an optional category filter", () => {
    const adapter = new MockRecommendationAdapter({ candidateLimit: 3 });
    expect(adapter.buildRetrievalPolicy({ category: "X", confidence: 1 })).toEqual({
      domain: MOCK_RECOMMENDATION_DOMAIN,
      candidateLimit: 3,
      filters: { category: "X" },
    });
    expect(adapter.buildRetrievalPolicy({ confidence: 0 })).toEqual({
      domain: MOCK_RECOMMENDATION_DOMAIN,
      candidateLimit: 3,
    });
  });

  it("maps candidate fields without assigning constraint semantics", () => {
    const adapter = new MockRecommendationAdapter();
    expect(adapter.toCandidateFields(product)).toEqual({
      category: "X",
      color: "red",
      price: "10",
    });
  });

  it("builds a deterministic card whose candidateRef preserves scope", () => {
    const adapter = new MockRecommendationAdapter({
      now: () => new Date("2026-09-01T00:00:00.000Z"),
    });
    expect(adapter.buildCard(product)).toEqual({
      cardId: "mock-A1",
      domain: MOCK_RECOMMENDATION_DOMAIN,
      candidateRef: {
        resourceType: "mock_product",
        resourceId: "A1",
        tenantId: "demo-tenant",
        ownerScopeId: "demo-scope",
      },
      payload: {
        title: "Mock product A1",
        category: "X",
        color: "red",
        price: 10,
      },
      createdAt: "2026-09-01T00:00:00.000Z",
    });
  });
});
