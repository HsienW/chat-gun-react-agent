import { describe, expect, it } from "vitest";

import { BusinessPolicyGate } from "./business-policy-gate.js";
import type { RecommendationCard } from "./card.js";
import { ClarificationFlow } from "./clarification.js";
import { ConstraintEngine } from "./constraint-engine.js";
import type { RecommendationDomainAdapter } from "./domain-adapter.js";
import { DomainRouter } from "./domain-router.js";
import {
  RecommendationEngine,
  type RecommendationEngineProvenanceWriter,
} from "./recommendation-engine.js";
import type { CandidateDecision, RecommendationInput } from "./types.js";

interface MockIntent {
  confidence: number;
}

interface MockProduct {
  productId: string;
  category: string;
}

type MockCard = RecommendationCard<{ title: string }>;

const input: RecommendationInput = {
  requestId: "request-1",
  threadId: "thread-1",
  runId: "run-1",
  taskId: "task-1",
  stepId: "step-1",
  principal: {
    principalId: "principal-1",
    principalType: "user",
    tenantId: "tenant-1",
    roles: [],
    scopes: [],
    authSource: "trusted_gateway",
    authenticatedAt: "2026-08-30T00:00:00.000Z",
  },
  scope: {
    scopeId: "scope-1",
    scopeType: "conversation",
    tenantId: "tenant-1",
  },
  signals: [
    {
      field: "category",
      value: "allowed",
      source: "user_text",
      confidence: 1,
      mode: "hard",
    },
  ],
};

class TraceProvenanceWriter implements RecommendationEngineProvenanceWriter {
  readonly trace: string[];
  readonly decisions: CandidateDecision[] = [];
  clarificationCount = 0;
  emptyCandidateCount = 0;

  constructor(trace: string[]) {
    this.trace = trace;
  }

  async writeRouting(_input: RecommendationInput, domain: string): Promise<void> {
    this.trace.push(`routing:${domain}`);
  }

  async writeClarification(): Promise<void> {
    this.trace.push("clarification");
    this.clarificationCount += 1;
  }

  async writeCandidateDecision(
    _input: RecommendationInput,
    decision: CandidateDecision
  ): Promise<void> {
    this.trace.push("candidate-decision");
    this.decisions.push(decision);
  }

  async writeEmptyCandidates(): Promise<void> {
    this.trace.push("empty-candidates");
    this.emptyCandidateCount += 1;
  }
}

function createFixture(options: {
  confidence?: number;
  candidates?: MockProduct[];
  candidateLimit?: number;
  getClarificationAttempt?: () => number;
  policyDomain?: string;
} = {}) {
  const trace: string[] = [];
  const confidence = options.confidence ?? 0.9;
  const adapter: RecommendationDomainAdapter<MockIntent, MockProduct, MockCard> = {
    domain: "mock-domain",
    async extractIntent() {
      trace.push("intent");
      return { confidence };
    },
    buildRetrievalPolicy() {
      trace.push("policy");
      return {
        domain: options.policyDomain ?? "mock-domain",
        candidateLimit: options.candidateLimit ?? 10,
      };
    },
    toCandidateFields(candidate) {
      trace.push(`fields:${candidate.productId}`);
      return { category: candidate.category };
    },
    buildCard(candidate) {
      trace.push(`card:${candidate.productId}`);
      return {
        cardId: `card-${candidate.productId}`,
        domain: "mock-domain",
        candidateRef: {
          resourceType: "product",
          resourceId: candidate.productId,
          tenantId: "tenant-1",
          ownerScopeId: "scope-1",
        },
        payload: { title: candidate.productId },
        createdAt: "2026-08-30T00:00:00.000Z",
      };
    },
  };
  const router = new DomainRouter<MockIntent, MockProduct, MockCard>();
  router.registerAdapter(adapter);
  const retriever = {
    async retrieve() {
      trace.push("retrieve");
      return options.candidates ?? [
        { productId: "product-1", category: "allowed" },
      ];
    },
  };
  const provenanceWriter = new TraceProvenanceWriter(trace);
  const clarificationFlow = new ClarificationFlow({
    confidenceThreshold: 0.7,
    requiredHardConstraintFields: ["category"],
    buildQuestion: async () => "Injected clarification question",
    createClarificationId: () => "clarification-1",
    now: () => new Date("2026-08-30T00:00:00.000Z"),
  });
  const engine = new RecommendationEngine({
    router,
    retriever,
    constraintEngine: new ConstraintEngine(),
    businessPolicyGate: new BusinessPolicyGate(),
    clarificationFlow,
    provenanceWriter,
    getIntentConfidence: (intent) => intent.confidence,
    getClarificationAttempt: options.getClarificationAttempt,
    maxClarificationAttempts: 1,
  });
  return { engine, provenanceWriter, trace };
}

describe("RecommendationEngine", () => {
  it("orchestrates route through card and provenance", async () => {
    const { engine, provenanceWriter, trace } = createFixture();

    const result = await engine.recommend(input);

    expect(result).toEqual({
      domain: "mock-domain",
      candidates: [{ eligible: true, reasonCode: "ELIGIBLE" }],
      cards: [
        expect.objectContaining({
          cardId: "card-product-1",
          domain: "mock-domain",
        }),
      ],
      clarificationRequested: false,
    });
    expect(trace).toEqual([
      "routing:mock-domain",
      "intent",
      "policy",
      "retrieve",
      "fields:product-1",
      "card:product-1",
      "candidate-decision",
    ]);
    expect(provenanceWriter.decisions[0]?.eligible).toBe(true);
  });

  it("requests clarification for low-confidence intent", async () => {
    const { engine, provenanceWriter } = createFixture({ confidence: 0.2 });

    const result = await engine.recommend(input);

    expect(result.clarificationRequested).toBe(true);
    expect(provenanceWriter.clarificationCount).toBe(1);
  });

  it("records empty candidates and protects the clarification loop", async () => {
    const { engine, provenanceWriter } = createFixture({
      candidates: [],
      getClarificationAttempt: () => 1,
    });

    const result = await engine.recommend(input);

    expect(result).toEqual({
      domain: "mock-domain",
      candidates: [],
      cards: [],
      clarificationRequested: false,
    });
    expect(provenanceWriter.emptyCandidateCount).toBe(1);
    expect(provenanceWriter.clarificationCount).toBe(0);
  });

  it("fails closed when policy domain differs from the routed domain", async () => {
    const { engine } = createFixture({ policyDomain: "other-domain" });

    await expect(engine.recommend(input)).rejects.toThrow(
      "retrieval policy domain must match routed domain"
    );
  });

  it("fails closed when a retriever exceeds candidateLimit", async () => {
    const { engine } = createFixture({
      candidateLimit: 1,
      candidates: [
        { productId: "product-1", category: "allowed" },
        { productId: "product-2", category: "allowed" },
      ],
    });

    await expect(engine.recommend(input)).rejects.toThrow(
      "candidate retriever exceeded candidateLimit"
    );
  });
});
