import { describe, expect, it } from "vitest";

import type {
  DecisionRecord,
  DecisionRecordStore,
  EvidenceRef,
  EvidenceStore,
} from "../runtime/provenance/index.js";
import type { RecommendationCard } from "./card.js";
import type { ClarificationRequest } from "./clarification.js";
import { ProvenanceWriter } from "./provenance-integration.js";
import type { RecommendationInput } from "./types.js";

class InMemoryDecisionRecordStore implements DecisionRecordStore {
  readonly records: DecisionRecord[] = [];

  async record(record: DecisionRecord): Promise<DecisionRecord> {
    this.records.push(record);
    return record;
  }

  async findByDecisionId(decisionId: string): Promise<DecisionRecord | null> {
    return this.records.find((record) => record.decisionId === decisionId) ?? null;
  }

  async findByTaskId(taskId: string): Promise<DecisionRecord[]> {
    return this.records.filter((record) => record.taskId === taskId);
  }

  async findByStepId(stepId: string): Promise<DecisionRecord[]> {
    return this.records.filter((record) => record.stepId === stepId);
  }
}

class InMemoryEvidenceStore implements EvidenceStore {
  readonly evidence: EvidenceRef[] = [];

  async record(evidence: EvidenceRef): Promise<EvidenceRef> {
    this.evidence.push(evidence);
    return evidence;
  }

  async findByDecisionId(decisionId: string): Promise<EvidenceRef[]> {
    return this.evidence.filter((entry) => entry.decisionId === decisionId);
  }

  async findByResource(resource: EvidenceRef["resource"]): Promise<EvidenceRef[]> {
    return this.evidence.filter(
      (entry) =>
        entry.resource.resourceType === resource.resourceType &&
        entry.resource.resourceId === resource.resourceId &&
        entry.resource.tenantId === resource.tenantId
    );
  }
}

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
  signals: [],
  rawText: "sensitive input is hashed, not persisted",
};

function createWriter() {
  const decisionRecordStore = new InMemoryDecisionRecordStore();
  const evidenceStore = new InMemoryEvidenceStore();
  const writer = new ProvenanceWriter({
    decisionRecordStore,
    evidenceStore,
    policyVersion: "recommendation-policy-v1",
    now: () => new Date("2026-08-30T00:00:00.000Z"),
  });
  return { writer, decisionRecordStore, evidenceStore };
}

describe("ProvenanceWriter", () => {
  it("records routing through X8.9 stores with input and policy evidence", async () => {
    const { writer, decisionRecordStore, evidenceStore } = createWriter();

    await writer.writeRouting(input, "mock-domain");

    expect(decisionRecordStore.records).toHaveLength(1);
    expect(decisionRecordStore.records[0]).toMatchObject({
      decisionType: "domain_routing",
      outcome: "mock-domain",
      reasonCode: "DOMAIN_ROUTED",
      policyVersion: "recommendation-policy-v1",
    });
    expect(evidenceStore.evidence.map((entry) => entry.role)).toEqual([
      "input",
      "policy",
    ]);
    expect(evidenceStore.evidence[0]).not.toHaveProperty("rawPayload");
  });

  it("records excluded candidate evidence as contradicting references", async () => {
    const { writer, decisionRecordStore, evidenceStore } = createWriter();
    const card: RecommendationCard = {
      cardId: "card-1",
      domain: "mock-domain",
      candidateRef: {
        resourceType: "product",
        resourceId: "product-1",
        tenantId: "tenant-1",
        ownerScopeId: "scope-1",
      },
      payload: {},
      createdAt: "2026-08-30T00:00:00.000Z",
    };

    await writer.writeCandidateDecision(
      input,
      { eligible: false, reasonCode: "HARD_CONSTRAINT_VIOLATION" },
      card.candidateRef
    );

    expect(decisionRecordStore.records[0]).toMatchObject({
      decisionType: "candidate_decision",
      outcome: "excluded",
      reasonCode: "HARD_CONSTRAINT_VIOLATION",
    });
    expect(evidenceStore.evidence.map((entry) => entry.role)).toEqual([
      "input",
      "contradicting",
      "policy",
    ]);
  });

  it("records clarification without creating a parallel HITL store", async () => {
    const { writer, decisionRecordStore } = createWriter();
    const clarification: ClarificationRequest = {
      clarificationId: "clarification-1",
      taskId: "task-1",
      reasonCode: "LOW_CONFIDENCE_CLARIFICATION",
      question: "Injected question",
      requestedAt: "2026-08-30T00:00:00.000Z",
      confirmationType: "clarification",
      taskStatus: "waiting_confirmation",
    };

    await writer.writeClarification(input, clarification);

    expect(decisionRecordStore.records[0]).toMatchObject({
      decisionType: "clarification",
      outcome: "waiting_confirmation",
      reasonCode: "LOW_CONFIDENCE_CLARIFICATION",
    });
  });

  it("rejects cross-tenant candidate evidence", async () => {
    const { writer } = createWriter();

    await expect(
      writer.writeCandidateDecision(
        input,
        { eligible: true },
        {
          resourceType: "product",
          resourceId: "product-1",
          tenantId: "tenant-2",
        }
      )
    ).rejects.toThrow("candidateRef tenantId must match recommendation scope");
  });

  it("records empty candidates as a major decision", async () => {
    const { writer, decisionRecordStore } = createWriter();

    await writer.writeEmptyCandidates(input, "mock-domain");

    expect(decisionRecordStore.records[0]).toMatchObject({
      decisionType: "candidate_decision",
      outcome: "empty_candidates",
      reasonCode: "EMPTY_CANDIDATES",
    });
  });
});
