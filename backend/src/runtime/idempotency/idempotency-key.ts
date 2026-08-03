export interface IdempotencyKey {
  namespace: string;
  resourceKey: string;
  version: string;
}

export type IdempotencyStatus = "locked" | "completed" | "failed";

export interface IdempotencyRecord {
  key: string;
  status: IdempotencyStatus;
  result?: unknown;
  createdAt: string;
  expiresAt: string;
}

function assertNonEmptyComponent(
  value: unknown,
  componentName: keyof IdempotencyKey
): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`IdempotencyKey ${componentName} must not be empty`);
  }
}

export function serializeKey(key: IdempotencyKey): string {
  assertNonEmptyComponent(key.namespace, "namespace");
  assertNonEmptyComponent(key.resourceKey, "resourceKey");
  assertNonEmptyComponent(key.version, "version");

  if (key.namespace.includes(":")) {
    throw new Error("IdempotencyKey namespace must not contain ':'");
  }
  if (key.resourceKey.includes("::")) {
    throw new Error("IdempotencyKey resourceKey must not contain '::'");
  }

  return `${key.namespace}:${key.resourceKey}:v${key.version}`;
}

export function parseKey(serialized: string): IdempotencyKey {
  const namespaceSeparator = serialized.indexOf(":");
  const versionSeparator = serialized.lastIndexOf(":v");

  if (
    namespaceSeparator <= 0 ||
    versionSeparator <= namespaceSeparator + 1 ||
    versionSeparator + 2 >= serialized.length
  ) {
    throw new Error("Invalid serialized IdempotencyKey format");
  }

  const key: IdempotencyKey = {
    namespace: serialized.slice(0, namespaceSeparator),
    resourceKey: serialized.slice(namespaceSeparator + 1, versionSeparator),
    version: serialized.slice(versionSeparator + 2),
  };

  if (serializeKey(key) !== serialized) {
    throw new Error("Invalid serialized IdempotencyKey format");
  }

  return key;
}
