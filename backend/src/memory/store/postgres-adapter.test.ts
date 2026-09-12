import { describe, expect, it, vi } from "vitest";

import type { LongTermMemoryRecord, MemoryNamespace } from "../types.js";
import {
  PostgresAtomicRevisionWriter,
  PostgresStoreAdapter,
  type AtomicRevisionWriter,
  type PostgresStoreClient,
} from "./postgres-adapter.js";

const namespace: MemoryNamespace = {
  tenantId: "tenant-a",
  principalId: "principal-a",
  scopeId: "scope-a",
};

function record(revision: string): LongTermMemoryRecord {
  return {
    memoryId: "memory-1",
    namespace,
    memoryType: "preference",
    value: "compact",
    provenance: { source: "user_explicit" },
    confidence: 1,
    revision,
    recordedAt: "2026-01-02T00:00:00.000Z",
    createdAt: "2026-01-02T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  };
}

describe("PostgresStoreAdapter", () => {
  it("maps CRUD/search through an injected PostgresStore client", async () => {
    const client: PostgresStoreClient = {
      get: vi.fn().mockResolvedValue({ value: record("r1") }),
      put: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue([
        { value: record("r1") },
        { value: { ...record("r2"), memoryType: "task_summary" } },
      ]),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const atomicWriter: AtomicRevisionWriter = {
      putIfRevision: vi.fn().mockResolvedValue(true),
    };
    const inspectBeforeStore = vi.fn();
    const adapter = new PostgresStoreAdapter({
      client,
      atomicWriter,
      inspectBeforeStore,
    });

    expect((await adapter.get(namespace, "memory-1"))?.revision).toBe("r1");
    await adapter.put(namespace, "memory-1", record("r1"));
    expect(inspectBeforeStore).toHaveBeenCalledTimes(1);
    expect(
      await adapter.search(namespace, {
        memoryTypes: ["task_summary"],
        limit: 1,
      })
    ).toHaveLength(1);
    expect(
      await adapter.putIfRevision(
        namespace,
        "memory-1",
        record("r2"),
        "r1"
      )
    ).toBe(true);
    expect(inspectBeforeStore).toHaveBeenCalledTimes(2);
    await adapter.delete(namespace, "memory-1");
    expect(client.delete).toHaveBeenCalledTimes(1);
  });

  it("does not write when the shared pre-store inspector rejects", async () => {
    const client: PostgresStoreClient = {
      get: vi.fn(),
      put: vi.fn(),
      search: vi.fn(),
      delete: vi.fn(),
    };
    const adapter = new PostgresStoreAdapter({
      client,
      atomicWriter: { putIfRevision: vi.fn() },
      inspectBeforeStore: () => {
        throw new Error("sensitive memory rejected");
      },
    });

    await expect(adapter.put(namespace, "memory-1", record("r1"))).rejects.toThrow(
      /sensitive/
    );
    expect(client.put).not.toHaveBeenCalled();
  });

  it("uses one parameterized guarded SQL statement for CAS", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1 });
    const writer = new PostgresAtomicRevisionWriter(
      { query, end: vi.fn().mockResolvedValue(undefined) },
      "memory_store"
    );

    await expect(
      writer.putIfRevision({
        namespace: [
          "memory",
          "tenant-a",
          "principal-a",
          "no-domain",
          "scope-a",
        ],
        key: "memory-1",
        record: record("r2"),
        expectedRevision: "r1",
      })
    ).resolves.toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toContain("value->>'revision' = $5");
    expect(query.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining(["memory-1", "r1"])
    );
    expect(
      () =>
        new PostgresAtomicRevisionWriter(
          { query, end: vi.fn().mockResolvedValue(undefined) },
          'unsafe";DROP TABLE store;--'
        )
    ).toThrow(/safe SQL identifier/);
  });
});
