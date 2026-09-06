import { describe, expect, it } from "vitest";

import {
  BusinessPolicyGate,
  ClarificationFlow,
  ConstraintEngine,
  DomainRouter,
  RecommendationEngine,
  createRecommendationCard,
  type CandidateDecision,
  type RecommendationCard,
  type RecommendationDomainAdapter,
  type RecommendationEngineProvenanceWriter,
  type RecommendationInput,
} from "../recommendation/index.js";
import { MockRecommendationAdapter } from "./adapter.js";
import {
  MOCK_CATALOG,
  MOCK_CATALOG_OWNER_SCOPE_ID,
  MOCK_CATALOG_TENANT_ID,
} from "./catalog.js";
import { createMockRecommendationEngine } from "./compose.js";

function createInput(
  signals: RecommendationInput["signals"]
): RecommendationInput {
  return {
    requestId: "request-1",
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
    signals,
  };
}

class CapturingProvenanceWriter
  implements RecommendationEngineProvenanceWriter
{
  readonly routedDomains: string[] = [];
  readonly decisions: CandidateDecision[] = [];
  clarificationCount = 0;
  emptyCandidateCount = 0;

  async writeRouting(_input: RecommendationInput, domain: string) {
    this.routedDomains.push(domain);
  }

  async writeClarification() {
    this.clarificationCount += 1;
  }

  async writeCandidateDecision(
    _input: RecommendationInput,
    decision: CandidateDecision
  ) {
    this.decisions.push(decision);
  }

  async writeEmptyCandidates() {
    this.emptyCandidateCount += 1;
  }
}

const hardCategoryX = {
  field: "category",
  value: "X",
  source: "user_text",
  confidence: 1,
  mode: "hard",
} as const;

function createFrameworkEngine<
  TIntent extends { confidence: number },
  TProduct,
  TCard extends RecommendationCard<unknown>,
>(
  adapter: RecommendationDomainAdapter<TIntent, TProduct, TCard>,
  candidates: readonly TProduct[]
): RecommendationEngine<TIntent, TProduct, TCard> {
  const router = new DomainRouter<TIntent, TProduct, TCard>();
  router.registerAdapter(adapter);
  return new RecommendationEngine({
    router,
    retriever: { async retrieve() { return [...candidates]; } },
    constraintEngine: new ConstraintEngine(),
    businessPolicyGate: new BusinessPolicyGate(),
    clarificationFlow: new ClarificationFlow({
      confidenceThreshold: 0.7,
      buildQuestion: async () => "Clarify test constraints",
    }),
    provenanceWriter: new CapturingProvenanceWriter(),
    getIntentConfidence: (intent) => intent.confidence,
  });
}

