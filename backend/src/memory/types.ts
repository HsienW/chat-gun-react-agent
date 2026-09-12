export const MEMORY_TYPES = [
  "preference",
  "negative_preference",
  "accepted_choice",
  "task_summary",
  "service_context",
] as const;

export const MEMORY_PROVENANCE_SOURCES = [
  "user_explicit",
  "user_feedback",
  "task_result",
  "model_inferred",
] as const;

export const MEMORY_RELATIONS = [
  "same",
  "supersedes",
  "conflicts",
  "coexists",
] as const;

export const MEMORY_READ_MODES = [
  "off",
  "writable_scopes",
  "visible_scopes",
] as const;

export const MEMORY_WRITE_MODES = ["off", "writable_scopes"] as const;
export const MEMORY_NAMESPACE_SENTINEL = "no-domain";

export type MemoryType = (typeof MEMORY_TYPES)[number];
export type MemoryProvenanceSource =
  (typeof MEMORY_PROVENANCE_SOURCES)[number];
export type MemoryRelation = (typeof MEMORY_RELATIONS)[number];
export type MemoryReadMode = (typeof MEMORY_READ_MODES)[number];
export type MemoryWriteMode = (typeof MEMORY_WRITE_MODES)[number];

export interface MemoryNamespace {
  tenantId: string;
  principalId: string;
  domain?: string;
  scopeId: string;
}

export interface MemoryProvenance {
  source: MemoryProvenanceSource;
  sourceRef?: string;
}

export interface MemoryRevisionSnapshot<TValue = unknown> {
  memoryId: string;
  namespace: MemoryNamespace;
  memoryType: MemoryType;
  value: TValue;
  provenance: MemoryProvenance;
  confidence: number;
  revision: string;
  validFrom?: string;
  validUntil?: string;
  recordedAt: string;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  idempotencyKey?: string;
}

export interface LongTermMemoryRecord<TValue = unknown>
  extends MemoryRevisionSnapshot<TValue> {
  history?: MemoryRevisionSnapshot<TValue>[];
}

export interface MemoryCandidate<TValue = unknown> {
  namespace: MemoryNamespace;
  memoryType: MemoryType;
  value: TValue;
  provenance: MemoryProvenance;
  confidence: number;
  validFrom?: string;
  validUntil?: string;
  expiresAt?: string;
  idempotencyKey: string;
}

export interface MemoryAccessPolicy {
  readMode: MemoryReadMode;
  writeMode: MemoryWriteMode;
  visibleScopeIds: string[];
  writableScopeIds: string[];
}

export interface MemoryWriteRequest<TValue = unknown> {
  memoryId: string;
  candidate: MemoryCandidate<TValue>;
  expectedRevision?: string;
}

const REVISION_PATTERN = /^r[1-9][0-9]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

export function parseMemoryIdentifier(
  value: unknown,
  field = "memoryId"
): string {
  return requiredString(value, field);
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, field);
}

function enumValue<TValue extends string>(
  value: unknown,
  allowed: readonly TValue[],
  field: string
): TValue {
  if (typeof value !== "string" || !allowed.includes(value as TValue)) {
    throw new Error(`${field} has an unsupported value`);
  }
  return value as TValue;
}

function confidenceValue(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    throw new Error("confidence must be a finite number between 0 and 1");
  }
  return value;
}

function isoTimestamp(value: unknown, field: string): string {
  const timestamp = requiredString(value, field);
  const epoch = Date.parse(timestamp);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== timestamp) {
    throw new Error(`${field} must be an ISO-8601 timestamp`);
  }
  return timestamp;
}

function optionalIsoTimestamp(
  value: unknown,
  field: string
): string | undefined {
  return value === undefined ? undefined : isoTimestamp(value, field);
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array`);
  }
  return [...new Set(value.map((item) => requiredString(item, field)))];
}

function assertJsonValue(
  value: unknown,
  field: string,
  ancestors: ReadonlySet<object> = new Set()
): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`${field} must be JSON-serializable`);
    }
    return;
  }
  if (typeof value !== "object") {
    throw new Error(`${field} must be JSON-serializable`);
  }
  if (ancestors.has(value)) {
    throw new Error(`${field} must be acyclic JSON`);
  }
  const nextAncestors = new Set(ancestors).add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertJsonValue(entry, `${field}[${index}]`, nextAncestors)
    );
    return;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${field} must be a JSON object`);
  }
  for (const [key, entry] of Object.entries(value)) {
    assertJsonValue(entry, `${field}.${key}`, nextAncestors);
  }
}

