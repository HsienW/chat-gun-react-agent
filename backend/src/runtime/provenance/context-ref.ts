import type { ResourceRef } from "../authorization/resource-ref.js";

export const SUGGESTED_RELATION_TYPES = [
  "derived_from",
  "produced_by",
  "supports",
  "contradicts",
  "mentions",
  "selected_from",
  "generated_from",
] as const;

export interface ContextRef {
  contextRefId: string;
  source: ResourceRef;
  target: ResourceRef;
  relationType: string;
  createdAt: string;
}

export interface CreateContextRefInput {
  contextRefId: string;
  source: ResourceRef;
  target: ResourceRef;
  relationType: string;
  createdAt?: string;
  now?: () => Date;
}

function requiredString(value: string, fieldName: string): string {
  if (value.trim().length === 0) {
    throw new Error(`${fieldName} is required`);
  }
  return value;
}

function optionalString(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.trim().length === 0 ? undefined : value;
}

function validateResource(resource: ResourceRef, fieldName: string): ResourceRef {
  const ownerScopeId = optionalString(resource.ownerScopeId);
  return {
    resourceType: requiredString(resource.resourceType, `${fieldName}.resourceType`),
    resourceId: requiredString(resource.resourceId, `${fieldName}.resourceId`),
    tenantId: requiredString(resource.tenantId, `${fieldName}.tenantId`),
    ...(ownerScopeId === undefined ? {} : { ownerScopeId }),
  };
}

export function createContextRef(input: CreateContextRefInput): ContextRef {
  return {
    contextRefId: requiredString(input.contextRefId, "contextRefId"),
    source: validateResource(input.source, "source"),
    target: validateResource(input.target, "target"),
    relationType: requiredString(input.relationType, "relationType"),
    createdAt: input.createdAt ?? (input.now?.() ?? new Date()).toISOString(),
  };
}
