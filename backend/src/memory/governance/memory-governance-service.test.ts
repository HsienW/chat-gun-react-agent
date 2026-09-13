import { describe, expect, it, vi } from "vitest";

import type {
  AuthorizationDecision,
  AuthorizationRequest,
  PrincipalContext,
  RuntimeScope,
} from "../../runtime/authorization/index.js";
import { InMemoryStoreAdapter } from "../store/in-memory-adapter.js";
import type { LongTermMemoryRecord, MemoryCandidate } from "../types.js";
import {
  MemoryGovernanceService,
  type MemoryAuthorizer,
  type MemoryTelemetryEvent,
} from "./memory-governance-service.js";
import { MemoryWritePolicy } from "./write-policy.js";

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
const now = new Date("2026-01-10T00:00:00.000Z");

function decision(
  request: AuthorizationRequest,
  effect: "allow" | "deny"
): AuthorizationDecision {
  return {
    decisionId: `decision-${request.resource.resourceId}`,
    effect,
    reasonCode: effect === "allow" ? "POLICY_ALLOWED" : "ACTION_NOT_ALLOWED",
    createdAt: now.toISOString(),
  };
}

function authorizer(
  resolve: (request: AuthorizationRequest) => "allow" | "deny" = () => "allow"
): MemoryAuthorizer {
  return {
    authorize: vi.fn(async (request) => decision(request, resolve(request))),
  };
}

function record(
  memoryId: string,
  overrides: Partial<LongTermMemoryRecord> = {}
): LongTermMemoryRecord {
  return {
    memoryId,
    namespace,
    memoryType: "preference",
    value: { responseStyle: memoryId },
    provenance: { source: "user_explicit" },
    confidence: 1,
    revision: "r1",
    recordedAt: "2026-01-09T00:00:00.000Z",
    createdAt: "2026-01-09T00:00:00.000Z",
    updatedAt: "2026-01-09T00:00:00.000Z",
    ...overrides,
  };
}

function candidate(value: unknown, idempotencyKey: string): MemoryCandidate {
  return {
    namespace,
    memoryType: "preference",
    value,
    provenance: { source: "user_explicit" },
    confidence: 1,
    idempotencyKey,
  };
}

function createService(options: {
  store?: InMemoryStoreAdapter;
  auth?: MemoryAuthorizer;
  telemetry?: (event: MemoryTelemetryEvent) => void;
  maxCandidates?: number;
  maxTokens?: number;
} = {}) {
  return new MemoryGovernanceService({
    store: options.store ?? new InMemoryStoreAdapter(),
    authorizer: options.auth ?? authorizer(),
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
      recencyHalfLifeMs: 86_400_000,
      maxCandidates: options.maxCandidates ?? 10,
      maxTokens: options.maxTokens ?? 100,
      recallTimeoutMs: 1_000,
    },
    now: () => now,
    estimateTokens: () => 10,
    telemetry: options.telemetry,
  });
}

const policyContext = {
  consentGranted: true,
  retentionAllowed: true,
  contentKind: "durable" as const,
};

