import { createHash } from "node:crypto";

import { sanitizeErrorMessage } from "../span-manager.js";
import type { OpikMetadata, OpikPayload } from "./opik-setup.js";

const MAX_REDACTION_DEPTH = 8;
const MAX_ARRAY_ENTRIES = 50;
const MAX_OBJECT_ENTRIES = 100;

const INTERNATIONAL_PHONE_PATTERN = /\+886(?:[ ()-]*\d){8,10}(?![ ()-]*\d)/g;
const GROUPED_PHONE_PATTERN = /\b(?:\d{2,4}[ -]){2}\d{3,4}\b/g;
const PARENTHESIZED_PHONE_PATTERN = /\(\d{2,4}\)[ -]?\d{3,4}[ -]\d{3,4}\b/g;
const URL_PATTERN = /(?:https?:\/\/|www\.)\S+/gi;

const PHONE_FIELD_KEYS = new Set([
  "mobile",
  "mobilenumber",
  "phone",
  "phonenumber",
  "telephone",
  "telephonenumber",
]);

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

function isPhoneFieldKey(key: string, normalizedKey: string): boolean {
  return (
    PHONE_FIELD_KEYS.has(normalizedKey) ||
    /(?:^|[_\s-])(?:phone|telephone|mobile)(?:[_\s-]?number)?$/i.test(key) ||
    /(?:Phone|Telephone|Mobile)(?:Number)?$/.test(key)
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

function findContainingUrl(
  value: string,
  offset: number
): RegExpMatchArray | undefined {
  return Array.from(value.matchAll(URL_PATTERN)).find((match) => {
    const start = match.index;
    return start <= offset && offset < start + match[0].length;
  });
}

function shouldRedactPhoneMatch(value: string, offset: number): boolean {
  const urlMatch = findContainingUrl(value, offset);
  if (!urlMatch) return true;

  const prefix = value.slice(urlMatch.index, offset);
  const queryStart = prefix.indexOf("?");
  if (queryStart === -1) return true;

  const queryEntry = prefix.slice(
    Math.max(queryStart, prefix.lastIndexOf("&")) + 1
  );
  const separatorIndex = queryEntry.indexOf("=");
  if (separatorIndex === -1) return false;

  const fieldKey = queryEntry.slice(0, separatorIndex);
  return isPhoneFieldKey(fieldKey, normalizeFieldKey(fieldKey));
}

function redactPhoneMatches(value: string, pattern: RegExp): string {
  return value.replace(pattern, (match, offset: number, source: string) =>
    shouldRedactPhoneMatch(source, offset) ? "[phone]" : match
  );
}

function sanitizeString(value: string): string {
  const sanitized = sanitizeErrorMessage(value)
    .replace(/\b(?:sk|pk)-[a-z0-9_-]+\b/gi, "[redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]");

  return [
    INTERNATIONAL_PHONE_PATTERN,
    GROUPED_PHONE_PATTERN,
    PARENTHESIZED_PHONE_PATTERN,
  ].reduce(redactPhoneMatches, sanitized);
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

  if (normalizedKey && fieldKey && isPhoneFieldKey(fieldKey, normalizedKey)) {
    return "[phone]";
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
