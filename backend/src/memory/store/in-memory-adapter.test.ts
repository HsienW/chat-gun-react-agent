import { describe, expect, it } from "vitest";

import type { LongTermMemoryRecord, MemoryNamespace } from "../types.js";
import { InMemoryStoreAdapter } from "./in-memory-adapter.js";

const namespace: MemoryNamespace = {
  tenantId: "tenant-a",
  principalId: "principal-a",
  domain: "assistant",
  scopeId: "scope-a",
};

function record(
  memoryId: string,
  revision: string,
  memoryType: LongTermMemoryRecord["memoryType"] = "preference"
): LongTermMemoryRecord {
  return {
    memoryId,
    namespace,
    memoryType,
    value: { responseStyle: revision },
    provenance: { source: "user_explicit" },
    confidence: 1,
    revision,
    recordedAt: "2026-01-02T00:00:00.000Z",
    createdAt: "2026-01-02T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  };
}

describe("InMemoryStoreAdapter", () => {
  it("supports CRUD, overwrite, filters, and unknown namespaces", async () => {
    const store = new InMemoryStoreAdapter();
    await store.put(namespace, "memory-1", record("memory-1", "r1"));
    await store.put(
      namespace,
      "memory-2",
      record("memory-2", "r1", "task_summary")
    );

    expect((await store.get(namespace, "memory-1"))?.revision).toBe("r1");
    await store.put(namespace, "memory-1", record("memory-1", "r2"));
    expect((await store.get(namespace, "memory-1"))?.revision).toBe("r2");
    expect(
      await store.search(namespace, {
        memoryTypes: ["task_summary"],
        limit: 1,
      })
    ).toHaveLength(1);
    expect(
      await store.search({ ...namespace, scopeId: "missing" })
    ).toEqual([]);

    await store.delete(namespace, "memory-1");
    expect(await store.get(namespace, "memory-1")).toBeUndefined();
  });

  it("allows only one concurrent writer for the same expected revision", async () => {
    const store = new InMemoryStoreAdapter();
    await store.put(namespace, "memory-1", record("memory-1", "r1"));

    const results = await Promise.all([
      store.putIfRevision(
        namespace,
        "memory-1",
        record("memory-1", "r2"),
        "r1"
      ),
      store.putIfRevision(
        namespace,
        "memory-1",
        record("memory-1", "r3"),
        "r1"
      ),
    ]);

    expect(results.sort()).toEqual([false, true]);
  });

  it("rejects a record routed under a different key or namespace", async () => {
    const store = new InMemoryStoreAdapter();
    await expect(
      store.put(namespace, "different-key", record("memory-1", "r1"))
    ).rejects.toThrow(/location/);
    await expect(
      store.put(
        { ...namespace, scopeId: "other-scope" },
        "memory-1",
        record("memory-1", "r1")
      )
    ).rejects.toThrow(/location/);
  });
});
