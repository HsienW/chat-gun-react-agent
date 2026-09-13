import { describe, expect, it, vi } from "vitest";

import type { LongTermMemoryRecord, MemoryCandidate } from "../types.js";
import {
  classifyMemoryRelation,
  resolveMemoryPrecedence,
} from "./relation-classifier.js";

const namespace = {
  tenantId: "tenant-a",
  principalId: "principal-a",
  scopeId: "scope-a",
};

function existing(value: unknown = "compact"): LongTermMemoryRecord {
  return {
    memoryId: "memory-1",
    namespace,
    memoryType: "preference",
    value,
    provenance: { source: "user_feedback" },
    confidence: 0.9,
    revision: "r1",
    recordedAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function candidate(value: unknown = "compact"): MemoryCandidate {
  return {
    namespace,
    memoryType: "preference",
    value,
    provenance: { source: "user_explicit" },
    confidence: 1,
    idempotencyKey: "candidate-1",
  };
}

describe("memory relation and precedence", () => {
  it("classifies same, supersedes, conflicts, and coexists", () => {
    expect(classifyMemoryRelation(existing(), candidate())).toBe("same");
    expect(classifyMemoryRelation(existing(), candidate("detailed"))).toBe(
      "supersedes"
    );
    expect(
      classifyMemoryRelation(
        existing(),
        candidate("detailed"),
        { currentAuthoritativeValue: "compact" }
      )
    ).toBe("conflicts");
    expect(
      classifyMemoryRelation(existing(), {
        ...candidate(),
        memoryType: "task_summary",
      })
    ).toBe("coexists");
  });

  it("keeps current explicit and authoritative state above memory", () => {
    expect(
      resolveMemoryPrecedence({
        memory: existing("compact"),
        currentTurnExplicit: "detailed",
      })
    ).toMatchObject({
      value: "detailed",
      source: "current_turn_explicit",
      memoryRelation: "supersedes",
    });
    expect(
      resolveMemoryPrecedence({
        memory: existing("compact"),
        currentAuthoritativeState: "canonical",
      })
    ).toMatchObject({
      value: "canonical",
      source: "current_authoritative_state",
      memoryRelation: "supersedes",
    });
  });

  it("never promotes low-confidence inferred memory to a hard constraint", () => {
    expect(
      resolveMemoryPrecedence({
        memory: {
          ...existing(),
          provenance: { source: "model_inferred" },
          confidence: 0.4,
        },
        lowConfidenceThreshold: 0.8,
      })
    ).toMatchObject({ hardConstraint: false, source: "long_term_memory" });
  });

  it("records supersession provenance when a recorder is provided", async () => {
    const recorder = vi.fn().mockResolvedValue(undefined);
    const result = resolveMemoryPrecedence({
      memory: existing(),
      currentTurnExplicit: "detailed",
    });
    await result.recordDecision?.(recorder, {
      decisionId: "decision-1",
      createdAt: "2026-01-02T00:00:00.000Z",
    });
    expect(recorder).toHaveBeenCalledWith(
      expect.objectContaining({
        decisionType: "memory_precedence",
        outcome: "supersedes",
      })
    );
  });
});
