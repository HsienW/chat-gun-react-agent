export const REDACTED_MARKER = "[REDACTED]";

const TRUNCATED_MARKER = "...[truncated]";
const MAX_UNCLASSIFIED_STRING_LENGTH = 256;

const BLOCKED_FIELDS = new Set([
  "apikey",
  "api_key",
  "token",
  "secret",
  "prompt",
  "fullprompt",
  "conversation",
  "messages",
  "raw",
  "input",
  "output",
  "password",
  "credential",
  "authorization",
  "pii",
  "email",
  "phone",
]);

const ALLOWED_FIELDS = new Set([
  "toolname",
  "durationms",
  "inputchars",
  "outputchars",
  "statuscode",
  "errorcode",
  "attemptcount",
  "candidatecount",
  "strategy",
  "provider",
  "resultstatus",
  "reason",
  "reasoncode",
  "stepid",
  "stepname",
  "taskid",
  "tasktype",
]);

const OMITTED = Symbol("omitted audit field");

function redactValue(
  value: unknown,
  fieldName: string | undefined,
  visited: WeakSet<object>
): unknown | typeof OMITTED {
  const normalizedFieldName = fieldName?.toLowerCase();
  if (normalizedFieldName && BLOCKED_FIELDS.has(normalizedFieldName)) {
    return OMITTED;
  }

  if (typeof value === "string") {
    if (normalizedFieldName && ALLOWED_FIELDS.has(normalizedFieldName)) {
      return value;
    }
    return value.length > MAX_UNCLASSIFIED_STRING_LENGTH
      ? `${value.slice(0, MAX_UNCLASSIFIED_STRING_LENGTH)}${TRUNCATED_MARKER}`
      : value;
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  if (visited.has(value)) {
    return REDACTED_MARKER;
  }
  visited.add(value);

  if (Array.isArray(value)) {
    const redactedItems = value
      .map((item) => redactValue(item, undefined, visited))
      .filter((item) => item !== OMITTED);
    visited.delete(value);
    return redactedItems;
  }

  const redactedObject: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    const redactedNestedValue = redactValue(nestedValue, key, visited);
    if (redactedNestedValue !== OMITTED) {
      redactedObject[key] = redactedNestedValue;
    }
  }
  visited.delete(value);
  return redactedObject;
}

export function redact(payload: unknown): unknown {
  const redacted = redactValue(payload, undefined, new WeakSet());
  return redacted === OMITTED ? REDACTED_MARKER : redacted;
}
