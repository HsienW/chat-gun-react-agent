import {
  createDecisionRecord,
  type DecisionRecord,
} from "../../runtime/provenance/index.js";
import type {
  LongTermMemoryRecord,
  MemoryCandidate,
  MemoryRelation,
} from "../types.js";

export interface RelationContext {
  currentAuthoritativeValue?: unknown;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)])
  );
}

function equivalent(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

export function classifyMemoryRelation(
  existing: LongTermMemoryRecord,
  candidate: MemoryCandidate,
  context: RelationContext = {}
): MemoryRelation {
  if (existing.memoryType !== candidate.memoryType) return "coexists";
  if (equivalent(existing.value, candidate.value)) return "same";
  if (
    context.currentAuthoritativeValue !== undefined &&
    !equivalent(candidate.value, context.currentAuthoritativeValue)
  ) {
    return "conflicts";
  }
  return candidate.provenance.source === "user_explicit"
    ? "supersedes"
    : "conflicts";
}

export type MemoryPrecedenceSource =
  | "current_turn_explicit"
  | "current_selection"
  | "high_confidence_vision"
  | "current_authoritative_state"
  | "long_term_memory";

export type DecisionRecorder = (record: DecisionRecord) => Promise<void>;

export interface MemoryPrecedenceInput {
  memory: LongTermMemoryRecord;
  currentTurnExplicit?: unknown;
  currentSelection?: unknown;
  highConfidenceVision?: unknown;
  currentAuthoritativeState?: unknown;
  lowConfidenceThreshold?: number;
}

export interface MemoryPrecedenceResult {
  value: unknown;
  source: MemoryPrecedenceSource;
  hardConstraint: boolean;
  memoryRelation: MemoryRelation;
  recordDecision?: (
    recorder: DecisionRecorder,
    input: { decisionId: string; createdAt?: string }
  ) => Promise<void>;
}

export function resolveMemoryPrecedence(
  input: MemoryPrecedenceInput
): MemoryPrecedenceResult {
  let value = input.memory.value;
  let source: MemoryPrecedenceSource = "long_term_memory";

  if (input.currentAuthoritativeState !== undefined) {
    value = input.currentAuthoritativeState;
    source = "current_authoritative_state";
  }
  if (input.highConfidenceVision !== undefined) {
    value = input.highConfidenceVision;
    source = "high_confidence_vision";
  }
  if (input.currentSelection !== undefined) {
    value = input.currentSelection;
    source = "current_selection";
  }
  if (input.currentTurnExplicit !== undefined) {
    value = input.currentTurnExplicit;
    source = "current_turn_explicit";
  }

  const memoryRelation =
    source === "long_term_memory" || equivalent(value, input.memory.value)
      ? "same"
      : "supersedes";
  const lowConfidenceThreshold = input.lowConfidenceThreshold ?? 0.8;
  const hardConstraint = !(
    input.memory.provenance.source === "model_inferred" &&
    input.memory.confidence < lowConfidenceThreshold
  ) && source !== "long_term_memory";

  const result: MemoryPrecedenceResult = {
    value,
    source,
    hardConstraint,
    memoryRelation,
  };
  if (memoryRelation === "supersedes") {
    result.recordDecision = async (recorder, decisionInput) => {
      await recorder(
        createDecisionRecord({
          decisionId: decisionInput.decisionId,
          decisionType: "memory_precedence",
          outcome: "supersedes",
          reasonCode: source,
          confidence: input.memory.confidence,
          ...(decisionInput.createdAt === undefined
            ? {}
            : { createdAt: decisionInput.createdAt }),
        })
      );
    };
  }
  return result;
}
