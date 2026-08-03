import { describe, expect, it } from "vitest";

import { redact } from "./redaction.js";

describe("redact", () => {
  it("removes API keys and full prompts while preserving allowlisted fields", () => {
    expect(
      redact({
        toolName: "current_weather",
        apiKey: "do-not-persist",
        fullPrompt: "private prompt",
        durationMs: 1234,
        statusCode: 200,
      })
    ).toEqual({
      toolName: "current_weather",
      durationMs: 1234,
      statusCode: 200,
    });
  });

  it("removes nested sensitive fields without flattening safe structure", () => {
    expect(
      redact({
        request: {
          headers: {
            authorization: "Bearer private",
            traceId: "trace-123",
          },
        },
      })
    ).toEqual({ request: { headers: { traceId: "trace-123" } } });
  });

  it("redacts sensitive fields inside arrays", () => {
    expect(redact([{ email: "private@example.com", taskId: "task-1" }])).toEqual([
      { taskId: "task-1" },
    ]);
  });

  it("truncates long non-allowlisted strings", () => {
    const redacted = redact({ description: "a".repeat(1000) });

    expect(redacted).toEqual({
      description: `${"a".repeat(256)}...[truncated]`,
    });
  });
});
