import { describe, expect, it } from "vitest";

import type { ResourceRef } from "../authorization/resource-ref.js";
import { createEvidenceRef } from "./evidence-ref.js";

const resource: ResourceRef = {
  resourceType: "tool_execution",
  resourceId: "tool-execution-1",
  tenantId: "tenant-1",
  ownerScopeId: "scope-1",
};

describe("createEvidenceRef", () => {
  it("creates an evidence reference using the shared ResourceRef shape", () => {
    const evidence = createEvidenceRef({
      evidenceRefId: "evidence-1",
      decisionId: "decision-1",
      resource,
      role: "tool_result",
      resourceVersion: "v1",
      snapshotHash: "sha256:abc",
      now: () => new Date("2026-08-27T00:00:00.000Z"),
    });

    expect(evidence).toEqual({
      evidenceRefId: "evidence-1",
      decisionId: "decision-1",
      resource,
      role: "tool_result",
      observedAt: "2026-08-27T00:00:00.000Z",
      resourceVersion: "v1",
      snapshotHash: "sha256:abc",
    });
  });

  it("rejects an invalid evidence role at runtime", () => {
    expect(() =>
      createEvidenceRef({
        evidenceRefId: "evidence-1",
        decisionId: "decision-1",
        resource,
        role: "raw_output" as "input",
      })
    ).toThrow("role must be a valid evidence role");
  });

  it("rejects a resource without tenant ownership", () => {
    expect(() =>
      createEvidenceRef({
        evidenceRefId: "evidence-1",
        decisionId: "decision-1",
        resource: { ...resource, tenantId: "" },
        role: "supporting",
      })
    ).toThrow("resource.tenantId is required");
  });

  it("keeps evidence as references and does not store raw payload fields", () => {
    const evidence = createEvidenceRef({
      evidenceRefId: "evidence-1",
      decisionId: "decision-1",
      resource,
      role: "tool_result",
      snapshotHash: "sha256:abc",
    });

    expect(evidence.resource.resourceType).toBe("tool_execution");
    expect(evidence).not.toHaveProperty("rawPayload");
    expect(evidence).not.toHaveProperty("toolOutput");
    expect(evidence).not.toHaveProperty("credential");
  });
});
