import { describe, expect, it, vi } from "vitest";

import { ContextPriority } from "../context/index.js";
import type {
  AuthorizationDecision,
  AuthorizationRequest,
  PrincipalContext,
  RuntimeScope,
} from "../runtime/authorization/index.js";
import { MemoryContextProvider } from "./context/memory-context-provider.js";
import {
  MemoryGovernanceService,
  type MemoryAuthorizer,
} from "./governance/memory-governance-service.js";
import { resolveMemoryPrecedence } from "./governance/relation-classifier.js";
import { MemoryWritePolicy } from "./governance/write-policy.js";
import { InMemoryStoreAdapter } from "./store/in-memory-adapter.js";
import type {
  LongTermMemoryRecord,
  MemoryCandidate,
  MemoryNamespace,
} from "./types.js";

const NOW = "2026-01-10T00:00:00.000Z";
const principal: PrincipalContext = {
  principalId: "principal-a",
  principalType: "user",
  tenantId: "tenant-a",
  roles: [],
  scopes: [],
  authSource: "trusted_gateway",
  authenticatedAt: "2026-01-01T00:00:00.000Z",
};

function runtimeScope(scopeId = "scope-a", tenantId = "tenant-a"): RuntimeScope {
  return { scopeId, scopeType: "conversation", tenantId };
}

function namespace(
  scopeId = "scope-a",
  tenantId = "tenant-a"
): MemoryNamespace {
  return {
    tenantId,
    principalId: "principal-a",
    scopeId,
  };
}

function authorizationDecision(
  request: AuthorizationRequest,
  effect: "allow" | "deny"
): AuthorizationDecision {
  return {
    decisionId: `decision-${request.action}-${request.resource.resourceId}`,
    effect,
    reasonCode: effect === "allow" ? "POLICY_ALLOWED" : "SCOPE_NOT_WRITABLE",
    createdAt: NOW,
  };
}

function scopedAuthorizer(): MemoryAuthorizer {
  return {
    authorize: vi.fn(async (request) => {
      const sameTenant =
        request.principal.tenantId === request.resource.tenantId &&
        request.scope.tenantId === request.resource.tenantId;
      const ownsScope = request.scope.scopeId === request.resource.ownerScopeId;
      const writable = request.scope.scopeId !== "visible-only";
      const allowed =
        sameTenant && ownsScope && (request.action === "read" || writable);
      return authorizationDecision(request, allowed ? "allow" : "deny");
    }),
  };
}

function memoryRecord(
  memoryId: string,
  targetNamespace: MemoryNamespace,
  overrides: Partial<LongTermMemoryRecord> = {}
): LongTermMemoryRecord {
  return {
    memoryId,
    namespace: targetNamespace,
    memoryType: "preference",
    value: memoryId,
    provenance: { source: "user_explicit" },
    confidence: 1,
    revision: "r1",
    recordedAt: "2026-01-09T00:00:00.000Z",
    createdAt: "2026-01-09T00:00:00.000Z",
    updatedAt: "2026-01-09T00:00:00.000Z",
    ...overrides,
  };
}

function memoryCandidate(
  targetNamespace: MemoryNamespace,
  value: unknown,
  idempotencyKey: string,
  overrides: Partial<MemoryCandidate> = {}
): MemoryCandidate {
  return {
    namespace: targetNamespace,
    memoryType: "preference",
    value,
    provenance: { source: "user_explicit" },
    confidence: 1,
    idempotencyKey,
    ...overrides,
  };
}

function createService(
  store: InMemoryStoreAdapter,
  maxCandidates = 10,
  maxTokens = 100
): MemoryGovernanceService {
  return new MemoryGovernanceService({
    store,
    authorizer: scopedAuthorizer(),
    writePolicy: new MemoryWritePolicy({
      sensitiveDataDetector: (value) => JSON.stringify(value).includes("credential"),
      minimumInferredConfidence: 0.8,
    }),
    relevance: {
      memoryTypeWeights: {
        preference: 1,
        negative_preference: 1,
        accepted_choice: 1,
        task_summary: 1,
        service_context: 1,
      },
      recencyHalfLifeMs: 86_400_000,
      maxCandidates,
      maxTokens,
      recallTimeoutMs: 1_000,
    },
    now: () => new Date(NOW),
    estimateTokens: () => 10,
  });
}

const durablePolicy = {
  consentGranted: true,
  retentionAllowed: true,
  contentKind: "durable" as const,
};

