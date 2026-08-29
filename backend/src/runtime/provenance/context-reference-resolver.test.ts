import { describe, expect, it, vi } from "vitest";

import type { AuthorizationDecision } from "../authorization/authorization.js";
import type { PrincipalContext } from "../authorization/principal.js";
import type { ResourceRef } from "../authorization/resource-ref.js";
import type { RuntimeScope } from "../authorization/scope.js";
import type { ContextRef } from "./context-ref.js";
import type { Authorizer, ContextRefStore } from "./context-ref-store.js";
import { AuthorizedContextReferenceResolver } from "./context-reference-resolver.js";

const principal: PrincipalContext = {
  principalId: "principal-1",
  principalType: "user",
  tenantId: "tenant-1",
  roles: ["reader"],
  scopes: ["context:read"],
  authSource: "trusted_gateway",
  authenticatedAt: "2026-08-27T00:00:00.000Z",
};

const scope: RuntimeScope = {
  scopeId: "scope-1",
  scopeType: "team",
  tenantId: "tenant-1",
};

const source: ResourceRef = {
  resourceType: "recommendation_card",
  resourceId: "card-1",
  tenantId: "tenant-1",
};

const allowedTarget: ResourceRef = {
  resourceType: "tool_execution",
  resourceId: "tool-execution-1",
  tenantId: "tenant-1",
};

const deniedTarget: ResourceRef = {
  resourceType: "memory",
  resourceId: "memory-1",
  tenantId: "tenant-2",
};

function decision(effect: AuthorizationDecision["effect"]): AuthorizationDecision {
  return {
    decisionId: "auth-decision-1",
    effect,
    reasonCode: effect === "allow" ? "POLICY_ALLOWED" : "CROSS_TENANT_DENIED",
    createdAt: "2026-08-27T00:00:00.000Z",
  };
}

function contextRef(target: ResourceRef): ContextRef {
  return {
    contextRefId: `context-ref-${target.resourceId}`,
    source,
    target,
    relationType: "derived_from",
    createdAt: "2026-08-27T00:00:00.000Z",
  };
}

function createStore(contextRefs: ContextRef[]): ContextRefStore {
  return {
    record: async (input) => input.contextRef,
    findRelatedOneHop: vi.fn(async () => contextRefs),
  };
}

describe("AuthorizedContextReferenceResolver", () => {
  it("returns allowed one-hop related resources", async () => {
    const store = createStore([contextRef(allowedTarget)]);
    const authorizer: Authorizer = {
      authorize: vi.fn(async () => decision("allow")),
    };
    const resolver = new AuthorizedContextReferenceResolver(store, authorizer);

    await expect(
      resolver.findRelated(source, principal, scope)
    ).resolves.toEqual([allowedTarget]);
    expect(store.findRelatedOneHop).toHaveBeenCalledWith(source, {});
    expect(authorizer.authorize).toHaveBeenCalledWith({
      principal,
      scope,
      action: "read",
      resource: source,
    });
    expect(authorizer.authorize).toHaveBeenCalledWith({
      principal,
      scope,
      action: "read",
      resource: allowedTarget,
    });
  });

  it("filters denied targets and applies relation and limit options", async () => {
    const store = createStore([contextRef(deniedTarget), contextRef(allowedTarget)]);
    const authorizer: Authorizer = {
      authorize: vi.fn(async (request) =>
        request.resource.tenantId === "tenant-2" ? decision("deny") : decision("allow")
      ),
    };
    const resolver = new AuthorizedContextReferenceResolver(store, authorizer);

    await expect(
      resolver.findRelated(source, principal, scope, {
        relationType: "derived_from",
        limit: 1,
      })
    ).resolves.toEqual([allowedTarget]);
    expect(store.findRelatedOneHop).toHaveBeenCalledWith(source, {
      relationType: "derived_from",
      limit: 1,
    });
  });

  it("denies cross-tenant source access before querying relations", async () => {
    const store = createStore([contextRef(allowedTarget)]);
    const authorizer: Authorizer = {
      authorize: vi.fn(async () => decision("deny")),
    };
    const resolver = new AuthorizedContextReferenceResolver(store, authorizer);

    await expect(
      resolver.findRelated(source, principal, scope)
    ).resolves.toEqual([]);
    expect(store.findRelatedOneHop).not.toHaveBeenCalled();
  });

  it("fails closed when authorization is unavailable", async () => {
    const store = createStore([contextRef(allowedTarget)]);
    const authorizer: Authorizer = {
      authorize: vi.fn(async () => {
        throw new Error("authorization unavailable");
      }),
    };
    const resolver = new AuthorizedContextReferenceResolver(store, authorizer);

    await expect(
      resolver.findRelated(source, principal, scope)
    ).resolves.toEqual([]);
  });
});
