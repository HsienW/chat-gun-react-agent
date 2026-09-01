import type { RecommendationInput, RetrievalPolicy } from "./types.js";

export interface RecommendationDomainAdapter<
  TIntent = unknown,
  TProduct = unknown,
  TCard = unknown,
> {
  readonly domain: string;
  extractIntent(input: RecommendationInput): Promise<TIntent>;
  buildRetrievalPolicy(intent: TIntent): RetrievalPolicy;
  toCandidateFields(candidate: TProduct): Record<string, string>;
  buildCard(candidate: TProduct): TCard;
}

export interface CandidateRetriever<TProduct = unknown> {
  retrieve(policy: RetrievalPolicy): Promise<TProduct[]>;
}
