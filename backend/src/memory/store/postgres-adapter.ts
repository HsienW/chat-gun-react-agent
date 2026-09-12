import { PostgresStore } from "@langchain/langgraph-checkpoint-postgres/store";
import { Pool } from "pg";

import type { LongTermMemoryRecord, MemoryNamespace } from "../types.js";
import type { MemorySearchFilter, MemoryStorePort } from "../store-port.js";
import {
  assertMemoryRecordLocation,
  parseStoredRecord,
  recordMatchesFilter,
  serializeMemoryNamespace,
} from "../store-port.js";

export interface PostgresStoreItem {
  value: Record<string, unknown>;
}

export interface PostgresStoreClient {
  get(namespace: string[], key: string): Promise<PostgresStoreItem | null>;
  put(
    namespace: string[],
    key: string,
    value: Record<string, unknown>,
    index?: false | string[],
    options?: { ttl?: number }
  ): Promise<void>;
  search(
    namespace: string[],
    options?: {
      filter?: Record<string, unknown>;
      limit?: number;
      offset?: number;
    }
  ): Promise<PostgresStoreItem[]>;
  delete(namespace: string[], key: string): Promise<void>;
  setup?(): Promise<void>;
  stop?(): Promise<void>;
}

export interface AtomicRevisionWrite {
  namespace: readonly string[];
  key: string;
  record: LongTermMemoryRecord;
  expectedRevision?: string;
}

export interface AtomicRevisionWriter {
  putIfRevision(input: AtomicRevisionWrite): Promise<boolean>;
  stop?(): Promise<void>;
}

export type PreStoreInspector = (
  record: Readonly<LongTermMemoryRecord>
) => void | Promise<void>;

export interface PostgresStoreAdapterOptions {
  client: PostgresStoreClient;
  atomicWriter: AtomicRevisionWriter;
  inspectBeforeStore?: PreStoreInspector;
}

export interface PostgresStoreConnectionOptions {
  connectionString: string;
  schema: string;
  ensureTables?: boolean;
  inspectBeforeStore?: PreStoreInspector;
}

interface QueryResultLike {
  rowCount: number | null;
}

interface QueryClient {
  query(
    queryText: string,
    values: readonly unknown[]
  ): Promise<QueryResultLike>;
  end(): Promise<void>;
}

const SAFE_SCHEMA_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export class PostgresAtomicRevisionWriter implements AtomicRevisionWriter {
  constructor(
    private readonly client: QueryClient,
    private readonly schema: string
  ) {
    if (!SAFE_SCHEMA_PATTERN.test(schema)) {
      throw new Error("PostgresStore schema must be a safe SQL identifier");
    }
  }

  async putIfRevision(input: AtomicRevisionWrite): Promise<boolean> {
    const namespacePath = input.namespace.join(":");
    const expiresAt = input.record.expiresAt ?? null;
    const serialized = JSON.stringify(input.record);
    const table = `"${this.schema}".store`;

    const result =
      input.expectedRevision === undefined
        ? await this.client.query(
            `INSERT INTO ${table} (namespace_path, key, value, expires_at)
             VALUES ($1, $2, $3::jsonb, $4)
             ON CONFLICT (namespace_path, key) DO NOTHING
             RETURNING key`,
            [namespacePath, input.key, serialized, expiresAt]
          )
        : await this.client.query(
            `UPDATE ${table}
                SET value = $3::jsonb,
                    expires_at = $4,
                    updated_at = CURRENT_TIMESTAMP
              WHERE namespace_path = $1
                AND key = $2
                AND value->>'revision' = $5
              RETURNING key`,
            [
              namespacePath,
              input.key,
              serialized,
              expiresAt,
              input.expectedRevision,
            ]
          );
    return result.rowCount === 1;
  }

  async stop(): Promise<void> {
    await this.client.end();
  }
}

function nativeTtlOptions(
  expiresAt: string | undefined
): { ttl?: number } | undefined {
  if (expiresAt === undefined) return undefined;
  const ttlMinutes = (Date.parse(expiresAt) - Date.now()) / 60_000;
  return ttlMinutes > 0 ? { ttl: ttlMinutes } : undefined;
}