describe("mock recommendation integration", () => {
  it("excludes A3 with a hard-constraint violation instead of a score penalty", () => {
    const adapter = new MockRecommendationAdapter();
    const constraintEngine = new ConstraintEngine();
    const resolution = constraintEngine.resolve([hardCategoryX]);
    const a3 = MOCK_CATALOG.find((product) => product.productId === "A3");
    expect(a3).toBeDefined();

    const evaluated = constraintEngine.evaluateCandidate(
      resolution,
      adapter.toCandidateFields(a3!)
    );
    const decision = new BusinessPolicyGate().apply(evaluated, {
      conflicts: resolution.conflicts,
    });

    expect(decision).toEqual({
      eligible: false,
      reason: "Candidate violates a hard constraint",
      reasonCode: "HARD_CONSTRAINT_VIOLATION",
    });
    expect(decision).not.toHaveProperty("adjustedScore");
  });

  it("routes through the full engine and builds cards only for A1 and A2", async () => {
    const provenanceWriter = new CapturingProvenanceWriter();
    const engine = createMockRecommendationEngine({
      catalog: MOCK_CATALOG.slice(0, 3),
      candidateLimit: 3,
      provenanceWriter,
      now: () => new Date("2026-09-01T00:00:00.000Z"),
    });

    const result = await engine.recommend(createInput([hardCategoryX]));

    expect(result.domain).toBe("mock");
    expect(result.candidates).toEqual([
      expect.objectContaining({ eligible: true, reasonCode: "ELIGIBLE" }),
      expect.objectContaining({ eligible: true, reasonCode: "ELIGIBLE" }),
    ]);
    expect(result.cards.map((card) => card.cardId)).toEqual([
      "mock-A1",
      "mock-A2",
    ]);
    expect(provenanceWriter.routedDomains).toEqual(["mock"]);
    expect(provenanceWriter.decisions).toHaveLength(2);
  });

  it("keeps a soft color mismatch eligible with an adjusted score", async () => {
    const engine = createMockRecommendationEngine({
      catalog: MOCK_CATALOG.slice(0, 2),
      candidateLimit: 2,
    });
    const input = createInput([
      hardCategoryX,
      {
        field: "color",
        value: "red",
        source: "user_text",
        confidence: 1,
        mode: "soft",
      },
    ]);

    const result = await engine.recommend(input);

    expect(result.candidates[0]).toEqual({
      eligible: true,
      reasonCode: "ELIGIBLE",
    });
    expect(result.candidates[1]).toEqual({
      eligible: true,
      reason: "Candidate violates one or more soft constraints",
      reasonCode: "SOFT_CONSTRAINT_ADJUSTED",
      adjustedScore: 0.9,
    });
    expect(result.cards).toHaveLength(2);
  });

  it("fails closed and requests clarification for an unresolved hard conflict", async () => {
    const provenanceWriter = new CapturingProvenanceWriter();
    const engine = createMockRecommendationEngine({
      catalog: MOCK_CATALOG.slice(0, 3),
      candidateLimit: 3,
      provenanceWriter,
    });
    const input = createInput([
      hardCategoryX,
      { ...hardCategoryX, value: "Y" },
    ]);

    const result = await engine.recommend(input);

    expect(result.candidates).toHaveLength(3);
    expect(
      result.candidates.every(
        (decision) =>
          !decision.eligible &&
          decision.reasonCode === "HARD_CONSTRAINT_CONFLICT"
      )
    ).toBe(true);
    expect(result.cards).toEqual([]);
    expect(result.clarificationRequested).toBe(true);
    expect(provenanceWriter.clarificationCount).toBe(1);
  });

  it("rejects a candidateRef whose tenant does not match the input scope", async () => {
    const a1 = MOCK_CATALOG[0]!;
    const engine = createMockRecommendationEngine({
      catalog: [{ ...a1, tenantId: "other-tenant" }],
      candidateLimit: 1,
    });

    await expect(engine.recommend(createInput([hardCategoryX]))).rejects.toThrow(
      "candidateRef tenantId must match recommendation scope"
    );
  });

  it("preserves hard and soft semantics when a second adapter replaces color with size", async () => {
    const mockEngine = createFrameworkEngine(
      new MockRecommendationAdapter({ candidateLimit: 3 }),
      MOCK_CATALOG.slice(0, 3)
    );
    const mockResult = await mockEngine.recommend(
      createInput([
        hardCategoryX,
        { field: "color", value: "red", source: "user_text", confidence: 1, mode: "soft" },
      ])
    );

    interface MockV2Intent {
      category?: string;
      size?: string;
      confidence: number;
    }
    interface MockV2Product {
      productId: string;
      category: string;
      size: string;
    }
    type MockV2Card = RecommendationCard<{ title: string; size: string }>;

    const mockV2Adapter: RecommendationDomainAdapter<
      MockV2Intent,
      MockV2Product,
      MockV2Card
    > = {
      domain: "mock-v2",
      async extractIntent(input) {
        const resolved = new ConstraintEngine().resolve(input.signals).resolved;
        const category = resolved.find(({ field }) => field === "category")?.value;
        const size = resolved.find(({ field }) => field === "size")?.value;
        return {
          ...(category === undefined ? {} : { category }),
          ...(size === undefined ? {} : { size }),
          confidence: resolved.reduce(
            (highest, constraint) => Math.max(highest, constraint.confidence),
            0
          ),
        };
      },
      buildRetrievalPolicy() {
        return { domain: "mock-v2", candidateLimit: 3 };
      },
      toCandidateFields(candidate) {
        return { category: candidate.category, size: candidate.size };
      },
      buildCard(candidate) {
        return createRecommendationCard({
          cardId: `mock-v2-${candidate.productId}`,
          domain: "mock-v2",
          candidateRef: {
            resourceType: "mock_v2_product",
            resourceId: candidate.productId,
            tenantId: MOCK_CATALOG_TENANT_ID,
            ownerScopeId: MOCK_CATALOG_OWNER_SCOPE_ID,
          },
          payload: { title: candidate.productId, size: candidate.size },
          createdAt: "2026-09-01T00:00:00.000Z",
        });
      },
    };
    const mockV2Engine = createFrameworkEngine(mockV2Adapter, [
      { productId: "B1", category: "X", size: "large" },
      { productId: "B2", category: "X", size: "small" },
      { productId: "B3", category: "Y", size: "large" },
    ]);
    const mockV2Result = await mockV2Engine.recommend(
      createInput([
        hardCategoryX,
        { field: "size", value: "large", source: "user_text", confidence: 1, mode: "soft" },
      ])
    );

    expect(mockV2Result.domain).toBe("mock-v2");
    expect(mockResult.candidates.map(({ reasonCode }) => reasonCode)).toEqual([
      "ELIGIBLE",
      "SOFT_CONSTRAINT_ADJUSTED",
      "HARD_CONSTRAINT_VIOLATION",
    ]);
    expect(mockV2Result.candidates.map(({ reasonCode }) => reasonCode)).toEqual(
      mockResult.candidates.map(({ reasonCode }) => reasonCode)
    );
  });
});
