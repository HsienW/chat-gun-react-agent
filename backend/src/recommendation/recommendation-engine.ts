import {
  resourceOwnerMatches,
  resourceTenantMatches,
  type ResourceRef,
} from "../runtime/authorization/index.js";
import type { BusinessPolicyGate } from "./business-policy-gate.js";
import {
  validateRecommendationCard,
  type RecommendationCard,
} from "./card.js";
import type {
  ClarificationFlow,
  ClarificationRequest,
} from "./clarification.js";
import type {
  ConstraintEngine,
  ResolvedConstraint,
} from "./constraint-engine.js";
import type { CandidateRetriever } from "./domain-adapter.js";
import type { DomainRouter } from "./domain-router.js";
import {
  RECOMMENDATION_REASON_CODES,
  type CandidateDecision,
  type RecommendationInput,
  type RecommendationResult,
} from "./types.js";
import {
  validateRecommendationInput,
  validateRetrievalPolicy,
} from "./types.js";

const DEFAULT_MAX_CLARIFICATION_ATTEMPTS = 1;

export interface RecommendationEngineProvenanceWriter {
  writeRouting(input: RecommendationInput, domain: string): Promise<void>;
  writeClarification(
    input: RecommendationInput,
    clarification: ClarificationRequest
  ): Promise<void>;
  writeCandidateDecision(
    input: RecommendationInput,
    decision: CandidateDecision,
    candidateRef: ResourceRef
  ): Promise<void>;
  writeEmptyCandidates(
    input: RecommendationInput,
    domain: string
  ): Promise<void>;
}

export interface RecommendationEngineOptions<
  TIntent,
  TProduct,
  TCard extends RecommendationCard<unknown>,
> {
  router: DomainRouter<TIntent, TProduct, TCard>;
  retriever: CandidateRetriever<TProduct>;
  constraintEngine: ConstraintEngine;
  businessPolicyGate: BusinessPolicyGate;
  clarificationFlow: Pick<ClarificationFlow, "shouldClarify" | "request">;
  provenanceWriter: RecommendationEngineProvenanceWriter;
  getIntentConfidence: (intent: TIntent) => number;
  getClarificationAttempt?: (input: RecommendationInput) => number;
  maxClarificationAttempts?: number;
  clarifyOnEmptyCandidates?: boolean;
}

function validateCandidateFields(
  value: unknown
): Readonly<Record<string, string>> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Object.entries(value).every(
      ([field, fieldValue]) =>
        field.trim().length > 0 && typeof fieldValue === "string"
    )
  ) {
    throw new Error("candidate fields must be a string record");
  }
  return Object.fromEntries(Object.entries(value));
}

function hasHardConflict(
  conflicts: ReturnType<ConstraintEngine["resolve"]>["conflicts"]
): boolean {
  return conflicts.some((conflict) =>
    conflict.constraints.some((constraint) => constraint.mode === "hard")
  );
}

