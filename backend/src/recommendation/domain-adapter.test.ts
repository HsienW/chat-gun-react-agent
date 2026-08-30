import { describe, expect, expectTypeOf, it } from "vitest";

import type { RecommendationInput } from "./types.js";
import type {
  CandidateRetriever,
  RecommendationDomainAdapter,
} from "./domain-adapter.js";

interface MockIntent {
  query: string;
}

interface MockProduct {
  productId: string;
}

interface MockCard {
  title: string;
}

const adapter: RecommendationDomainAdapter<MockIntent, MockProduct, MockCard> = {
  domain: "mock-domain",
  async extractIntent(_input: RecommendationInput) {
    return { query: "structured-query" };
  },
  buildRetrievalPolicy(intent) {
    return {
      domain: "mock-domain",
      candidateLimit: 10,
      filters: { query: intent.query },
    };
  },
  toCandidateFields(candidate) {
    return { productId: candidate.productId };
  },
  buildCard(candidate) {
    return { title: candidate.productId };
  },
};

const retriever: CandidateRetriever<MockProduct> = {
  async retrieve(policy) {
    return [{ productId: `${policy.domain}-1` }];
  },
};

describe("RecommendationDomainAdapter", () => {
  it("preserves generic inference across the adapter boundary", async () => {
    const intent = await adapter.extractIntent({} as RecommendationInput);
    const candidates = await retriever.retrieve(
      adapter.buildRetrievalPolicy(intent)
    );
    const card = adapter.buildCard(candidates[0]!);

    expectTypeOf(intent).toEqualTypeOf<MockIntent>();
    expectTypeOf(candidates).toEqualTypeOf<MockProduct[]>();
    expectTypeOf(card).toEqualTypeOf<MockCard>();
    expect(card).toEqual({ title: "mock-domain-1" });
  });
});
