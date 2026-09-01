import type { ConstraintConflict } from "./constraint-engine.js";
import {
  RECOMMENDATION_REASON_CODES,
  type CandidateDecision,
} from "./types.js";

export interface BusinessPolicyContext {
  conflicts?: readonly ConstraintConflict[];
}

function hasUnresolvedHardConflict(
  conflicts: readonly ConstraintConflict[]
): boolean {
  return conflicts.some((conflict) =>
    conflict.constraints.some((constraint) => constraint.mode === "hard")
  );
}

function excludeWithoutScore(
  decision: CandidateDecision,
  reason: string,
  reasonCode: string
): CandidateDecision {
  const { adjustedScore: _adjustedScore, ...decisionWithoutScore } = decision;
  return {
    ...decisionWithoutScore,
    eligible: false,
    reason,
    reasonCode,
  };
}

export class BusinessPolicyGate {
  apply(
    decision: CandidateDecision,
    context: BusinessPolicyContext = {}
  ): CandidateDecision {
    if (hasUnresolvedHardConflict(context.conflicts ?? [])) {
      return excludeWithoutScore(
        decision,
        "Hard constraints contain an unresolved conflict",
        RECOMMENDATION_REASON_CODES.hardConstraintConflict
      );
    }

    if (
      decision.reasonCode ===
      RECOMMENDATION_REASON_CODES.hardConstraintViolation
    ) {
      return excludeWithoutScore(
        decision,
        decision.reason ?? "Candidate violates a hard constraint",
        RECOMMENDATION_REASON_CODES.hardConstraintViolation
      );
    }

    return { ...decision };
  }
}
