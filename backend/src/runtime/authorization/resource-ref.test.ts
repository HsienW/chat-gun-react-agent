import { describe, expect, it } from "vitest";

import {
  KNOWN_RESOURCE_TYPES,
  isKnownResourceType,
  resourceOwnerMatches,
  resourceTenantMatches,
  type ResourceRef,
} from "./resource-ref.js";

describe("ResourceRef", () => {
  it("publishes known resource types without closing resourceType", () => {
    expect(KNOWN_RESOURCE_TYPES).toEqual([
      "image_asset",
      "task",
      "step",
      "tool_execution",
      "product",
      "offer",
      "recommendation_card",
      "memory",
      "credential_ref",
    ]);
    expect(isKnownResourceType("task")).toBe(true);
    expect(isKnownResourceType("future_domain_resource")).toBe(false);

    const futureResource: ResourceRef = {
      resourceType: "future_domain_resource",
      resourceId: "resource-1",
      tenantId: "tenant-1",
    };
    expect(futureResource.resourceType).toBe("future_domain_resource");
  });

  it("matches resources only within the same non-empty tenant", () => {
    const resource: ResourceRef = {
      resourceType: "task",
      resourceId: "task-1",
      tenantId: "tenant-1",
    };

    expect(resourceTenantMatches(resource, "tenant-1")).toBe(true);
    expect(resourceTenantMatches(resource, "tenant-2")).toBe(false);
    expect(resourceTenantMatches(resource, "")).toBe(false);
  });

  it("enforces owner scope only when the resource declares one", () => {
    const unownedResource: ResourceRef = {
      resourceType: "task",
      resourceId: "task-1",
      tenantId: "tenant-1",
    };
    const ownedResource: ResourceRef = {
      ...unownedResource,
      ownerScopeId: "scope-1",
    };

    expect(resourceOwnerMatches(unownedResource, "scope-2")).toBe(true);
    expect(resourceOwnerMatches(ownedResource, "scope-1")).toBe(true);
    expect(resourceOwnerMatches(ownedResource, "scope-2")).toBe(false);
  });
});
