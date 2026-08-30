import { describe, expect, it } from "vitest";

import { createRecommendationCard } from "./card.js";

const candidateRef = {
  resourceType: "product",
  resourceId: "product-1",
  tenantId: "tenant-1",
  ownerScopeId: "scope-1",
};

describe("createRecommendationCard", () => {
  it("creates a business-neutral card envelope", () => {
    const card = createRecommendationCard({
      cardId: "card-1",
      domain: "mock-domain",
      candidateRef,
      payload: { title: "Candidate" },
      now: () => new Date("2026-08-30T00:00:00.000Z"),
    });

    expect(card).toEqual({
      cardId: "card-1",
      domain: "mock-domain",
      candidateRef,
      payload: { title: "Candidate" },
      createdAt: "2026-08-30T00:00:00.000Z",
    });
  });

  it("rejects an empty cardId", () => {
    expect(() =>
      createRecommendationCard({
        cardId: " ",
        domain: "mock-domain",
        candidateRef,
        payload: {},
      })
    ).toThrow("cardId is required");
  });

  it("rejects a candidateRef without tenant ownership", () => {
    expect(() =>
      createRecommendationCard({
        cardId: "card-1",
        domain: "mock-domain",
        candidateRef: { ...candidateRef, tenantId: "" },
        payload: {},
      })
    ).toThrow("candidateRef.tenantId is required");
  });
});
