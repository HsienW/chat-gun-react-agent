import { describe, expect, it, vi } from "vitest";

import type { MemoryCandidate } from "../types.js";
import { MemoryWritePolicy } from "./write-policy.js";

function candidate(overrides: Partial<MemoryCandidate> = {}): MemoryCandidate {
  return {
    namespace: {
      tenantId: "tenant-a",
      principalId: "principal-a",
      scopeId: "scope-a",
    },
    memoryType: "preference",
    value: { responseStyle: "compact" },
    provenance: { source: "user_explicit" },
    confidence: 1,
    idempotencyKey: "candidate-1",
    ...overrides,
  };
}

const acceptedContext = {
  consentGranted: true,
  retentionAllowed: true,
  contentKind: "durable" as const,
};

describe("MemoryWritePolicy", () => {
  it("accepts approved durable sources and deduplicates idempotency keys", () => {
    const detector = vi.fn().mockReturnValue(false);
    const policy = new MemoryWritePolicy({
      sensitiveDataDetector: detector,
      minimumInferredConfidence: 0.8,
    });

    expect(policy.evaluate(candidate(), acceptedContext)).toEqual({
      status: "accepted",
    });
    policy.markCommitted("candidate-1");
    expect(policy.evaluate(candidate(), acceptedContext)).toEqual({
      status: "duplicate",
      reason: "idempotency_key_reused",
    });
  });

  it.each([
    "raw_prompt",
    "conversation_transcript",
    "derivable",
    "ephemeral",
    "authoritative",
  ] as const)("rejects excluded content kind %s", (contentKind) => {
    const policy = new MemoryWritePolicy({
      sensitiveDataDetector: () => false,
      minimumInferredConfidence: 0.8,
    });

    expect(
      policy.evaluate(candidate(), { ...acceptedContext, contentKind })
    ).toMatchObject({ status: "rejected" });
  });

  it("rejects credentials/PII and low-confidence model inference", () => {
    const policy = new MemoryWritePolicy({
      sensitiveDataDetector: (value) => JSON.stringify(value).includes("secret"),
      minimumInferredConfidence: 0.8,
    });

    expect(
      policy.evaluate(candidate({ value: { secret: "token" } }), acceptedContext)
    ).toEqual({ status: "rejected", reason: "sensitive_data" });
    expect(
      policy.evaluate(
        candidate({
          provenance: { source: "model_inferred" },
          confidence: 0.5,
        }),
        acceptedContext
      )
    ).toEqual({ status: "rejected", reason: "inferred_confidence_too_low" });
  });

  it("uses the same detector at candidate acceptance and before storage", () => {
    const detector = vi.fn().mockReturnValue(false);
    const policy = new MemoryWritePolicy({
      sensitiveDataDetector: detector,
      minimumInferredConfidence: 0.8,
    });
    const memory = candidate();

    policy.evaluate(memory, acceptedContext);
    policy.assertSafeForStorage(memory.value);

    expect(detector).toHaveBeenCalledTimes(2);
  });
});
