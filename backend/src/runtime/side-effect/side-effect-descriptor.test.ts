import { describe, expect, it, vi } from "vitest";

import type {
  SideEffectToolDescriptor,
  TrustedScope,
} from "./side-effect-descriptor.js";

type TestInput = { resourceId: string };
type TestResult = { operationId: string };

const scope: TrustedScope = {
  scopeId: "scope-1",
  tenantId: "tenant-1",
  principalId: "principal-1",
};

describe("SideEffectToolDescriptor", () => {
  it("delegates business-effect identity to the tool-owned descriptor", () => {
    const deriveBusinessEffectKey = vi.fn(
      (input: TestInput, trustedScope: TrustedScope) =>
        `${trustedScope.tenantId}:${input.resourceId}`
    );
    const descriptor: SideEffectToolDescriptor<TestInput, TestResult> = {
      toolName: "registered_side_effect",
      toolVersion: "1",
      deriveBusinessEffectKey,
      resultReferencePolicy: {
        toResultRef: (result) => ({
          resultHash: result.operationId,
          payloadRef: `payload://${result.operationId}`,
        }),
        resolveResultRef: async () => null,
        isReusable: (cacheState) => cacheState === "reusable",
      },
    };

    expect(
      descriptor.deriveBusinessEffectKey({ resourceId: "resource-1" }, scope)
    ).toBe("tenant-1:resource-1");
    expect(deriveBusinessEffectKey).toHaveBeenCalledWith(
      { resourceId: "resource-1" },
      scope
    );
    expect(descriptor.reconcile).toBeUndefined();
  });
});
