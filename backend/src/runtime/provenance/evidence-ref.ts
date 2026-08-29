import type { ResourceRef } from "../authorization/resource-ref.js";

export const EVIDENCE_ROLES = [
  "input",
  "supporting",
  "contradicting",
  "policy",
  "memory",
  "tool_result",
] as const;

export type EvidenceRole = (typeof EVIDENCE_ROLES)[number];

export interface EvidenceRef {
  evidenceRefId: string;
  decisionId: string;
  resource: ResourceRef;
  role: EvidenceRole;
  observedAt: string;
  resourceVersion?: string;
  snapshotHash?: string;
}

export interface CreateEvidenceRefInput {
  evidenceRefId: string;
  decisionId: string;
  resource: ResourceRef;
  role: EvidenceRole;
  observedAt?: string;
  resourceVersion?: string;
  snapshotHash?: string;
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

function isEvidenceRole(value: string): value is EvidenceRole {
  return EVIDENCE_ROLES.some((role) => role === value);
}

function validateResource(resource: ResourceRef): ResourceRef {
  return {
    resourceType: requiredString(resource.resourceType, "resource.resourceType"),
    resourceId: requiredString(resource.resourceId, "resource.resourceId"),
    tenantId: requiredString(resource.tenantId, "resource.tenantId"),
    ...(optionalString(resource.ownerScopeId) === undefined
      ? {}
      : { ownerScopeId: resource.ownerScopeId }),
  };
}

export function createEvidenceRef(input: CreateEvidenceRefInput): EvidenceRef {
  if (!isEvidenceRole(input.role)) {
    throw new Error("role must be a valid evidence role");
  }
  const resourceVersion = optionalString(input.resourceVersion);
  const snapshotHash = optionalString(input.snapshotHash);

  return {
    evidenceRefId: requiredString(input.evidenceRefId, "evidenceRefId"),
    decisionId: requiredString(input.decisionId, "decisionId"),
    resource: validateResource(input.resource),
    role: input.role,
    observedAt: input.observedAt ?? (input.now?.() ?? new Date()).toISOString(),
    ...(resourceVersion === undefined ? {} : { resourceVersion }),
    ...(snapshotHash === undefined ? {} : { snapshotHash }),
  };
}
