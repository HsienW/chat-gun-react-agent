import type { ResourceRef } from "./resource-ref.js";
import { resourceTenantMatches } from "./resource-ref.js";
import type { RuntimeScope } from "./scope.js";
import { scopeTenantMatches } from "./scope.js";

export interface PermissionGrant {
  grantId: string;
  resource: ResourceRef;
  granteeScopeId: string;
  granteeTenantId: string;
  actions: string[];
  grantedByPrincipalId: string;
  grantedByScopeId: string;
  canDelegate: boolean;
  createdAt: string;
  expiresAt?: string;
}

export const DELEGATION_DENIAL_REASONS = [
  "GRANT_EXPIRED",
  "DELEGATION_NOT_ALLOWED",
  "CROSS_TENANT_DENIED",
  "ACTION_SCOPE_EXCEEDED",
] as const;

export type DelegationDenialReason =
  (typeof DELEGATION_DENIAL_REASONS)[number];

export type DelegationValidationResult =
  | {
      ok: true;
      granteeScopeId: string;
      granteeTenantId: string;
      actions: string[];
    }
  | {
      ok: false;
      reasonCode: DelegationDenialReason;
    };

function isExpired(expiresAt: string | undefined): boolean {
  if (expiresAt === undefined) return false;

  const expiresAtEpochMs = Date.parse(expiresAt);
  return !Number.isFinite(expiresAtEpochMs) || expiresAtEpochMs <= Date.now();
}

function deny(reasonCode: DelegationDenialReason): DelegationValidationResult {
  return { ok: false, reasonCode };
}

export function validateDelegation(
  grant: PermissionGrant,
  newGranteeScope: RuntimeScope,
  newActions: readonly string[]
): DelegationValidationResult {
  if (isExpired(grant.expiresAt)) {
    return deny("GRANT_EXPIRED");
  }

  if (!grant.canDelegate) {
    return deny("DELEGATION_NOT_ALLOWED");
  }

  const sourceGrantTenantMatches = resourceTenantMatches(
    grant.resource,
    grant.granteeTenantId
  );
  const newGranteeTenantMatches = scopeTenantMatches(
    newGranteeScope,
    grant.resource.tenantId
  );
  if (!sourceGrantTenantMatches || !newGranteeTenantMatches) {
    return deny("CROSS_TENANT_DENIED");
  }

  const grantedActions = new Set(grant.actions);
  if (!newActions.every((action) => grantedActions.has(action))) {
    return deny("ACTION_SCOPE_EXCEEDED");
  }

  return {
    ok: true,
    granteeScopeId: newGranteeScope.scopeId,
    granteeTenantId: newGranteeScope.tenantId,
    actions: [...newActions],
  };
}
