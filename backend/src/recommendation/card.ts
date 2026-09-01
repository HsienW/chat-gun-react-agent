import type { ResourceRef } from "../runtime/authorization/index.js";

export interface RecommendationCard<TCardPayload = unknown> {
  cardId: string;
  domain: string;
  candidateRef: ResourceRef;
  payload: TCardPayload;
  createdAt: string;
}

export interface CreateRecommendationCardInput<TCardPayload> {
  cardId: string;
  domain: string;
  candidateRef: ResourceRef;
  payload: TCardPayload;
  createdAt?: string;
  now?: () => Date;
}

function requireString(value: string, fieldName: string): string {
  if (value.trim().length === 0) {
    throw new Error(`${fieldName} is required`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new Error("createdAt must be an ISO timestamp");
  }
  return value;
}

export function createRecommendationCard<TCardPayload>(
  input: CreateRecommendationCardInput<TCardPayload>
): RecommendationCard<TCardPayload> {
  const createdAt = input.createdAt ?? (input.now?.() ?? new Date()).toISOString();
  return validateRecommendationCard({
    cardId: input.cardId,
    domain: input.domain,
    candidateRef: input.candidateRef,
    payload: input.payload,
    createdAt,
  });
}

export function validateRecommendationCard<TCardPayload>(
  value: RecommendationCard<TCardPayload>
): RecommendationCard<TCardPayload> {
  const unknownValue: unknown = value;
  if (!isRecord(unknownValue)) {
    throw new Error("recommendation card must be an object");
  }
  if (!isRecord(unknownValue.candidateRef)) {
    throw new Error("candidateRef must be an object");
  }
  const ownerScopeId = unknownValue.candidateRef.ownerScopeId;
  if (ownerScopeId !== undefined && typeof ownerScopeId !== "string") {
    throw new Error("candidateRef.ownerScopeId must be a string");
  }

  return {
    cardId: requireString(
      typeof unknownValue.cardId === "string" ? unknownValue.cardId : "",
      "cardId"
    ),
    domain: requireString(
      typeof unknownValue.domain === "string" ? unknownValue.domain : "",
      "domain"
    ),
    candidateRef: {
      resourceType: requireString(
        typeof unknownValue.candidateRef.resourceType === "string"
          ? unknownValue.candidateRef.resourceType
          : "",
        "candidateRef.resourceType"
      ),
      resourceId: requireString(
        typeof unknownValue.candidateRef.resourceId === "string"
          ? unknownValue.candidateRef.resourceId
          : "",
        "candidateRef.resourceId"
      ),
      tenantId: requireString(
        typeof unknownValue.candidateRef.tenantId === "string"
          ? unknownValue.candidateRef.tenantId
          : "",
        "candidateRef.tenantId"
      ),
      ...(ownerScopeId === undefined
        ? {}
        : {
            ownerScopeId: requireString(
              ownerScopeId,
              "candidateRef.ownerScopeId"
            ),
          }),
    },
    payload: value.payload,
    createdAt: validateTimestamp(
      typeof unknownValue.createdAt === "string" ? unknownValue.createdAt : ""
    ),
  };
}