export function parseMemoryNamespace(value: unknown): MemoryNamespace {
  if (!isRecord(value)) throw new Error("namespace must be an object");
  const domain = optionalString(value.domain, "namespace.domain");
  if (domain === MEMORY_NAMESPACE_SENTINEL) {
    throw new Error("namespace.domain uses the reserved sentinel");
  }
  return {
    tenantId: requiredString(value.tenantId, "namespace.tenantId"),
    principalId: requiredString(value.principalId, "namespace.principalId"),
    ...(domain === undefined ? {} : { domain }),
    scopeId: requiredString(value.scopeId, "namespace.scopeId"),
  };
}

export function parseMemoryProvenance(value: unknown): MemoryProvenance {
  if (!isRecord(value)) throw new Error("provenance must be an object");
  const sourceRef = optionalString(value.sourceRef, "provenance.sourceRef");
  return {
    source: enumValue(
      value.source,
      MEMORY_PROVENANCE_SOURCES,
      "provenance.source"
    ),
    ...(sourceRef === undefined ? {} : { sourceRef }),
  };
}

export function parseRevision(value: unknown): string {
  const revision = requiredString(value, "revision");
  if (!REVISION_PATTERN.test(revision)) {
    throw new Error("revision must use canonical r<counter> form");
  }
  return revision;
}

export function nextRevision(revision: string | undefined): string {
  if (revision === undefined) return "r1";
  return `r${BigInt(parseRevision(revision).slice(1)) + 1n}`;
}

export function parseLongTermMemoryRecord(
  value: unknown
): LongTermMemoryRecord {
  if (!isRecord(value)) throw new Error("memory record must be an object");
  const validFrom = optionalIsoTimestamp(value.validFrom, "validFrom");
  const validUntil = optionalIsoTimestamp(value.validUntil, "validUntil");
  const expiresAt = optionalIsoTimestamp(value.expiresAt, "expiresAt");
  const idempotencyKey = optionalString(value.idempotencyKey, "idempotencyKey");
  const history = parseMemoryHistory(value.history);
  assertJsonValue(value.value, "value");
  return {
    memoryId: parseMemoryIdentifier(value.memoryId),
    namespace: parseMemoryNamespace(value.namespace),
    memoryType: enumValue(value.memoryType, MEMORY_TYPES, "memoryType"),
    value: value.value,
    provenance: parseMemoryProvenance(value.provenance),
    confidence: confidenceValue(value.confidence),
    revision: parseRevision(value.revision),
    ...(validFrom === undefined ? {} : { validFrom }),
    ...(validUntil === undefined ? {} : { validUntil }),
    recordedAt: isoTimestamp(value.recordedAt, "recordedAt"),
    createdAt: isoTimestamp(value.createdAt, "createdAt"),
    updatedAt: isoTimestamp(value.updatedAt, "updatedAt"),
    ...(expiresAt === undefined ? {} : { expiresAt }),
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    ...(history === undefined ? {} : { history }),
  };
}

function parseMemoryHistory(
  value: unknown
): MemoryRevisionSnapshot[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("history must be an array");
  return value.map((entry) => {
    const parsed = parseLongTermMemoryRecord(entry);
    if (parsed.history !== undefined) {
      throw new Error("history snapshots cannot contain nested history");
    }
    return parsed;
  });
}

export function parseMemoryCandidate(
  value: unknown
): MemoryCandidate {
  if (!isRecord(value)) throw new Error("memory candidate must be an object");
  const validFrom = optionalIsoTimestamp(value.validFrom, "validFrom");
  const validUntil = optionalIsoTimestamp(value.validUntil, "validUntil");
  const expiresAt = optionalIsoTimestamp(value.expiresAt, "expiresAt");
  assertJsonValue(value.value, "value");
  return {
    namespace: parseMemoryNamespace(value.namespace),
    memoryType: enumValue(value.memoryType, MEMORY_TYPES, "memoryType"),
    value: value.value,
    provenance: parseMemoryProvenance(value.provenance),
    confidence: confidenceValue(value.confidence),
    ...(validFrom === undefined ? {} : { validFrom }),
    ...(validUntil === undefined ? {} : { validUntil }),
    ...(expiresAt === undefined ? {} : { expiresAt }),
    idempotencyKey: requiredString(value.idempotencyKey, "idempotencyKey"),
  };
}

export function parseMemoryAccessPolicy(value: unknown): MemoryAccessPolicy {
  if (!isRecord(value)) throw new Error("memory access policy must be an object");
  return {
    readMode: enumValue(value.readMode, MEMORY_READ_MODES, "readMode"),
    writeMode: enumValue(value.writeMode, MEMORY_WRITE_MODES, "writeMode"),
    visibleScopeIds: stringArray(value.visibleScopeIds, "visibleScopeIds"),
    writableScopeIds: stringArray(value.writableScopeIds, "writableScopeIds"),
  };
}
