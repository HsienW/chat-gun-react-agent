import type {
  LongTermMemoryRecord,
  MemoryNamespace,
  MemoryType,
} from "./types.js";
import { parseLongTermMemoryRecord, parseMemoryNamespace } from "./types.js";
import { MEMORY_NAMESPACE_SENTINEL } from "./types.js";

export { MEMORY_NAMESPACE_SENTINEL } from "./types.js";
const MEMORY_NAMESPACE_ROOT = "memory";
const MEMORY_NAMESPACE_LENGTH = 5;

export interface MemorySearchFilter {
  memoryTypes?: readonly MemoryType[];
  idempotencyKey?: string;
  validAt?: string;
  recordedAtOrBefore?: string;
  limit?: number;
}

export interface MemoryStorePort {
  get(
    namespace: MemoryNamespace,
    key: string
  ): Promise<LongTermMemoryRecord | undefined>;
  put(
    namespace: MemoryNamespace,
    key: string,
    record: LongTermMemoryRecord
  ): Promise<void>;
  putIfRevision(
    namespace: MemoryNamespace,
    key: string,
    record: LongTermMemoryRecord,
    expectedRevision?: string
  ): Promise<boolean>;
  search(
    namespace: MemoryNamespace,
    filter?: MemorySearchFilter
  ): Promise<LongTermMemoryRecord[]>;
  delete(namespace: MemoryNamespace, key: string): Promise<void>;
}

function assertStoreSafeLabel(label: string): void {
  if (label.includes(".") || /[:%_\\]/u.test(label)) {
    throw new Error("memory namespace contains a reserved Store character");
  }
}

export function serializeMemoryNamespace(
  input: MemoryNamespace
): [string, string, string, string, string] {
  const namespace = parseMemoryNamespace(input);
  const domain = namespace.domain ?? MEMORY_NAMESPACE_SENTINEL;
  if (domain === MEMORY_NAMESPACE_SENTINEL && namespace.domain !== undefined) {
    throw new Error("namespace.domain uses the reserved sentinel");
  }
  const labels = [
    MEMORY_NAMESPACE_ROOT,
    namespace.tenantId,
    namespace.principalId,
    domain,
    namespace.scopeId,
  ] as const;
  labels.forEach(assertStoreSafeLabel);
  return [...labels];
}

export function deserializeMemoryNamespace(
  tuple: readonly string[]
): MemoryNamespace {
  if (
    tuple.length !== MEMORY_NAMESPACE_LENGTH ||
    tuple[0] !== MEMORY_NAMESPACE_ROOT
  ) {
    throw new Error("invalid memory namespace tuple");
  }
  tuple.forEach(assertStoreSafeLabel);
  const [, tenantId, principalId, domain, scopeId] = tuple;
  return parseMemoryNamespace({
    tenantId,
    principalId,
    ...(domain === MEMORY_NAMESPACE_SENTINEL ? {} : { domain }),
    scopeId,
  });
}

export function recordMatchesFilter(
  record: LongTermMemoryRecord,
  filter: MemorySearchFilter = {}
): boolean {
  if (
    filter.idempotencyKey !== undefined &&
    record.idempotencyKey !== filter.idempotencyKey
  ) {
    return false;
  }
  if (
    filter.memoryTypes !== undefined &&
    !filter.memoryTypes.includes(record.memoryType)
  ) {
    return false;
  }
  if (
    filter.recordedAtOrBefore !== undefined &&
    Date.parse(record.recordedAt) > Date.parse(filter.recordedAtOrBefore)
  ) {
    return false;
  }
  if (filter.validAt !== undefined) {
    const validAt = Date.parse(filter.validAt);
    if (record.validFrom !== undefined && Date.parse(record.validFrom) > validAt) {
      return false;
    }
    if (record.validUntil !== undefined && Date.parse(record.validUntil) <= validAt) {
      return false;
    }
  }
  return true;
}

export function assertMemoryRecordLocation(
  namespace: MemoryNamespace,
  key: string,
  record: LongTermMemoryRecord
): void {
  const expected = serializeMemoryNamespace(namespace);
  const actual = serializeMemoryNamespace(record.namespace);
  const sameNamespace = expected.every((label, index) => label === actual[index]);
  if (key !== record.memoryId || !sameNamespace) {
    throw new Error("memory record location does not match its key and namespace");
  }
}

export function parseStoredRecord(value: unknown): LongTermMemoryRecord {
  return parseLongTermMemoryRecord(value);
}