describe("long-term memory governance integration", () => {
  it("writes in thread A, recalls in thread B, and keeps visible distinct from writable", async () => {
    const store = new InMemoryStoreAdapter();
    const service = createService(store);
    const provider = new MemoryContextProvider(service);
    const sharedNamespace = namespace();

    expect(
      await service.commit({
        principal,
        scope: runtimeScope(),
        memoryId: "shared-memory",
        candidate: memoryCandidate(sharedNamespace, "compact", "thread-a-write"),
        policyContext: durablePolicy,
      })
    ).toMatchObject({ status: "committed" });
    const threadBBlocks = await provider.recall({
      principal: { ...principal },
      scope: runtimeScope(),
      namespace: sharedNamespace,
    });
    expect(threadBBlocks).toMatchObject([
      { priority: ContextPriority.P3, content: "compact" },
    ]);

    const visibleNamespace = namespace("visible-only");
    await store.put(
      visibleNamespace,
      "visible-memory",
      memoryRecord("visible-memory", visibleNamespace)
    );
    expect(
      await provider.recall({
        principal,
        scope: runtimeScope("visible-only"),
        namespace: visibleNamespace,
      })
    ).toHaveLength(1);
    expect(
      await service.commit({
        principal,
        scope: runtimeScope("visible-only"),
        memoryId: "visible-memory",
        candidate: memoryCandidate(
          visibleNamespace,
          "changed",
          "visible-write"
        ),
        expectedRevision: "r1",
        policyContext: durablePolicy,
      })
    ).toMatchObject({ status: "denied" });
  });

  it("denies cross-tenant recall and excludes expired or deleted records", async () => {
    const store = new InMemoryStoreAdapter();
    const service = createService(store);
    const provider = new MemoryContextProvider(service);
    const otherTenant = namespace("scope-a", "tenant-b");
    await store.put(
      otherTenant,
      "other-tenant",
      memoryRecord("other-tenant", otherTenant)
    );
    expect(
      await provider.recall({
        principal,
        scope: runtimeScope("scope-a", "tenant-a"),
        namespace: otherTenant,
      })
    ).toEqual([]);

    const owned = namespace();
    await store.put(
      owned,
      "expired",
      memoryRecord("expired", owned, {
        expiresAt: "2026-01-09T00:00:00.000Z",
      })
    );
    await store.put(owned, "deleted", memoryRecord("deleted", owned));
    await service.delete({
      principal,
      scope: runtimeScope(),
      namespace: owned,
      memoryId: "deleted",
    });
    expect(
      await provider.recall({ principal, scope: runtimeScope(), namespace: owned })
    ).toEqual([]);
  });

  it("rejects excluded writes and keeps a prior answer successful on store failure", async () => {
    const store = new InMemoryStoreAdapter();
    const service = createService(store);
    const targetNamespace = namespace();
    for (const contentKind of ["derivable", "ephemeral"] as const) {
      expect(
        await service.commit({
          principal,
          scope: runtimeScope(),
          memoryId: contentKind,
          candidate: memoryCandidate(
            targetNamespace,
            contentKind,
            `write-${contentKind}`
          ),
          policyContext: { ...durablePolicy, contentKind },
        })
      ).toMatchObject({ status: "rejected" });
    }

    const successfulAnswer = "answer already delivered";
    const failingStore = {
      get: vi.fn().mockRejectedValue(new Error("down")),
      put: vi.fn(),
      putIfRevision: vi.fn().mockRejectedValue(new Error("down")),
      search: vi.fn().mockRejectedValue(new Error("down")),
      delete: vi.fn().mockRejectedValue(new Error("down")),
    };
    const failingService = new MemoryGovernanceService({
      store: failingStore,
      authorizer: scopedAuthorizer(),
      writePolicy: new MemoryWritePolicy({
        sensitiveDataDetector: () => false,
        minimumInferredConfidence: 0.8,
      }),
      relevance: {
        memoryTypeWeights: {
          preference: 1,
          negative_preference: 1,
          accepted_choice: 1,
          task_summary: 1,
          service_context: 1,
        },
        recencyHalfLifeMs: 1,
        maxCandidates: 1,
        maxTokens: 1,
        recallTimeoutMs: 10,
      },
    });
    expect(
      await failingService.commit({
        principal,
        scope: runtimeScope(),
        memoryId: "failed-write",
        candidate: memoryCandidate(targetNamespace, "value", "failed-write"),
        policyContext: durablePolicy,
      })
    ).toMatchObject({ status: "store_error", retryable: true });
    expect(successfulAnswer).toBe("answer already delivered");
  });

  it("caps recall deterministically and keeps current intent/authority above memory", async () => {
    const store = new InMemoryStoreAdapter();
    const targetNamespace = namespace();
    await store.put(targetNamespace, "b", memoryRecord("b", targetNamespace));
    await store.put(targetNamespace, "a", memoryRecord("a", targetNamespace));
    await store.put(targetNamespace, "c", memoryRecord("c", targetNamespace));
    const service = createService(store, 3, 20);

    const first = await service.recall({
      principal,
      scope: runtimeScope(),
      namespace: targetNamespace,
    });
    const second = await service.recall({
      principal,
      scope: runtimeScope(),
      namespace: targetNamespace,
    });
    expect(first.map(({ record }) => record.memoryId)).toEqual(["a", "b"]);
    expect(second).toEqual(first);

    const remembered = memoryRecord("preference", targetNamespace, {
      value: "compact",
      provenance: { source: "model_inferred" },
      confidence: 0.4,
    });
    expect(
      resolveMemoryPrecedence({
        memory: remembered,
        currentTurnExplicit: "detailed",
      })
    ).toMatchObject({
      value: "detailed",
      source: "current_turn_explicit",
      memoryRelation: "supersedes",
      hardConstraint: false,
    });
    expect(
      resolveMemoryPrecedence({
        memory: remembered,
        currentAuthoritativeState: "canonical",
      })
    ).toMatchObject({
      value: "canonical",
      source: "current_authoritative_state",
      memoryRelation: "supersedes",
    });
  });
});
