import { describe, expect, it, vi } from "vitest";

import {
  ContextPriority,
  allocateBudget,
  createDefaultBudgetConfig,
  prepareBlocks,
} from "../../context/index.js";
import type {
  PrincipalContext,
  RuntimeScope,
} from "../../runtime/authorization/index.js";
import type { MemoryRecallItem } from "../governance/memory-governance-service.js";
import { MemoryContextProvider } from "./memory-context-provider.js";

const principal: PrincipalContext = {
  principalId: "principal-a",
  principalType: "user",
  tenantId: "tenant-a",
  roles: [],
  scopes: [],
  authSource: "trusted_gateway",
  authenticatedAt: "2026-01-01T00:00:00.000Z",
};
const scope: RuntimeScope = {
  scopeId: "scope-a",
  scopeType: "conversation",
  tenantId: "tenant-a",
};
const namespace = {
  tenantId: "tenant-a",
  principalId: "principal-a",
  scopeId: "scope-a",
};

const recalled: MemoryRecallItem = {
  record: {
    memoryId: "memory-1",
    namespace,
    memoryType: "preference",
    value: { responseStyle: "compact" },
    provenance: { source: "user_explicit" },
    confidence: 1,
    revision: "r1",
    recordedAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  score: 1,
  estimatedTokens: 10,
};

describe("MemoryContextProvider", () => {
  it("turns recalled memory into P3 blocks with safe metadata", async () => {
    const governance = { recall: vi.fn().mockResolvedValue([recalled]) };
    const provider = new MemoryContextProvider(governance);

    const blocks = await provider.recall({ principal, scope, namespace });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      priority: ContextPriority.P3,
      metadata: {
        memoryId: "memory-1",
        namespace,
        provenance: { source: "user_explicit" },
        confidence: 1,
        revision: "r1",
      },
    });
    expect(blocks[0]?.priority).not.toBe(ContextPriority.P0);
    expect(blocks[0]?.priority).not.toBe(ContextPriority.P1);
  });

  it("enters existing priority-first allocation while P0/P1 remain ahead", async () => {
    const governance = { recall: vi.fn().mockResolvedValue([recalled]) };
    const provider = new MemoryContextProvider(governance);
    const [memoryBlock] = await provider.recall({ principal, scope, namespace });
    const higherPriority = prepareBlocks([
      { priority: ContextPriority.P0, label: "system", content: "always" },
      { priority: ContextPriority.P1, label: "task", content: "required" },
    ]);
    const allocation = allocateBudget(
      [...higherPriority, memoryBlock!],
      createDefaultBudgetConfig({ totalTokenBudget: 4 })
    );

    expect(allocation.includedBlocks.map(({ priority }) => priority)).toEqual([
      ContextPriority.P0,
      ContextPriority.P1,
    ]);
    expect(allocation.trimmedBlocks).toContain(memoryBlock);
  });
});
