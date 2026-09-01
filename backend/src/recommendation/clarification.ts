import { randomUUID } from "node:crypto";

import type { ResolvedConstraint } from "./constraint-engine.js";
import type { RecommendationInput } from "./types.js";

export interface ClarificationRequest {
  clarificationId: string;
  taskId?: string;
  reasonCode: string;
  question: string;
  requestedAt: string;
  confirmationType: "clarification";
  taskStatus: "waiting_confirmation";
}

export interface ClarificationFlowOptions {
  confidenceThreshold: number;
  requiredHardConstraintFields?: readonly string[];
  buildQuestion: (
    input: RecommendationInput,
    reasonCode: string
  ) => Promise<string>;
  createClarificationId?: () => string;
  now?: () => Date;
}

function requireNonEmpty(value: string, fieldName: string): string {
  if (value.trim().length === 0) {
    throw new Error(`${fieldName} is required`);
  }
  return value;
}

function validateConfidence(value: number, fieldName: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${fieldName} must be a finite number between 0 and 1`);
  }
  return value;
}

export class ClarificationFlow {
  private readonly confidenceThreshold: number;
  private readonly requiredHardConstraintFields: readonly string[];
  private readonly buildQuestion: ClarificationFlowOptions["buildQuestion"];
  private readonly createClarificationId: () => string;
  private readonly now: () => Date;

  constructor(options: ClarificationFlowOptions) {
    this.confidenceThreshold = validateConfidence(
      options.confidenceThreshold,
      "confidenceThreshold"
    );
    this.requiredHardConstraintFields = [
      ...new Set(
        (options.requiredHardConstraintFields ?? []).map((field) =>
          requireNonEmpty(field, "requiredHardConstraintField")
        )
      ),
    ];
    this.buildQuestion = options.buildQuestion;
    this.createClarificationId = options.createClarificationId ?? randomUUID;
    this.now = options.now ?? (() => new Date());
  }

  shouldClarify(
    confidence: number,
    resolved: readonly ResolvedConstraint[]
  ): boolean {
    validateConfidence(confidence, "confidence");
    if (confidence < this.confidenceThreshold) return true;

    const resolvedHardFields = new Set(
      resolved
        .filter((constraint) => constraint.mode === "hard")
        .map((constraint) => constraint.field)
    );
    return this.requiredHardConstraintFields.some(
      (requiredField) => !resolvedHardFields.has(requiredField)
    );
  }

  async request(
    input: RecommendationInput,
    reasonCode: string
  ): Promise<ClarificationRequest> {
    const safeReasonCode = requireNonEmpty(reasonCode, "reasonCode");
    const question = requireNonEmpty(
      await this.buildQuestion(input, safeReasonCode),
      "question"
    );
    const clarificationId = requireNonEmpty(
      this.createClarificationId(),
      "clarificationId"
    );

    return {
      clarificationId,
      ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
      reasonCode: safeReasonCode,
      question,
      requestedAt: this.now().toISOString(),
      confirmationType: "clarification",
      taskStatus: "waiting_confirmation",
    };
  }
}
