import {
  RECOMMENDATION_REASON_CODES,
  type CandidateDecision,
  type Constraint,
  type ConstraintSource,
  validateConstraint,
} from "./types.js";

const SOURCE_PRIORITY: Readonly<Record<ConstraintSource, number>> = {
  user_text: 0,
  selection: 1,
  vision: 2,
  memory: 3,
  model_inference: 4,
};

const DEFAULT_SOFT_PENALTY = 0.1;

export interface ResolvedConstraint extends Constraint {}

export interface ConstraintConflict {
  field: string;
  constraints: Constraint[];
}

export interface ConstraintResolution {
  resolved: ResolvedConstraint[];
  conflicts: ConstraintConflict[];
}

export interface ConstraintEngineOptions {
  calculateSoftScore?: (violationCount: number) => number;
}

function defaultSoftScore(violationCount: number): number {
  return Math.max(0, 1 - violationCount * DEFAULT_SOFT_PENALTY);
}

function groupByField(
  constraints: readonly Constraint[]
): ReadonlyMap<string, readonly Constraint[]> {
  const grouped = new Map<string, readonly Constraint[]>();
  for (const constraint of constraints) {
    grouped.set(constraint.field, [
      ...(grouped.get(constraint.field) ?? []),
      constraint,
    ]);
  }
  return grouped;
}

function resolveField(
  field: string,
  constraints: readonly Constraint[]
): { resolved?: ResolvedConstraint; conflict?: ConstraintConflict } {
  const highestPriority = Math.min(
    ...constraints.map((constraint) => SOURCE_PRIORITY[constraint.source])
  );
  const prioritized = constraints.filter(
    (constraint) => SOURCE_PRIORITY[constraint.source] === highestPriority
  );
  const highestConfidence = Math.max(
    ...prioritized.map((constraint) => constraint.confidence)
  );
  const finalists = prioritized.filter(
    (constraint) => constraint.confidence === highestConfidence
  );
  const distinctValues = new Set(
    finalists.map((constraint) => constraint.value)
  );

  if (distinctValues.size > 1) {
    return {
      conflict: {
        field,
        constraints: finalists.map((constraint) => ({ ...constraint })),
      },
    };
  }

  const winner =
    finalists.find((constraint) => constraint.mode === "hard") ?? finalists[0];
  if (!winner) return {};
  return { resolved: { ...winner } };
}

function hasHardConflict(conflict: ConstraintConflict): boolean {
  return conflict.constraints.some((constraint) => constraint.mode === "hard");
}

export class ConstraintEngine {
  private readonly calculateSoftScore: (violationCount: number) => number;

  constructor(options: ConstraintEngineOptions = {}) {
    this.calculateSoftScore = options.calculateSoftScore ?? defaultSoftScore;
  }

  resolve(constraints: readonly Constraint[]): ConstraintResolution {
    const safeConstraints = constraints.map(validateConstraint);
    const resolved: ResolvedConstraint[] = [];
    const conflicts: ConstraintConflict[] = [];

    for (const [field, fieldConstraints] of groupByField(safeConstraints)) {
      const fieldResolution = resolveField(field, fieldConstraints);
      if (fieldResolution.resolved) {
        resolved.push(fieldResolution.resolved);
      }
      if (fieldResolution.conflict) {
        conflicts.push(fieldResolution.conflict);
      }
    }

    return { resolved, conflicts };
  }

  evaluateCandidate(
    resolution: ConstraintResolution,
    candidateFields: Readonly<Record<string, string>>
  ): CandidateDecision {
    if (resolution.conflicts.some(hasHardConflict)) {
      return {
        eligible: false,
        reason: "Hard constraints contain an unresolved conflict",
        reasonCode: RECOMMENDATION_REASON_CODES.hardConstraintConflict,
      };
    }

    const hasHardViolation = resolution.resolved.some(
      (constraint) =>
        constraint.mode === "hard" &&
        candidateFields[constraint.field] !== constraint.value
    );
    if (hasHardViolation) {
      return {
        eligible: false,
        reason: "Candidate violates a hard constraint",
        reasonCode: RECOMMENDATION_REASON_CODES.hardConstraintViolation,
      };
    }

    const softViolationCount = resolution.resolved.filter(
      (constraint) =>
        constraint.mode === "soft" &&
        candidateFields[constraint.field] !== constraint.value
    ).length;
    if (softViolationCount > 0) {
      const adjustedScore = this.calculateSoftScore(softViolationCount);
      if (!Number.isFinite(adjustedScore)) {
        throw new Error("soft constraint score must be finite");
      }
      return {
        eligible: true,
        reason: "Candidate violates one or more soft constraints",
        reasonCode: RECOMMENDATION_REASON_CODES.softConstraintAdjusted,
        adjustedScore,
      };
    }

    return {
      eligible: true,
      reasonCode: RECOMMENDATION_REASON_CODES.eligible,
    };
  }
}