export class PostgresStoreAdapter implements MemoryStorePort {
  private readonly client: PostgresStoreClient;
  private readonly atomicWriter: AtomicRevisionWriter;
  private readonly inspectBeforeStore: PreStoreInspector;

  constructor(options: PostgresStoreAdapterOptions) {
    this.client = options.client;
    this.atomicWriter = options.atomicWriter;
    this.inspectBeforeStore = options.inspectBeforeStore ?? (() => undefined);
  }

  static fromConnectionString(
    options: PostgresStoreConnectionOptions
  ): PostgresStoreAdapter {
    if (options.connectionString.trim().length === 0) {
      throw new Error("PostgresStore connectionString is required");
    }
    if (!SAFE_SCHEMA_PATTERN.test(options.schema)) {
      throw new Error("PostgresStore schema must be a safe SQL identifier");
    }
    const client = PostgresStore.fromConnString(options.connectionString, {
      schema: options.schema,
      ensureTables: options.ensureTables ?? true,
    });
    const pool = new Pool({ connectionString: options.connectionString });
    return new PostgresStoreAdapter({
      client,
      atomicWriter: new PostgresAtomicRevisionWriter(pool, options.schema),
      ...(options.inspectBeforeStore === undefined
        ? {}
        : { inspectBeforeStore: options.inspectBeforeStore }),
    });
  }

  async setup(): Promise<void> {
    await this.client.setup?.();
  }

  async stop(): Promise<void> {
    await this.client.stop?.();
    await this.atomicWriter.stop?.();
  }

  async get(
    namespace: MemoryNamespace,
    key: string
  ): Promise<LongTermMemoryRecord | undefined> {
    const item = await this.client.get(serializeMemoryNamespace(namespace), key);
    return item === null ? undefined : parseStoredRecord(item.value);
  }

  async put(
    namespace: MemoryNamespace,
    key: string,
    record: LongTermMemoryRecord
  ): Promise<void> {
    const validated = parseStoredRecord(record);
    assertMemoryRecordLocation(namespace, key, validated);
    await this.inspectBeforeStore(validated);
    await this.client.put(
      serializeMemoryNamespace(namespace),
      key,
      { ...validated },
      false,
      nativeTtlOptions(validated.expiresAt)
    );
  }

  async putIfRevision(
    namespace: MemoryNamespace,
    key: string,
    record: LongTermMemoryRecord,
    expectedRevision?: string
  ): Promise<boolean> {
    const validated = parseStoredRecord(record);
    assertMemoryRecordLocation(namespace, key, validated);
    await this.inspectBeforeStore(validated);
    return this.atomicWriter.putIfRevision({
      namespace: serializeMemoryNamespace(namespace),
      key,
      record: validated,
      ...(expectedRevision === undefined ? {} : { expectedRevision }),
    });
  }

  async search(
    namespace: MemoryNamespace,
    filter: MemorySearchFilter = {}
  ): Promise<LongTermMemoryRecord[]> {
    const nativeFilter = {
      ...(filter.memoryTypes === undefined
        ? {}
        : { memoryType: { $in: [...filter.memoryTypes] } }),
      ...(filter.idempotencyKey === undefined
        ? {}
        : { idempotencyKey: filter.idempotencyKey }),
    };
    const items = await this.client.search(serializeMemoryNamespace(namespace), {
      ...(Object.keys(nativeFilter).length === 0
        ? {}
        : { filter: nativeFilter }),
      ...(filter.limit === undefined ? {} : { limit: filter.limit }),
    });
    const records = items
      .map((item) => parseStoredRecord(item.value))
      .filter((record) => recordMatchesFilter(record, filter));
    return filter.limit === undefined ? records : records.slice(0, filter.limit);
  }

  async delete(namespace: MemoryNamespace, key: string): Promise<void> {
    await this.client.delete(serializeMemoryNamespace(namespace), key);
  }
}
