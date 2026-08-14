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

  it("masks phone values with explicit telephone grouping", () => {
    expect(
      sanitizeSpanOutput({
        summary: "Call 0912-345-678, 02-2345-6789, or (02) 2345-6789.",
      })
    ).toEqual({ summary: "Call [phone], [phone], or [phone]." });
  });

  it("preserves timestamps and decimal coordinates in general text", () => {
    const sanitized = sanitizeSpanOutput({
      timestamp: "2026-08-12T19:00",
      latitude: "25.05306",
      longitude: "121.5654",
      query: "latitude=25.05306&longitude=121.5654",
    });

    expect(sanitized).toEqual({
      timestamp: "2026-08-12T19:00",
      latitude: "25.05306",
      longitude: "121.5654",
      query: "latitude=25.05306&longitude=121.5654",
    });
  });

  it("preserves numeric URL query values that are not phone fields", () => {
    expect(
      sanitizeSpanOutput({
        url: "https://example.com/weather?request=123-456-789&latitude=25.05306",
        reference: "1234-5678",
      })
    ).toEqual({
      url: "https://example.com/weather?request=123-456-789&latitude=25.05306",
      reference: "1234-5678",
    });
  });

  it("redacts high-confidence phone values in URL phone fields", () => {
    expect(
      sanitizeSpanOutput({
        url: "https://example.com/contact?phone=+886-912-345-678",
      })
    ).toEqual({ url: "https://example.com/contact?phone=[phone]" });
  });

  it("redacts phone fields without relying on value-shape detection", () => {
    expect(
      sanitizeSpanOutput({
        phone: "extension unknown",
        phoneNumber: "2026-08-12T19:00",
        contactPhone: "not parseable",
        headphone: "wireless",
      })
    ).toEqual({
      phone: "[phone]",
      phoneNumber: "[phone]",
      contactPhone: "[phone]",
      headphone: "wireless",
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
