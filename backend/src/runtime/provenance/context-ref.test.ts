import { describe, expect, it } from "vitest";

import type { ResourceRef } from "../authorization/resource-ref.js";
import {
  SUGGESTED_RELATION_TYPES,
  createContextRef,
} from "./context-ref.js";

const source: ResourceRef = {
  resourceType: "recommendation_card",
  resourceId: "card-1",
  tenantId: "tenant-1",
};
const target: ResourceRef = {
  resourceType: "tool_execution",
  resourceId: "tool-execution-1",
  tenantId: "tenant-1",
};

describe("createContextRef", () => {
  it("creates a context reference with source and target ResourceRef values", () => {
    const contextRef = createContextRef({
      contextRefId: "context-ref-1",
      source,
      target,
      relationType: "derived_from",
      now: () => new Date("2026-08-27T00:00:00.000Z"),
    });

    expect(contextRef).toEqual({
      contextRefId: "context-ref-1",
      source,
      target,
      relationType: "derived_from",
      createdAt: "2026-08-27T00:00:00.000Z",
    });
    expect(SUGGESTED_RELATION_TYPES).toContain("generated_from");
  });

  it("allows unknown relation types without changing core unions", () => {
    const contextRef = createContextRef({
      contextRefId: "context-ref-1",
      source,
      target,
      relationType: "recommends_for",
    });

    expect(contextRef.relationType).toBe("recommends_for");
  });

  it("rejects missing resource and relation fields", () => {
    expect(() =>
      createContextRef({
        contextRefId: "context-ref-1",
        source: { ...source, resourceId: "" },
        target,
        relationType: "derived_from",
      })
    ).toThrow("source.resourceId is required");
    expect(() =>
      createContextRef({
        contextRefId: "context-ref-1",
        source,
        target,
        relationType: "",
      })
    ).toThrow("relationType is required");
  });
});
