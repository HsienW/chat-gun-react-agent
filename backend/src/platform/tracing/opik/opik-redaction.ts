import { createHash } from "node:crypto";

import { sanitizeErrorMessage } from "../span-manager.js";
import type { OpikMetadata, OpikPayload } from "./opik-setup.js";

const MAX_REDACTION_DEPTH = 8;
const MAX_ARRAY_ENTRIES = 50;
const MAX_OBJECT_ENTRIES = 100;

const PROMPT_FIELD_KEYS = new Set([
  "instructions",
  "messages",
  "prompt",
  "system",
  "systemprompt",
]);

const SECRET_FIELD_KEYS = new Set([
  "apikey",
  "authorization",
  "credential",
  "credentials",
  "password",
  "secret",
  "token",
]);

const PII_FIELD_KEYS = new Set([
  "address",
  "customername",
  "firstname",
  "fullname",
  "lastname",
  "postaladdress",
  "streetaddress",
  "userdisplayname",
  "username",
]);

const CORRELATION_FIELD_KEYS = new Set([
  "requestid",
  "runid",
  "stepid",
  "taskid",
  "threadid",
  "toolcallid",
]);

const RAW_PAYLOAD_FIELD_KEYS = new Set([
  "rawproviderbody",
  "rawtooloutput",
  "tooloutput",
]);

function normalizeFieldKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isSecretFieldKey(key: string): boolean {
  return (
    SECRET_FIELD_KEYS.has(key) ||
    /(?:apikey|credential|credentials|password|secret|token)$/.test(key)
  );
}

function stableSerialize(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "bigint") return JSON.stringify(value.toString());
    if (typeof value === "undefined") return "null";
    return JSON.stringify(value) ?? JSON.stringify(String(value));
  }

  if (seen.has(value)) return JSON.stringify("[circular]");
  seen.add(value);

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry, seen)).join(",")}]`;
  }

  const entries = Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  return `{${entries
    .map(([key, nestedValue]) => `${JSON.stringify(key)}:${stableSerialize(nestedValue, seen)}`)
    .join(",")}}`;
}

function hashReference(kind: "prompt" | "payload", value: unknown): string {
  const digest = createHash("sha256").update(stableSerialize(value)).digest("hex");
  return `[${kind}:${digest}]`;
}

function sanitizeString(value: string): string {
  return sanitizeErrorMessage(value)
    .replace(/\b(?:sk|pk)-[a-z0-9_-]+\b/gi, "[redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/(?:\+?\d[\d().\s-]{7,}\d)/g, "[phone]");
}

function sanitizeValue(
  value: unknown,
  seen: WeakSet<object>,
  depth: number,
  fieldKey?: string
): OpikPayload {
  const normalizedKey = fieldKey ? normalizeFieldKey(fieldKey) : undefined;

  if (normalizedKey && CORRELATION_FIELD_KEYS.has(normalizedKey)) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return value;
    }
  }

  if (normalizedKey && isSecretFieldKey(normalizedKey)) {
    return "[redacted]";
  }

  if (normalizedKey && PII_FIELD_KEYS.has(normalizedKey)) {
    return "[pii]";
  }

  if (normalizedKey && PROMPT_FIELD_KEYS.has(normalizedKey)) {
    return hashReference("prompt", value);
  }

  if (normalizedKey && RAW_PAYLOAD_FIELD_KEYS.has(normalizedKey)) {
    return hashReference("payload", value);
  }

  if (value === null || value === undefined) return null;
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") {
    return "[unsupported]";
  }

  if (depth >= MAX_REDACTION_DEPTH) return "[truncated]";

  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeString(value.message),
    };
  }

  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) return "[circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    const sanitized = value
      .slice(0, MAX_ARRAY_ENTRIES)
      .map((entry) => sanitizeValue(entry, seen, depth + 1));
    return value.length > MAX_ARRAY_ENTRIES
      ? [...sanitized, "[truncated]"]
      : sanitized;
  }

  const sanitized: Record<string, OpikPayload> = {};
  const entries = Object.entries(value).slice(0, MAX_OBJECT_ENTRIES);
  for (const [key, nestedValue] of entries) {
    sanitized[key] = sanitizeValue(nestedValue, seen, depth + 1, key);
  }
  if (Object.keys(value).length > MAX_OBJECT_ENTRIES) {
    sanitized.__truncated__ = true;
  }
  return sanitized;
}

export function sanitizeSpanInput(input: unknown): OpikPayload {
  return sanitizeValue(input, new WeakSet<object>(), 0);
}

export function sanitizeSpanOutput(output: unknown): OpikPayload {
  return sanitizeValue(output, new WeakSet<object>(), 0);
}

export function sanitizeMetadata(
  metadata: object
): OpikMetadata {
  const sanitized: OpikMetadata = {};
  const seen = new WeakSet<object>();
  for (const [key, value] of Object.entries(metadata).slice(0, MAX_OBJECT_ENTRIES)) {
    sanitized[key] = sanitizeValue(value, seen, 0, key);
  }
  return sanitized;
}
