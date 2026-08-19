export const SCOPE_TYPES = [
  "principal",
  "tenant",
  "team",
  "conversation",
] as const;

export type ScopeType = (typeof SCOPE_TYPES)[number];

export interface RuntimeScope {
  scopeId: string;
  scopeType: ScopeType;
  tenantId: string;
  ownerPrincipalId?: string;
}

export interface TrustedScopeProjection {
  scopeId: string;
  tenantId: string;
  principalId: string;
}

export interface ProjectedTrustedScope {
  principalId: string;
  scope: RuntimeScope;
}

export interface PrincipalScopeIdentity {
  principalId: string;
}

export interface StoredScopeIdentity {
  scopeId: string;
  tenantId: string;
  principalId: string;
}

export function isActiveScopePresent(
  scope: RuntimeScope | null | undefined
): scope is RuntimeScope {
  return scope !== null && scope !== undefined && scope.scopeId.trim().length > 0;
}

export function scopeTenantMatches(
  scope: RuntimeScope,
  resourceTenant: string
): boolean {
  const scopeTenant = scope.tenantId.trim();
  const normalizedResourceTenant = resourceTenant.trim();
  return (
    scopeTenant.length > 0 &&
    normalizedResourceTenant.length > 0 &&
    scopeTenant === normalizedResourceTenant
  );
}

export function projectTrustedScope(
  trustedScope: TrustedScopeProjection,
  scopeType: ScopeType
): ProjectedTrustedScope {
  return {
    principalId: trustedScope.principalId,
    scope: {
      scopeId: trustedScope.scopeId,
      scopeType,
      tenantId: trustedScope.tenantId,
    },
  };
}

export function isScopeCompatible(
  scope: Pick<RuntimeScope, "scopeId" | "tenantId">,
  principal: PrincipalScopeIdentity,
  recordScope: StoredScopeIdentity
): boolean {
  return (
    scope.scopeId === recordScope.scopeId &&
    scope.tenantId === recordScope.tenantId &&
    principal.principalId === recordScope.principalId
  );
}