describe("MemoryGovernanceService", () => {
  it("rejects relevance configs with unknown memory-type weights", () => {
    const weights = {
      preference: 1,
      negative_preference: 1,
      accepted_choice: 1,
      task_summary: 1,
      service_context: 1,
      unexpected: 1,
    };
    expect(
      () =>
        new MemoryGovernanceService({
          store: new InMemoryStoreAdapter(),
          authorizer: authorizer(),
          writePolicy: new MemoryWritePolicy({
            sensitiveDataDetector: () => false,
            minimumInferredConfidence: 0.8,
          }),
          relevance: {
            memoryTypeWeights: weights,
            recencyHalfLifeMs: 1,
            maxCandidates: 1,
            maxTokens: 1,
            recallTimeoutMs: 1,
          },
        })
    ).toThrow(/exactly every memory type/);
  });

  it("fails closed before Store I/O when trusted identity and namespace differ", async () => {
    const store = new InMemoryStoreAdapter();
    const search = vi.spyOn(store, "search");
    const service = createService({ store });

    expect(
      await service.recall({
        principal: { ...principal, principalId: "principal-b" },
        scope,
        namespace,
      })
    ).toEqual([]);
    expect(search).not.toHaveBeenCalled();
  });

  it("authorizes each record, filters expiry, and orders/caps deterministically", async () => {
    const store = new InMemoryStoreAdapter();
    await store.put(namespace, "b", record("b"));
    await store.put(namespace, "a", record("a"));
    await store.put(
      namespace,
      "expired",
      record("expired", { expiresAt: "2026-01-09T00:00:00.000Z" })
    );
    const auth = authorizer((request) =>
      request.resource.resourceId === "b" ? "deny" : "allow"
    );
    const events: MemoryTelemetryEvent[] = [];
    const service = createService({
      store,
      auth,
      maxCandidates: 3,
      maxTokens: 10,
      telemetry: (event) => events.push(event),
    });

    const recalled = await service.recall({ principal, scope, namespace });
    expect(recalled.map(({ record: item }) => item.memoryId)).toEqual(["a"]);
    expect(auth.authorize).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(events)).not.toContain("responseStyle");
  });

  it("expands related memories through one direct resolver hop only", async () => {
    const base = record("base");
    const related = record("related");
    const store = {
      get: vi.fn().mockResolvedValue(related),
      put: vi.fn(),
      putIfRevision: vi.fn(),
      search: vi.fn().mockResolvedValue([base]),
      delete: vi.fn(),
    };
    const findRelated = vi.fn().mockResolvedValue([
      {
        resourceType: "memory",
        resourceId: "related",
        tenantId: "tenant-a",
        ownerScopeId: "scope-a",
      },
    ]);
    const service = new MemoryGovernanceService({
      store,
      authorizer: authorizer(),
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
        maxCandidates: 2,
        maxTokens: 100,
        recallTimeoutMs: 100,
      },
      referenceResolver: { findRelated },
      now: () => now,
      estimateTokens: () => 1,
    });

    expect(
      (await service.recall({ principal, scope, namespace })).map(
        ({ record: item }) => item.memoryId
      )
    ).toEqual(["base", "related"]);
    expect(findRelated).toHaveBeenCalledTimes(1);
  });

  it("degrades a recall timeout to an observable empty result", async () => {
    const events: MemoryTelemetryEvent[] = [];
    const never = new Promise<LongTermMemoryRecord[]>(() => undefined);
    const service = new MemoryGovernanceService({
      store: {
        get: vi.fn(),
        put: vi.fn(),
        putIfRevision: vi.fn(),
        search: vi.fn().mockReturnValue(never),
        delete: vi.fn(),
      },
      authorizer: authorizer(),
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
        recallTimeoutMs: 20,
      },
      telemetry: (event) => events.push(event),
    });

    expect(await service.recall({ principal, scope, namespace })).toEqual([]);
    expect(events).toContainEqual(
      expect.objectContaining({ kind: "recall_degraded", reason: "timeout" })
    );
  });

  it("enforces write/delete authorization and one-winner CAS", async () => {
    const store = new InMemoryStoreAdapter();
    const auth = authorizer((request) =>
      request.action === "read" || request.resource.resourceId !== "denied"
        ? "allow"
        : "deny"
    );
    const service = createService({ store, auth });
    const first = await service.commit({
      principal,
      scope,
      memoryId: "memory-1",
      candidate: candidate("compact", "write-1"),
      policyContext,
    });
    expect(first.status).toBe("committed");

    const writes = await Promise.all([
      service.commit({
        principal,
        scope,
        memoryId: "memory-1",
        candidate: candidate("detailed", "write-2"),
        expectedRevision: "r1",
        policyContext,
      }),
      service.commit({
        principal,
        scope,
        memoryId: "memory-1",
        candidate: candidate("friendly", "write-3"),
        expectedRevision: "r1",
        policyContext,
      }),
    ]);
    expect(writes.map(({ status }) => status).sort()).toEqual([
      "committed",
      "conflict",
    ]);

    expect(
      await service.commit({
        principal,
        scope,
        memoryId: "denied",
        candidate: candidate("blocked", "write-denied"),
        policyContext,
      })
    ).toMatchObject({ status: "denied" });
    expect(
      await service.delete({ principal, scope, namespace, memoryId: "denied" })
    ).toMatchObject({ status: "denied" });
  });

  it("deduplicates an idempotency key after the service is reconstructed", async () => {
    const store = new InMemoryStoreAdapter();
    const firstService = createService({ store });
    expect(
      await firstService.commit({
        principal,
        scope,
        memoryId: "memory-1",
        candidate: candidate("compact", "durable-idempotency"),
        policyContext,
      })
    ).toMatchObject({ status: "committed" });

    const reconstructedService = createService({ store });
    expect(
      await reconstructedService.commit({
        principal,
        scope,
        memoryId: "memory-2",
        candidate: candidate("different", "durable-idempotency"),
        policyContext,
      })
    ).toMatchObject({
      status: "duplicate",
      reason: "idempotency_key_reused",
    });
    expect(await store.get(namespace, "memory-2")).toBeUndefined();
  });

  it("keeps Decision Provenance failures out of the commit gate", async () => {
    const store = new InMemoryStoreAdapter();
    await store.put(namespace, "memory-1", record("memory-1"));
    const service = new MemoryGovernanceService({
      store,
      authorizer: authorizer(),
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
        maxCandidates: 10,
        maxTokens: 100,
        recallTimeoutMs: 100,
      },
      now: () => now,
      decisionRecorder: vi.fn().mockRejectedValue(new Error("provenance down")),
    });

    expect(
      await service.commit({
        principal,
        scope,
        memoryId: "memory-1",
        candidate: candidate("detailed", "decision-failure"),
        expectedRevision: "r1",
        policyContext,
      })
    ).toMatchObject({ status: "committed", record: { revision: "r2" } });
  });

  it("preserves immutable history, restores via a new revision, and queries time", async () => {
    const service = createService();
    await service.commit({
      principal,
      scope,
      memoryId: "memory-1",
      candidate: candidate("compact", "write-1"),
      policyContext,
    });
    await service.commit({
      principal,
      scope,
      memoryId: "memory-1",
      candidate: candidate("detailed", "write-2"),
      expectedRevision: "r1",
      policyContext,
    });

    const restored = await service.restore({
      principal,
      scope,
      namespace,
      memoryId: "memory-1",
      revision: "r1",
      idempotencyKey: "restore-1",
      policyContext,
    });
    expect(restored).toMatchObject({ status: "committed", record: { revision: "r3" } });
    expect(
      await service.getAtTime({
        principal,
        scope,
        namespace,
        memoryId: "memory-1",
        query: {
          recordedAtOrBefore: "2026-01-10T00:00:00.000Z",
          revision: "r1",
        },
      })
    ).toMatchObject({ revision: "r1", value: "compact" });
  });

  it("degrades recall failures, propagates cancellation, and reports write failure", async () => {
    const events: MemoryTelemetryEvent[] = [];
    const failingStore = {
      get: vi.fn().mockRejectedValue(new Error("store down")),
      put: vi.fn().mockRejectedValue(new Error("store down")),
      putIfRevision: vi.fn().mockRejectedValue(new Error("store down")),
      search: vi.fn().mockRejectedValue(new Error("store down")),
      delete: vi.fn().mockRejectedValue(new Error("store down")),
    };
    const service = new MemoryGovernanceService({
      store: failingStore,
      authorizer: authorizer(),
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
      telemetry: (event) => events.push(event),
    });

    expect(await service.recall({ principal, scope, namespace })).toEqual([]);
    expect(
      await service.commit({
        principal,
        scope,
        memoryId: "memory-1",
        candidate: candidate("compact", "write-failed"),
        policyContext,
      })
    ).toMatchObject({ status: "store_error", retryable: true });
    const controller = new AbortController();
    controller.abort();
    await expect(
      service.recall({ principal, scope, namespace, signal: controller.signal })
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(events.some(({ kind }) => kind === "recall_degraded")).toBe(true);
    expect(events.some(({ kind }) => kind === "write_failed")).toBe(true);
  });
});
