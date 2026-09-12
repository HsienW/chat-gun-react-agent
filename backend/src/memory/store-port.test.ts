import { describe, expect, it } from "vitest";

import {
  MEMORY_NAMESPACE_SENTINEL,
  deserializeMemoryNamespace,
  serializeMemoryNamespace,
} from "./store-port.js";

describe("memory namespace serialization", () => {
  it("is deterministic and round-trips a namespace with a domain", () => {
    const namespace = {
      tenantId: "tenant-a",
      principalId: "principal-a",
      domain: "assistant",
      scopeId: "scope-a",
    };

    const tuple = serializeMemoryNamespace(namespace);
    expect(tuple).toEqual([
      "memory",
      "tenant-a",
      "principal-a",
      "assistant",
      "scope-a",
    ]);
    expect(deserializeMemoryNamespace(tuple)).toEqual(namespace);
  });

  it("uses one sentinel for an absent domain and rejects collisions", () => {
    const namespace = {
      tenantId: "tenant-a",
      principalId: "principal-a",
      scopeId: "scope-a",
    };
    const tuple = serializeMemoryNamespace(namespace);

    expect(tuple[3]).toBe(MEMORY_NAMESPACE_SENTINEL);
    expect(deserializeMemoryNamespace(tuple)).toEqual(namespace);
    expect(() =>
      serializeMemoryNamespace({ ...namespace, domain: MEMORY_NAMESPACE_SENTINEL })
    ).toThrow(/reserved/);
  });

  it("rejects labels that collide in the Postgres namespace path", () => {
    expect(() =>
      serializeMemoryNamespace({
        tenantId: "tenant:a",
        principalId: "principal-a",
        scopeId: "scope-a",
      })
    ).toThrow(/reserved/);
  });
});
