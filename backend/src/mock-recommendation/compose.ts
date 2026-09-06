import {
  BusinessPolicyGate,
  ClarificationFlow,
  ConstraintEngine,
  DomainRouter,
  RecommendationEngine,
  type RecommendationCard,
  type RecommendationEngineProvenanceWriter,
} from "../recommendation/index.js";
import { MockRecommendationAdapter } from "./adapter.js";
import { MOCK_CATALOG } from "./catalog.js";
import { MockCandidateRetriever } from "./retriever.js";
import type { MockCardPayload, MockIntent, MockProduct } from "./types.js";

const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;
const DEFAULT_CLARIFICATION_QUESTION =
  "Please clarify the mock recommendation constraints.";

const NOOP_PROVENANCE_WRITER: RecommendationEngineProvenanceWriter = {
  async writeRouting() {},
  async writeClarification() {},
  async writeCandidateDecision() {},
  async writeEmptyCandidates() {},
};

export interface MockRecommendationEngineOptions {
  catalog?: readonly MockProduct[];
  candidateLimit?: number;
  confidenceThreshold?: number;
  provenanceWriter?: RecommendationEngineProvenanceWriter;
  now?: () => Date;
}

export function createMockRecommendationEngine(
  options: MockRecommendationEngineOptions = {}
): RecommendationEngine<
  MockIntent,
  MockProduct,
  RecommendationCard<MockCardPayload>
> {
  const adapter = new MockRecommendationAdapter({
    ...(options.candidateLimit === undefined
      ? {}
      : { candidateLimit: options.candidateLimit }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const router = new DomainRouter<
    MockIntent,
    MockProduct,
    RecommendationCard<MockCardPayload>
  >();
  router.registerAdapter(adapter);

  const clarificationFlow = new ClarificationFlow({
    confidenceThreshold:
      options.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD,
    buildQuestion: async () => DEFAULT_CLARIFICATION_QUESTION,
    ...(options.now === undefined ? {} : { now: options.now }),
  });

  return new RecommendationEngine({
    router,
    retriever: new MockCandidateRetriever(options.catalog ?? MOCK_CATALOG),
    constraintEngine: new ConstraintEngine(),
    businessPolicyGate: new BusinessPolicyGate(),
    clarificationFlow,
    provenanceWriter: options.provenanceWriter ?? NOOP_PROVENANCE_WRITER,
    getIntentConfidence: (intent) => intent.confidence,
  });
}