function validateAttempt(value: number, fieldName: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative safe integer`);
  }
  return value;
}

export class RecommendationEngine<
  TIntent,
  TProduct,
  TCard extends RecommendationCard<unknown>,
> {
  private readonly router: DomainRouter<TIntent, TProduct, TCard>;
  private readonly retriever: CandidateRetriever<TProduct>;
  private readonly constraintEngine: ConstraintEngine;
  private readonly businessPolicyGate: BusinessPolicyGate;
  private readonly clarificationFlow: Pick<
    ClarificationFlow,
    "shouldClarify" | "request"
  >;
  private readonly provenanceWriter: RecommendationEngineProvenanceWriter;
  private readonly getIntentConfidence: (intent: TIntent) => number;
  private readonly getClarificationAttempt: (
    input: RecommendationInput
  ) => number;
  private readonly maxClarificationAttempts: number;
  private readonly clarifyOnEmptyCandidates: boolean;

  constructor(options: RecommendationEngineOptions<TIntent, TProduct, TCard>) {
    this.router = options.router;
    this.retriever = options.retriever;
    this.constraintEngine = options.constraintEngine;
    this.businessPolicyGate = options.businessPolicyGate;
    this.clarificationFlow = options.clarificationFlow;
    this.provenanceWriter = options.provenanceWriter;
    this.getIntentConfidence = options.getIntentConfidence;
    this.getClarificationAttempt =
      options.getClarificationAttempt ?? (() => 0);
    this.maxClarificationAttempts = validateAttempt(
      options.maxClarificationAttempts ?? DEFAULT_MAX_CLARIFICATION_ATTEMPTS,
      "maxClarificationAttempts"
    );
    this.clarifyOnEmptyCandidates = options.clarifyOnEmptyCandidates ?? true;
  }

  async recommend(
    input: RecommendationInput
  ): Promise<RecommendationResult<RecommendationCard<unknown>>> {
    const safeInput = validateRecommendationInput(input);
    const domain = await this.router.route(safeInput);
    const adapter = this.router.getAdapter(domain);
    await this.provenanceWriter.writeRouting(safeInput, domain);

    const intent = await adapter.extractIntent(safeInput);
    const intentConfidence = this.getIntentConfidence(intent);
    const policy = validateRetrievalPolicy(
      adapter.buildRetrievalPolicy(intent)
    );
    if (policy.domain !== domain) {
      throw new Error("retrieval policy domain must match routed domain");
    }

    const retrievedCandidates = await this.retriever.retrieve(policy);
    if (!Array.isArray(retrievedCandidates)) {
      throw new Error("candidate retriever must return an array");
    }
    if (retrievedCandidates.length > policy.candidateLimit) {
      throw new Error("candidate retriever exceeded candidateLimit");
    }
    const resolution = this.constraintEngine.resolve(safeInput.signals);

    if (retrievedCandidates.length === 0) {
      await this.provenanceWriter.writeEmptyCandidates(safeInput, domain);
    }

    const evaluatedCandidates = await Promise.all(
      retrievedCandidates.map(async (candidate) => {
        const candidateFields = validateCandidateFields(
          adapter.toCandidateFields(candidate)
        );
        const evaluatedDecision = this.constraintEngine.evaluateCandidate(
          resolution,
          candidateFields
        );
        const decision = this.businessPolicyGate.apply(evaluatedDecision, {
          conflicts: resolution.conflicts,
        });
        const card = validateRecommendationCard(adapter.buildCard(candidate));
        if (card.domain !== domain) {
          throw new Error("recommendation card domain must match routed domain");
        }
        if (!resourceTenantMatches(card.candidateRef, safeInput.scope.tenantId)) {
          throw new Error("candidateRef tenantId must match recommendation scope");
        }
        if (!resourceOwnerMatches(card.candidateRef, safeInput.scope.scopeId)) {
          throw new Error("candidateRef ownerScopeId must match recommendation scope");
        }
        await this.provenanceWriter.writeCandidateDecision(
          safeInput,
          decision,
          card.candidateRef
        );
        return { decision, card };
      })
    );

    const shouldClarifyIntent = this.clarificationFlow.shouldClarify(
      intentConfidence,
      resolution.resolved
    );
    const hasUnresolvedHardConflict = hasHardConflict(resolution.conflicts);
    const shouldClarifyEmpty =
      retrievedCandidates.length === 0 && this.clarifyOnEmptyCandidates;
    const clarificationAttempt = validateAttempt(
      this.getClarificationAttempt(safeInput),
      "clarificationAttempt"
    );
    const canClarify = clarificationAttempt < this.maxClarificationAttempts;
    const shouldRequestClarification =
      canClarify &&
      (shouldClarifyIntent || hasUnresolvedHardConflict || shouldClarifyEmpty);

    if (shouldRequestClarification) {
      const reasonCode = hasUnresolvedHardConflict
        ? RECOMMENDATION_REASON_CODES.hardConstraintConflict
        : shouldClarifyIntent
          ? RECOMMENDATION_REASON_CODES.lowConfidenceClarification
          : RECOMMENDATION_REASON_CODES.emptyCandidates;
      const clarification = await this.clarificationFlow.request(
        safeInput,
        reasonCode
      );
      await this.provenanceWriter.writeClarification(
        safeInput,
        clarification
      );
    }

    return {
      domain,
      candidates: evaluatedCandidates.map(({ decision }) => decision),
      cards: evaluatedCandidates
        .filter(({ decision }) => decision.eligible)
        .map(({ card }) => card),
      clarificationRequested: shouldRequestClarification,
    };
  }
}
