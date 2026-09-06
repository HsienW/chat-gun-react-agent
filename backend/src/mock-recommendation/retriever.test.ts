import { describe, expect, it } from "vitest";

import { MOCK_RECOMMENDATION_DOMAIN } from "./adapter.js";
import { MOCK_CATALOG } from "./catalog.js";
import { MockCandidateRetriever } from "./retriever.js";

describe("MockCandidateRetriever", () => {
  const retriever = new MockCandidateRetriever(MOCK_CATALOG);

  it("returns at most candidateLimit products without a filter", async () => {
    const products = await retriever.retrieve({
      domain: MOCK_RECOMMENDATION_DOMAIN,
      candidateLimit: 2,
    });
    expect(products).toEqual(MOCK_CATALOG.slice(0, 2));
  });

  it("filters by category before applying candidateLimit", async () => {
    const products = await retriever.retrieve({
      domain: MOCK_RECOMMENDATION_DOMAIN,
      candidateLimit: 2,
      filters: { category: "Y" },
    });
    expect(products).toHaveLength(2);
    expect(products.every((product) => product.category === "Y")).toBe(true);
  });

  it("returns an empty result when the category has no match", async () => {
    await expect(
      retriever.retrieve({
        domain: MOCK_RECOMMENDATION_DOMAIN,
        candidateLimit: 10,
        filters: { category: "missing" },
      })
    ).resolves.toEqual([]);
  });
});
