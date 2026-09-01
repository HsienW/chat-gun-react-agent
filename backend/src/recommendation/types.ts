import {
  AUTH_SOURCES,
  PRINCIPAL_TYPES,
  SCOPE_TYPES,
  type PrincipalContext,
  type RuntimeScope,
} from "../runtime/authorization/index.js";

export const CONSTRAINT_SOURCES = [
  "user_text",
  "selection",
  "vision",
  "memory",
  "model_inference",
] as const;

export const CONSTRAINT_MODES = ["hard", "soft"] as const;

export const RECOMMENDATION_REASON_CODES = {
  eligible: "ELIGIBLE",
  hardConstraintViolation: "HARD_CONSTRAINT_VIOLATION",
  hardConstraintConflict: "HARD_CONSTRAINT_CONFLICT",
  softConstraintAdjusted: "SOFT_CONSTRAINT_ADJUSTED",
  domainRouted: "DOMAIN_ROUTED",
  lowConfidenceClarification: "LOW_CONFIDENCE_CLARIFICATION",
  emptyCandidates: "EMPTY_CANDIDATES",
  unknown: "UNKNOWN_RECOMMENDATION_REASON",
} as const;

export type ConstraintSource = (typeof CONSTRAINT_SOURCES)[number];
export type ConstraintMode = (typeof CONSTRAINT_MODES)[number];
export type RecommendationReasonCode =
  (typeof RECOMMENDATION_REASON_CODES)[keyof typeof RECOMMENDATION_REASON_CODES];

export interface Constraint {
  field: string;
  value: string;
  source: ConstraintSource;
  confidence: number;
  mode: ConstraintMode;
}

export interface RecommendationInput {
  requestId?: string;
  threadId?: string;
  runId?: string;
  taskId?: string;
  stepId?: string;
  principal: PrincipalContext;
  scope: RuntimeScope;
  signals: Constraint[];
  rawText?: string;
}

export interface RetrievalPolicy {
  domain: string;
  candidateLimit: number;
  filters?: Record<string, string>;
}

export interface CandidateDecision {
  eligible: boolean;
  reason?: string;
  reasonCode?: string;
  adjustedScore?: number;
}

export interface RecommendationResult<TCard = unknown> {
  domain: string;
  candidates: CandidateDecision[];
  cards: TCard[];
  clarificationRequested: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isConstraintSource(value: unknown): value is ConstraintSource {
  return (
    typeof value === "string" &&
    CONSTRAINT_SOURCES.some((source) => source === value)
  );
}

function isConstraintMode(value: unknown): value is ConstraintMode {
  return (
    typeof value === "string" && CONSTRAINT_MODES.some((mode) => mode === value)
  );
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} is required`);
  }
  return value;
}

function optionalString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error(`${fieldName} must be a string`);
  }
  return value.trim().length === 0 ? undefined : value;
}

function isPrincipalContext(value: unknown): value is PrincipalContext {
  return (
    isRecord(value) &&
    typeof value.principalId === "string" &&
    value.principalId.trim().length > 0 &&
    typeof value.principalType === "string" &&
    PRINCIPAL_TYPES.some(
      (principalType) => principalType === value.principalType
    ) &&
    typeof value.tenantId === "string" &&
    value.tenantId.trim().length > 0 &&
    isStringArray(value.roles) &&
    isStringArray(value.scopes) &&
    typeof value.authSource === "string" &&
    AUTH_SOURCES.some((authSource) => authSource === value.authSource) &&
    typeof value.authenticatedAt === "string" &&
    isIsoTimestamp(value.authenticatedAt)
  );
}

function isRuntimeScope(value: unknown): value is RuntimeScope {
  return (
    isRecord(value) &&
    typeof value.scopeId === "string" &&
    value.scopeId.trim().length > 0 &&
    typeof value.scopeType === "string" &&
    SCOPE_TYPES.some((scopeType) => scopeType === value.scopeType) &&
    typeof value.tenantId === "string" &&
    value.tenantId.trim().length > 0 &&
    (value.ownerPrincipalId === undefined ||
      (typeof value.ownerPrincipalId === "string" &&
        value.ownerPrincipalId.trim().length > 0))
  );
}

function isIsoTimestamp(value: string): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

export function validateConstraint(value: unknown): Constraint {
  if (!isRecord(value)) {
    throw new Error("constraint must be an object");
  }
  if (!isConstraintSource(value.source)) {
    throw new Error("source must be a valid constraint source");
  }
  if (!isConstraintMode(value.mode)) {
    throw new Error("mode must be a valid constraint mode");
  }
  if (
    typeof value.confidence !== "number" ||
    !Number.isFinite(value.confidence) ||
    value.confidence < 0 ||
    value.confidence > 1
  ) {
    throw new Error("confidence must be a finite number between 0 and 1");
  }

  return {
    field: requireString(value.field, "field"),
    value: requireString(value.value, "value"),
    source: value.source,
    confidence: value.confidence,
    mode: value.mode,
  };
}

export function validateRecommendationInput(value: unknown): RecommendationInput {
  if (!isRecord(value)) {
    throw new Error("recommendation input must be an object");
  }
  if (!isPrincipalContext(value.principal)) {
    throw new Error("principal must be a valid trusted principal context");
  }
  if (!isRuntimeScope(value.scope)) {
    throw new Error("scope must be a valid runtime scope");
  }
  if (value.principal.tenantId !== value.scope.tenantId) {
    throw new Error("principal and scope tenantId must match");
  }
  if (!Array.isArray(value.signals)) {
    throw new Error("signals must be an array");
  }

  const requestId = optionalString(value.requestId, "requestId");
  const threadId = optionalString(value.threadId, "threadId");
  const runId = optionalString(value.runId, "runId");
  const taskId = optionalString(value.taskId, "taskId");
  const stepId = optionalString(value.stepId, "stepId");
  const rawText = optionalString(value.rawText, "rawText");

  return {
    ...(requestId === undefined ? {} : { requestId }),
    ...(threadId === undefined ? {} : { threadId }),
    ...(runId === undefined ? {} : { runId }),
    ...(taskId === undefined ? {} : { taskId }),
    ...(stepId === undefined ? {} : { stepId }),
    principal: value.principal,
    scope: value.scope,
    signals: value.signals.map(validateConstraint),
    ...(rawText === undefined ? {} : { rawText }),
  };
}

export function validateRetrievalPolicy(value: unknown): RetrievalPolicy {
  if (!isRecord(value)) {
    throw new Error("retrieval policy must be an object");
  }
  if (
    typeof value.candidateLimit !== "number" ||
    !Number.isSafeInteger(value.candidateLimit) ||
    value.candidateLimit < 1
  ) {
    throw new Error("candidateLimit must be a positive safe integer");
  }

  let filters: Record<string, string> | undefined;
  if (value.filters !== undefined) {
    if (!isRecord(value.filters)) {
      throw new Error("filters must be a string record");
    }
    filters = Object.entries(value.filters).reduce<Record<string, string>>(
      (validatedFilters, [key, entry]) => {
        if (key.trim().length === 0 || typeof entry !== "string") {
          throw new Error("filters must be a string record");
        }
        return { ...validatedFilters, [key]: entry };
      },
      {}
    );
  }

  return {
    domain: requireString(value.domain, "domain"),
    candidateLimit: value.candidateLimit,
    ...(filters === undefined ? {} : { filters }),
  };
}
