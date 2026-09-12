import type { LongTermMemoryRecord, MemoryCandidate } from "../types.js";
import { parseMemoryCandidate } from "../types.js";

export const MEMORY_CONTENT_KINDS = [
  "durable",
  "raw_prompt",
  "conversation_transcript",
  "derivable",
  "ephemeral",
  "authoritative",
] as const;

export type MemoryContentKind = (typeof MEMORY_CONTENT_KINDS)[number];
export type SensitiveDataDetector = (value: unknown) => boolean;

export interface MemoryWritePolicyContext {
  consentGranted: boolean;
  retentionAllowed: boolean;
  contentKind: MemoryContentKind;
  existingRecords?: readonly LongTermMemoryRecord[];
}

export type MemoryWritePolicyResult =
  | { status: "accepted" }
  | {
      status: "duplicate";
      reason: "idempotency_key_reused" | "equivalent_record_exists";
    }
  | {
      status: "rejected";
      reason:
        | "consent_missing"
        | "retention_disallowed"
        | "content_not_durable"
        | "sensitive_data"
        | "inferred_confidence_too_low";
    };

export interface MemoryWritePolicyOptions {
  sensitiveDataDetector: SensitiveDataDetector;
  minimumInferredConfidence: number;
}

type DuplicatePolicyResult = Extract<
  MemoryWritePolicyResult,
  { status: "duplicate" }
>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)])
  );
}

function equivalentValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

export class MemoryWritePolicy {
  private readonly committedIdempotencyKeys = new Set<string>();
  private readonly sensitiveDataDetector: SensitiveDataDetector;
  private readonly minimumInferredConfidence: number;

  constructor(options: MemoryWritePolicyOptions) {
    if (
      !Number.isFinite(options.minimumInferredConfidence) ||
      options.minimumInferredConfidence < 0 ||
      options.minimumInferredConfidence > 1
    ) {
      throw new Error(
        "minimumInferredConfidence must be a finite number between 0 and 1"
      );
    }
    this.sensitiveDataDetector = options.sensitiveDataDetector;
    this.minimumInferredConfidence = options.minimumInferredConfidence;
  }

  evaluate(
    input: MemoryCandidate,
    context: MemoryWritePolicyContext
  ): MemoryWritePolicyResult {
    const candidate = parseMemoryCandidate(input);
    if (this.committedIdempotencyKeys.has(candidate.idempotencyKey)) {
      return { status: "duplicate", reason: "idempotency_key_reused" };
    }
    if (context.consentGranted !== true) {
      return { status: "rejected", reason: "consent_missing" };
    }
    if (context.retentionAllowed !== true) {
      return { status: "rejected", reason: "retention_disallowed" };
    }
    if (context.contentKind !== "durable") {
      return { status: "rejected", reason: "content_not_durable" };
    }
    if (this.sensitiveDataDetector(candidate.value)) {
      return { status: "rejected", reason: "sensitive_data" };
    }
    if (
      candidate.provenance.source === "model_inferred" &&
      candidate.confidence < this.minimumInferredConfidence
    ) {
      return { status: "rejected", reason: "inferred_confidence_too_low" };
    }
    const duplicate = this.findDuplicate(candidate, context.existingRecords ?? []);
    if (duplicate !== undefined) return duplicate;
    return { status: "accepted" };
  }

  findDuplicate(
    candidate: MemoryCandidate,
    existingRecords: readonly LongTermMemoryRecord[]
  ): DuplicatePolicyResult | undefined {
    if (
      existingRecords.some(
        (record) => record.idempotencyKey === candidate.idempotencyKey
      )
    ) {
      return { status: "duplicate", reason: "idempotency_key_reused" };
    }
    if (
      existingRecords.some(
        (record) =>
          record.memoryType === candidate.memoryType &&
          equivalentValue(record.value, candidate.value)
      )
    ) {
      return { status: "duplicate", reason: "equivalent_record_exists" };
    }
    return undefined;
  }

  assertSafeForStorage(value: unknown): void {
    if (this.sensitiveDataDetector(value)) {
      throw new Error("sensitive memory rejected before storage");
    }
  }

  markCommitted(idempotencyKey: string): void {
    if (idempotencyKey.trim().length === 0) {
      throw new Error("idempotencyKey must be a non-empty string");
    }
    this.committedIdempotencyKeys.add(idempotencyKey);
  }
}
