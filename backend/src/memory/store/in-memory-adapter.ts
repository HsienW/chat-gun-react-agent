import { InMemoryStore } from "@langchain/langgraph-checkpoint";

import type { LongTermMemoryRecord, MemoryNamespace } from "../types.js";
import type { MemorySearchFilter, MemoryStorePort } from "../store-port.js";
import {
  assertMemoryRecordLocation,
  parseStoredRecord,
  recordMatchesFilter,
  serializeMemoryNamespace,
} from "../store-port.js";

type Unlock = () => void;

export class InMemoryStoreAdapter implements MemoryStorePort {
  private readonly store: InMemoryStore;
  private readonly lockTails = new Map<string, Promise<void>>();

  constructor(store: InMemoryStore = new InMemoryStore()) {
    this.store = store;
  }

  async get(
    namespace: MemoryNamespace,
    key: string
  ): Promise<LongTermMemoryRecord | undefined> {
    const item = await this.store.get(serializeMemoryNamespace(namespace), key);
    return item === null ? undefined : parseStoredRecord(item.value);
  }

  async put(
    namespace: MemoryNamespace,
    key: string,
    record: LongTermMemoryRecord
  ): Promise<void> {
    const validated = parseStoredRecord(record);
    assertMemoryRecordLocation(namespace, key, validated);
    await this.store.put(serializeMemoryNamespace(namespace), key, {
      ...validated,
    });
  }

  async putIfRevision(
    namespace: MemoryNamespace,
    key: string,
    record: LongTermMemoryRecord,
    expectedRevision?: string
  ): Promise<boolean> {
    assertMemoryRecordLocation(namespace, key, record);
    const release = await this.acquireLock(namespace, key);
    try {
      const current = await this.get(namespace, key);
      if (current?.revision !== expectedRevision) return false;
      await this.put(namespace, key, record);
      return true;
    } finally {
      release();
    }
  }

  async search(
    namespace: MemoryNamespace,
    filter: MemorySearchFilter = {}
  ): Promise<LongTermMemoryRecord[]> {
    const namespaceTuple = serializeMemoryNamespace(namespace);
    const metadataFilter =
      filter.idempotencyKey === undefined
        ? {}
        : { idempotencyKey: filter.idempotencyKey };
    const groups = filter.memoryTypes?.length
      ? await Promise.all(
          filter.memoryTypes.map((memoryType) =>
            this.store.search(namespaceTuple, {
              filter: { ...metadataFilter, memoryType },
              ...(filter.limit === undefined ? {} : { limit: filter.limit }),
            })
          )
        )
      : [
          await this.store.search(namespaceTuple, {
            ...(Object.keys(metadataFilter).length === 0
              ? {}
              : { filter: metadataFilter }),
            ...(filter.limit === undefined ? {} : { limit: filter.limit }),
          }),
        ];
    const records = groups
      .flat()
      .map((item) => parseStoredRecord(item.value))
      .filter((record) => recordMatchesFilter(record, filter))
      .sort(
        (left, right) =>
          left.recordedAt.localeCompare(right.recordedAt) ||
          left.memoryId.localeCompare(right.memoryId)
      );
    return filter.limit === undefined
      ? records
      : records.slice(0, filter.limit);
  }

  async delete(namespace: MemoryNamespace, key: string): Promise<void> {
    await this.store.delete(serializeMemoryNamespace(namespace), key);
  }

  private async acquireLock(
    namespace: MemoryNamespace,
    key: string
  ): Promise<Unlock> {
    const lockKey = `${serializeMemoryNamespace(namespace).join("\u0000")}\u0000${key}`;
    const previous = this.lockTails.get(lockKey) ?? Promise.resolve();
    let releaseCurrent: Unlock = () => undefined;
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    const tail = previous.then(() => current);
    this.lockTails.set(lockKey, tail);
    await previous;
    return () => {
      releaseCurrent();
      if (this.lockTails.get(lockKey) === tail) {
        this.lockTails.delete(lockKey);
      }
    };
  }
}
