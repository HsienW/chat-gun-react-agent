import { createHash } from "node:crypto";

import {
  resourceOwnerMatches,
  resourceTenantMatches,
  type ResourceRef,
} from "../runtime/authorization/index.js";
import {
  createDecisionRecord,
  createEvidenceRef,
  type DecisionRecordStore,
  type EvidenceRole,
  type EvidenceStore,
} from "../runtime/provenance/index.js";
import type { ClarificationRequest } from "./clarification.js";
import {
  RECOMMENDATION_REASON_CODES,
  type CandidateDecision,
  type RecommendationInput,
} from "./types.js";
import { validateRecommendationInput } from "./types.js";

const DECISION_TYPES = {
  routing: "domain_routing",
  clarification: "clarification",
  candidate: "candidate_decision",
} as const;

export interface ProvenanceWriterOptions {
  decisionRecordStore: DecisionRecordStore;
  evidenceStore: EvidenceStore;
  policyVersion: string;
  now?: () => Date;
}

interface EvidenceResource {
  resource: ResourceRef;
  role: EvidenceRole;
  resourceVersion?: string;
  snapshotHash?: string;
}

interface DecisionDescription {
  decisionType: string;
  outcome: string;
  reasonCode: string;
  subject: string;
}

function requireNonEmpty(value: string, fieldName: string): string {
  if (value.trim().length === 0) {
    throw new Error(`${fieldName} is required`);
  }
  return value;
}

function digest(...parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex");
}

function createInputResource(input: RecommendationInput): ResourceRef {
  const resourceId =
    input.requestId ??
    input.taskId ??
    input.runId ??
    input.threadId ??
    input.stepId;
  if (!resourceId) {
    throw new Error("recommendation input requires a correlation identifier");
  }
  return {
    resourceType: "recommendation_input",
    resourceId,
    tenantId: input.scope.tenantId,
    ownerScopeId: input.scope.scopeId,
  };
}

export class ProvenanceWriter {
  private readonly decisionRecordStore: DecisionRecordStore;
  private readonly evidenceStore: EvidenceStore;
  private readonly policyVersion: string;
  private readonly now: () => Date;

  constructor(options: ProvenanceWriterOptions) {
    this.decisionRecordStore = options.decisionRecordStore;
    this.evidenceStore = options.evidenceStore;
    this.policyVersion = requireNonEmpty(
      options.policyVersion,
      "policyVersion"
    );
    this.now = options.now ?? (() => new Date());
  }

  async writeRouting(input: RecommendationInput, domain: string): Promise<void> {
    const safeDomain = requireNonEmpty(domain, "domain");
    await this.recordDecision(
      input,
      {
        decisionType: DECISION_TYPES.routing,
        outcome: safeDomain,
        reasonCode: RECOMMENDATION_REASON_CODES.domainRouted,
        subject: safeDomain,
      },
      []
    );
  }

  async writeClarification(
    input: RecommendationInput,
    clarification: ClarificationRequest
  ): Promise<void> {
    await this.recordDecision(
      input,
      {
        decisionType: DECISION_TYPES.clarification,
        outcome: "waiting_confirmation",
        reasonCode: clarification.reasonCode,
        subject: clarification.clarificationId,
      },
      []
    );
  }

  async writeCandidateDecision(
    input: RecommendationInput,
    decision: CandidateDecision,
    candidateRef: ResourceRef
  ): Promise<void> {
    const safeInput = validateRecommendationInput(input);
    if (!resourceTenantMatches(candidateRef, safeInput.scope.tenantId)) {
      throw new Error("candidateRef tenantId must match recommendation scope");
    }
    if (!resourceOwnerMatches(candidateRef, safeInput.scope.scopeId)) {
      throw new Error("candidateRef ownerScopeId must match recommendation scope");
    }

    await this.recordDecision(
      safeInput,
      {
        decisionType: DECISION_TYPES.candidate,
        outcome: decision.eligible ? "eligible" : "excluded",
        reasonCode:
          decision.reasonCode ?? RECOMMENDATION_REASON_CODES.unknown,
        subject: `${candidateRef.resourceType}:${candidateRef.resourceId}`,
      },
      [
        {
          resource: candidateRef,
          role: decision.eligible ? "supporting" : "contradicting",
        },
      ]
    );
  }

  async writeEmptyCandidates(
    input: RecommendationInput,
    domain: string
  ): Promise<void> {
    const safeDomain = requireNonEmpty(domain, "domain");
    await this.recordDecision(
      input,
      {
        decisionType: DECISION_TYPES.candidate,
        outcome: "empty_candidates",
        reasonCode: RECOMMENDATION_REASON_CODES.emptyCandidates,
        subject: `${safeDomain}:empty`,
      },
      []
    );
  }

  private async recordDecision(
    input: RecommendationInput,
    description: DecisionDescription,
    subjectEvidence: readonly EvidenceResource[]
  ): Promise<void> {
    const safeInput = validateRecommendationInput(input);
    const inputResource = createInputResource(safeInput);
    const policyResource: ResourceRef = {
      resourceType: "recommendation_policy",
      resourceId: this.policyVersion,
      tenantId: safeInput.scope.tenantId,
      ownerScopeId: safeInput.scope.scopeId,
    };
    const correlationId =
      safeInput.runId ??
      safeInput.requestId ??
      safeInput.taskId ??
      safeInput.threadId ??
      inputResource.resourceId;
    const decisionId = `recommendation-decision-${digest(
      correlationId,
      description.decisionType,
      description.subject
    )}`;
    const timestamp = this.now().toISOString();
    const record = createDecisionRecord({
      decisionId,
      ...(safeInput.requestId === undefined
        ? {}
        : { requestId: safeInput.requestId }),
      ...(safeInput.threadId === undefined
        ? {}
        : { threadId: safeInput.threadId }),
      ...(safeInput.runId === undefined ? {} : { runId: safeInput.runId }),
      ...(safeInput.taskId === undefined ? {} : { taskId: safeInput.taskId }),
      ...(safeInput.stepId === undefined ? {} : { stepId: safeInput.stepId }),
      decisionType: description.decisionType,
      outcome: description.outcome,
      reasonCode: description.reasonCode,
      policyVersion: this.policyVersion,
      createdAt: timestamp,
    });

    await this.decisionRecordStore.record(record);

    const inputSnapshotHash =
      safeInput.rawText === undefined
        ? undefined
        : `sha256:${digest(safeInput.rawText)}`;
    const evidenceResources: readonly EvidenceResource[] = [
      {
        resource: inputResource,
        role: "input",
        ...(inputSnapshotHash === undefined
          ? {}
          : { snapshotHash: inputSnapshotHash }),
      },
      ...subjectEvidence,
      {
        resource: policyResource,
        role: "policy",
        resourceVersion: this.policyVersion,
      },
    ];

    await Promise.all(
      evidenceResources.map((evidenceResource) =>
        this.evidenceStore.record(
          createEvidenceRef({
            evidenceRefId: `recommendation-evidence-${digest(
              decisionId,
              evidenceResource.role,
              evidenceResource.resource.resourceType,
              evidenceResource.resource.resourceId
            )}`,
            decisionId,
            resource: evidenceResource.resource,
            role: evidenceResource.role,
            observedAt: timestamp,
            ...(evidenceResource.resourceVersion === undefined
              ? {}
              : { resourceVersion: evidenceResource.resourceVersion }),
            ...(evidenceResource.snapshotHash === undefined
              ? {}
              : { snapshotHash: evidenceResource.snapshotHash }),
          })
        )
      )
    );
  }
}
