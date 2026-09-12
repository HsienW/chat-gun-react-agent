import { describe, expect, it } from "vitest";

import {
  MEMORY_NAMESPACE_SENTINEL,
  MEMORY_TYPES,
  parseLongTermMemoryRecord,
  parseMemoryAccessPolicy,
  parseMemoryCandidate,
} from "./types.js";

const namespace = {
  tenantId: "tenant-a",
  principalId: "principal-a",
  domain: "assistant",
  scopeId: "scope-a",
};

describe("memory runtime validation", () => {
  it("accepts a complete bi-temporal record", () => {
    const record = parseLongTermMemoryRecord({
      memoryId: "memory-1",
      namespace,
      memoryType: "preference",
      value: { responseStyle: "compact" },
      provenance: { source: "user_explicit", sourceRef: "turn-1" },
      confidence: 1,
      revision: "r10000",
      validFrom: "2026-01-01T00:00:00.000Z",
      validUntil: "2027-01-01T00:00:00.000Z",
      recordedAt: "2026-01-02T00:00:00.000Z",
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      expiresAt: "2027-01-01T00:00:00.000Z",
    });

    expect(record.revision).toBe("r10000");
    expect(record.validFrom).not.toBe(record.recordedAt);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -0.1, 1.1])(
    "rejects invalid confidence %s",
    (confidence) => {
      expect(() =>
        parseMemoryCandidate({
          namespace,
          memoryType: "preference",
          value: "compact",
          provenance: { source: "user_explicit" },
          confidence,
          idempotencyKey: "candidate-1",
        })
      ).toThrow(/confidence/);
    }
  );

  it("rejects unknown closed-enum values and malformed revisions", () => {
    const base = {
      memoryId: "memory-1",
      namespace,
      value: "compact",
      confidence: 1,
      recordedAt: "2026-01-02T00:00:00.000Z",
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    };

    expect(() =>
      parseLongTermMemoryRecord({
        ...base,
        memoryType: "unknown",
        provenance: { source: "user_explicit" },
        revision: "r1",
      })
    ).toThrow(/memoryType/);
    expect(() =>
      parseLongTermMemoryRecord({
        ...base,
        memoryType: "preference",
        provenance: { source: "unknown" },
        revision: "r1",
      })
    ).toThrow(/provenance.source/);
    expect(() =>
      parseLongTermMemoryRecord({
        ...base,
        memoryType: "preference",
        provenance: { source: "user_explicit" },
        revision: "r01",
      })
    ).toThrow(/revision/);
  });

  it("rejects the absent-domain sentinel as an explicit domain", () => {
    expect(() =>
      parseMemoryCandidate({
        namespace: { ...namespace, domain: MEMORY_NAMESPACE_SENTINEL },
        memoryType: "preference",
        value: "compact",
        provenance: { source: "user_explicit" },
        confidence: 1,
        idempotencyKey: "candidate-sentinel",
      })
    ).toThrow(/reserved sentinel/);
  });

  it("validates the complete access-policy projection", () => {
    expect(
      parseMemoryAccessPolicy({
        readMode: "visible_scopes",
        writeMode: "writable_scopes",
        visibleScopeIds: ["scope-a"],
        writableScopeIds: ["scope-a"],
      })
    ).toEqual({
      readMode: "visible_scopes",
      writeMode: "writable_scopes",
      visibleScopeIds: ["scope-a"],
      writableScopeIds: ["scope-a"],
    });
    expect(MEMORY_TYPES).toHaveLength(5);
  });

  it("rejects values that cannot cross the JSON Store boundary", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    for (const value of [undefined, 1n, cyclic]) {
      expect(() =>
        parseMemoryCandidate({
          namespace,
          memoryType: "preference",
          value,
          provenance: { source: "user_explicit" },
          confidence: 1,
          idempotencyKey: "candidate-json",
        })
      ).toThrow(/JSON/);
    }
  });
});
