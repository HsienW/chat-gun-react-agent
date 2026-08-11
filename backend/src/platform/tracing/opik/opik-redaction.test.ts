import { describe, expect, it } from "vitest";

import {
  sanitizeMetadata,
  sanitizeSpanInput,
  sanitizeSpanOutput,
} from "./opik-redaction.js";

describe("Opik redaction", () => {
  it("redacts secret-bearing fields recursively", () => {
    const sanitized = sanitizeSpanInput({
      headers: { authorization: "Bearer sk-secret-value" },
      apiKey: "another-secret",
      nested: {
        password: "do-not-export",
        accessToken: "opaque-token",
        clientSecret: "opaque-secret",
      },
    });

    expect(sanitized).toEqual({
      headers: { authorization: "[redacted]" },
      apiKey: "[redacted]",
      nested: {
        password: "[redacted]",
        accessToken: "[redacted]",
        clientSecret: "[redacted]",
      },
    });
    expect(JSON.stringify(sanitized)).not.toContain("sk-secret-value");
    expect(JSON.stringify(sanitized)).not.toContain("do-not-export");
  });

  it("redacts field-key PII without language-specific value mappings", () => {
    expect(
      sanitizeSpanOutput({
        fullName: "Jane Doe",
        streetAddress: "123 Example Street",
        status: "completed",
      })
    ).toEqual({
      fullName: "[pii]",
      streetAddress: "[pii]",
      status: "completed",
    });
  });

  it("replaces prompt fields with deterministic SHA-256 references", () => {
    const first = sanitizeSpanInput({
      prompt: "You are a private system prompt.",
      messages: [{ role: "user", content: "private conversation" }],
    });
    const second = sanitizeSpanInput({
      prompt: "You are a private system prompt.",
      messages: [{ role: "user", content: "private conversation" }],
    });

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      prompt: expect.stringMatching(/^\[prompt:[a-f0-9]{64}\]$/),
      messages: expect.stringMatching(/^\[prompt:[a-f0-9]{64}\]$/),
    });
    expect(JSON.stringify(first)).not.toContain("private system prompt");
    expect(JSON.stringify(first)).not.toContain("private conversation");
  });

  it("masks email and phone values", () => {
    const sanitized = sanitizeSpanOutput({
      summary: "Contact user@example.com or +886-912-345-678 for details.",
    });

    expect(sanitized).toEqual({
      summary: "Contact [email] or [phone] for details.",
    });
  });

  it("preserves correlation identifiers", () => {
    const metadata = {
      threadId: "thread-123456789",
      runId: "run-123456789",
      taskId: "task-abc-123",
      stepId: "step-1",
      toolCallId: "tool-call-987654321",
    };

    expect(sanitizeMetadata(metadata)).toEqual(metadata);
  });

  it("reuses tracing error sanitization without exporting credentials", () => {
    const sanitized = sanitizeSpanOutput(
      new Error("request failed authorization=Bearer-secret token=abc123")
    );

    expect(sanitized).toEqual({
      name: "Error",
      message: "request failed authorization=[redacted] token=[redacted]",
    });
  });

  it("converts circular input into a bounded JSON-safe payload", () => {
    const circular: Record<string, unknown> = { status: "ok" };
    circular.self = circular;

    expect(sanitizeSpanInput(circular)).toEqual({
      status: "ok",
      self: "[circular]",
    });
  });
});
