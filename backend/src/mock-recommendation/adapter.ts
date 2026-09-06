import {
  ConstraintEngine,
  createRecommendationCard,
  validateRetrievalPolicy,
  type RecommendationCard,
  type RecommendationDomainAdapter,
  type RecommendationInput,
  type RetrievalPolicy,
} from "../recommendation/index.js";
import {
  validateMockCardPayload,
  validateMockIntent,
  validateMockProduct,
  type MockCardPayload,
  type MockIntent,
  type MockProduct,
} from "./types.js";

export const MOCK_RECOMMENDATION_DOMAIN = "mock";

const DEFAULT_CANDIDATE_LIMIT = 10;
const MOCK_PRODUCT_RESOURCE_TYPE = "mock_product";

export interface MockRecommendationAdapterOptions {
  candidateLimit?: number;
  now?: () => Date;
}

export class MockRecommendationAdapter
  implements
    RecommendationDomainAdapter<
      MockIntent,
      MockProduct,
      RecommendationCard<MockCardPayload>
    >
{
  readonly domain = MOCK_RECOMMENDATION_DOMAIN;
  private readonly candidateLimit: number;
  private readonly now?: () => Date;

  constructor(options: MockRecommendationAdapterOptions = {}) {
    this.candidateLimit = validateRetrievalPolicy({
      domain: MOCK_RECOMMENDATION_DOMAIN,
      candidateLimit: options.candidateLimit ?? DEFAULT_CANDIDATE_LIMIT,
    }).candidateLimit;
    this.now = options.now;
  }

  async extractIntent(input: RecommendationInput): Promise<MockIntent> {
    const knownConstraints = new ConstraintEngine()
      .resolve(input.signals)
      .resolved.filter(({ field }) =>
        field === "category" || field === "color" || field === "price"
      );

    const fields = Object.fromEntries(
      knownConstraints.map(({ field, value }) => [field, value])
    );
    const confidence = knownConstraints.reduce(
      (highest, constraint) => Math.max(highest, constraint.confidence),
      0
    );
    return validateMockIntent({ ...fields, confidence });
  }

  buildRetrievalPolicy(intent: MockIntent): RetrievalPolicy {
    const safeIntent = validateMockIntent(intent);
    return {
      domain: MOCK_RECOMMENDATION_DOMAIN,
      candidateLimit: this.candidateLimit,
      ...(safeIntent.category === undefined
        ? {}
        : { filters: { category: safeIntent.category } }),
    };
  }

  toCandidateFields(candidate: MockProduct): Record<string, string> {
    const safeCandidate = validateMockProduct(candidate);
    return {
      category: safeCandidate.category,
      color: safeCandidate.color,
      price: String(safeCandidate.price),
    };
  }

  buildCard(candidate: MockProduct): RecommendationCard<MockCardPayload> {
    const safeCandidate = validateMockProduct(candidate);
    const payload = validateMockCardPayload({
      title: `Mock product ${safeCandidate.productId}`,
      category: safeCandidate.category,
      color: safeCandidate.color,
      price: safeCandidate.price,
    });
    return createRecommendationCard({
      cardId: `mock-${safeCandidate.productId}`,
      domain: MOCK_RECOMMENDATION_DOMAIN,
      candidateRef: {
        resourceType: MOCK_PRODUCT_RESOURCE_TYPE,
        resourceId: safeCandidate.productId,
        tenantId: safeCandidate.tenantId,
        ownerScopeId: safeCandidate.ownerScopeId,
      },
      payload,
      ...(this.now === undefined ? {} : { now: this.now }),
    });
  }
}
