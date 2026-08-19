import { describe, expect, it } from "vitest";

import type { RuntimeScope } from "./scope.js";
import {
  validateDelegation,
  type PermissionGrant,
} from "./grants.js";

const RESOURCE_TENANT_ID = "tenant-1";

function createGrant(
  overrides: Partial<PermissionGrant> = {}
): PermissionGrant {
  return {
    grantId: "grant-1",
    resource: {
      resourceType: "task",
      resourceId: "task-1",
      tenantId: RESOURCE_TENANT_ID,
      ownerScopeId: "scope-owner",
    },
    granteeScopeId: "scope-grantee",
    granteeTenantId: RESOURCE_TENANT_ID,
    actions: ["task:read", "task:update"],
    grantedByPrincipalId: "principal-owner",
    grantedByScopeId: "scope-owner",
    canDelegate: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2999-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function createNewGranteeScope(
  overrides: Partial<RuntimeScope> = {}
): RuntimeScope {
  return {
    scopeId: "opaque-scope-id",
    scopeType: "team",
    tenantId: RESOURCE_TENANT_ID,
    ...overrides,
  };
}

describe("validateDelegation", () => {
  it("denies re-delegation when the source grant is non-transitive", () => {
    const result = validateDelegation(
      createGrant({ canDelegate: false }),
      createNewGranteeScope(),
      ["task:read"]
    );

    expect(result).toEqual({
      ok: false,
      reasonCode: "DELEGATION_NOT_ALLOWED",
    });
  });

  it("denies an explicit cross-tenant grantee without inferring tenant from scopeId", () => {
    const result = validateDelegation(
      createGrant(),
      createNewGranteeScope({
        scopeId: "tenant-1-looking-scope",
        tenantId: "tenant-2",
      }),
      ["task:read"]
    );

    expect(result).toEqual({
      ok: false,
      reasonCode: "CROSS_TENANT_DENIED",
    });
  });

  it("fails closed when the source grant stores a cross-tenant grantee", () => {
    const result = validateDelegation(
      createGrant({ granteeTenantId: "tenant-2" }),
      createNewGranteeScope(),
      ["task:read"]
    );

    expect(result).toEqual({
      ok: false,
      reasonCode: "CROSS_TENANT_DENIED",
    });
  });

  it("denies actions outside the source grant", () => {
    const result = validateDelegation(
      createGrant(),
      createNewGranteeScope(),
      ["task:read", "task:delete"]
    );

    expect(result).toEqual({
      ok: false,
      reasonCode: "ACTION_SCOPE_EXCEEDED",
    });
  });

  it("denies an expired source grant", () => {
    const result = validateDelegation(
      createGrant({ expiresAt: "2000-01-01T00:00:00.000Z" }),
      createNewGranteeScope(),
      ["task:read"]
    );

    expect(result).toEqual({
      ok: false,
      reasonCode: "GRANT_EXPIRED",
    });
  });

  it("allows only the requested subset for the explicit grantee scope", () => {
    const result = validateDelegation(
      createGrant(),
      createNewGranteeScope(),
      ["task:read"]
    );

    expect(result).toEqual({
      ok: true,
      granteeScopeId: "opaque-scope-id",
      granteeTenantId: RESOURCE_TENANT_ID,
      actions: ["task:read"],
    });
  });
});
