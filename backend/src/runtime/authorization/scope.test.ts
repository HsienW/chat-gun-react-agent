import { describe, expect, it } from "vitest";

import {
  SCOPE_TYPES,
  isActiveScopePresent,
  projectTrustedScope,
  scopeTenantMatches,
} from "./scope.js";

describe("RuntimeScope", () => {
  it("keeps scope types closed", () => {
    expect(SCOPE_TYPES).toEqual([
      "principal",
      "tenant",
      "team",
      "conversation",
    ]);
  });

  it("requires a non-empty active scope identifier", () => {
    expect(
      isActiveScopePresent({
        scopeId: "scope-1",
        scopeType: "team",
        tenantId: "tenant-1",
      })
    ).toBe(true);
    expect(
      isActiveScopePresent({
        scopeId: "   ",
        scopeType: "team",
        tenantId: "tenant-1",
      })
    ).toBe(false);
    expect(isActiveScopePresent(undefined)).toBe(false);
  });

  it("matches resource tenant only within the active scope tenant", () => {
    const scope = {
      scopeId: "scope-1",
      scopeType: "team" as const,
      tenantId: "tenant-1",
    };

    expect(scopeTenantMatches(scope, "tenant-1")).toBe(true);
    expect(scopeTenantMatches(scope, "tenant-2")).toBe(false);
  });

  it("projects legacy TrustedScope without merging principal identity into scope", () => {
    expect(
      projectTrustedScope(
        {
          scopeId: "scope-1",
          tenantId: "tenant-1",
          principalId: "principal-1",
        },
        "team"
      )
    ).toEqual({
      principalId: "principal-1",
      scope: {
        scopeId: "scope-1",
        scopeType: "team",
        tenantId: "tenant-1",
      },
    });
  });
});
