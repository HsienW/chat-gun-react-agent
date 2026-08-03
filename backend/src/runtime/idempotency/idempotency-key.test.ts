import { describe, expect, it } from "vitest";

import { parseKey, serializeKey } from "./idempotency-key.js";

describe("IdempotencyKey", () => {
  const key = {
    namespace: "tool_execution",
    resourceKey: "task-abc:step-1:current_weather:1",
    version: "1",
  };

  it("serializes and parses every component", () => {
    const serialized = serializeKey(key);

    expect(serialized).toBe(
      "tool_execution:task-abc:step-1:current_weather:1:v1"
    );
    expect(parseKey(serialized)).toEqual(key);
  });

  it("keeps namespace and version differences isolated", () => {
    expect(serializeKey({ ...key, namespace: "task" })).not.toBe(
      serializeKey(key)
    );
    expect(serializeKey({ ...key, version: "2" })).not.toBe(
      serializeKey(key)
    );
  });

  it.each([
    [{ ...key, namespace: "" }, /namespace.*empty/i],
    [{ ...key, resourceKey: "" }, /resourceKey.*empty/i],
    [{ ...key, version: "" }, /version.*empty/i],
    [{ ...key, namespace: "tool:execution" }, /namespace.*:/i],
    [{ ...key, resourceKey: "task-abc::step-1" }, /resourceKey.*::/i],
  ])("rejects invalid components", (invalidKey, expectedMessage) => {
    expect(() => serializeKey(invalidKey)).toThrow(expectedMessage);
  });

  it.each(["", "missing-version", ":resource:v1", "namespace::v1"])(
    "rejects malformed serialized keys: %s",
    (serialized) => {
      expect(() => parseKey(serialized)).toThrow();
    }
  );
});
