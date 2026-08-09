import { afterEach, describe, expect, it, vi } from "vitest";

describe("llmGateway fallback integration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("routes a primary 5xx response to the configured fallback provider", async () => {
    vi.stubEnv("LLM_PROVIDER", "ccr");
    vi.stubEnv("CCR_BASE_URL", "http://primary.internal/v1");
    vi.stubEnv("LLM_FALLBACK_ENABLED", "true");
    vi.stubEnv("LLM_FALLBACK_PROVIDERS", "qwen");
    vi.stubEnv("QWEN_BASE_URL", "http://fallback.internal/v1");
    vi.resetModules();

    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("http://primary.internal")) {
        return new Response("unavailable", { status: 502 });
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "fallback" } }] }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const { llmGateway } = await import("./llm-gateway.js");
    const response = await llmGateway
      .createChatModelWithFallback({ maxRetries: 0 })
      .invoke("ping");

    expect(response.content).toBe("fallback");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toBe(
      "http://fallback.internal/v1/chat/completions"
    );
  });

  it("preserves primary-only behavior when fallback is disabled", async () => {
    vi.stubEnv("LLM_PROVIDER", "ccr");
    vi.stubEnv("CCR_BASE_URL", "http://primary.internal/v1");
    vi.stubEnv("LLM_FALLBACK_ENABLED", "false");
    vi.stubEnv("LLM_FALLBACK_PROVIDERS", "qwen");
    vi.resetModules();

    const fetchMock = vi.fn(async () => new Response("unavailable", { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);

    const { llmGateway } = await import("./llm-gateway.js");

    await expect(
      llmGateway.createChatModelWithFallback({ maxRetries: 0 }).invoke("ping")
    ).rejects.toMatchObject({ statusCode: 502 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not parse fallback providers while fallback is disabled", async () => {
    vi.stubEnv("LLM_PROVIDER", "ccr");
    vi.stubEnv("CCR_BASE_URL", "http://primary.internal/v1");
    vi.stubEnv("LLM_FALLBACK_ENABLED", "false");
    vi.stubEnv("LLM_FALLBACK_PROVIDERS", "unsupported-provider");
    vi.resetModules();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ content: [{ type: "text", text: "primary" }] }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    );

    const { llmGateway } = await import("./llm-gateway.js");
    const response = await llmGateway
      .createChatModelWithFallback({ maxRetries: 0 })
      .invoke("ping");

    expect(response.content).toBe("primary");
  });

  it("repairs structured output on the primary provider before fallback", async () => {
    vi.stubEnv("LLM_PROVIDER", "qwen");
    vi.stubEnv("QWEN_BASE_URL", "http://primary.internal/v1");
    vi.stubEnv("LLM_FALLBACK_ENABLED", "true");
    vi.stubEnv("LLM_FALLBACK_PROVIDERS", "openai-compatible");
    vi.stubEnv("OPENAI_COMPATIBLE_BASE_URL", "http://fallback.internal/v1");
    vi.stubEnv("LLM_REPAIR_STRATEGY", "retry_with_hint");
    vi.resetModules();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ choices: [{ message: { content: '{"answer":' } }] }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"answer":"fixed"}' } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    const { llmGateway } = await import("./llm-gateway.js");
    const response = await llmGateway
      .createChatModelWithFallback({
        maxRetries: 0,
        responseFormat: { type: "json_object" },
      })
      .invoke("Return JSON");

    expect(JSON.parse(String(response.content))).toEqual({ answer: "fixed" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain("primary.internal");
  });

  it("falls back after structured output repair is exhausted", async () => {
    vi.stubEnv("LLM_PROVIDER", "qwen");
    vi.stubEnv("QWEN_BASE_URL", "http://primary.internal/v1");
    vi.stubEnv("LLM_FALLBACK_ENABLED", "true");
    vi.stubEnv("LLM_FALLBACK_PROVIDERS", "openai-compatible");
    vi.stubEnv("OPENAI_COMPATIBLE_BASE_URL", "http://fallback.internal/v1");
    vi.stubEnv("LLM_REPAIR_STRATEGY", "retry_once");
    vi.resetModules();

    const invalid = () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: "not-json" } }] }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(invalid())
      .mockResolvedValueOnce(invalid())
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"answer":"fallback"}' } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    const { llmGateway } = await import("./llm-gateway.js");
    const response = await llmGateway
      .createChatModelWithFallback({
        maxRetries: 0,
        responseFormat: { type: "json_object" },
      })
      .invoke("Return JSON");

    expect(JSON.parse(String(response.content))).toEqual({ answer: "fallback" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[2][0])).toContain("fallback.internal");
  });

  it("does not repair or fallback after a structured refusal", async () => {
    vi.stubEnv("LLM_PROVIDER", "qwen");
    vi.stubEnv("QWEN_BASE_URL", "http://primary.internal/v1");
    vi.stubEnv("LLM_FALLBACK_ENABLED", "true");
    vi.stubEnv("LLM_FALLBACK_PROVIDERS", "openai-compatible");
    vi.stubEnv("OPENAI_COMPATIBLE_BASE_URL", "http://fallback.internal/v1");
    vi.resetModules();

    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            { finish_reason: "content_filter", message: { content: null } },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const { llmGateway } = await import("./llm-gateway.js");

    await expect(
      llmGateway
        .createChatModelWithFallback({
          maxRetries: 0,
          responseFormat: { type: "json_object" },
        })
        .invoke("Return JSON")
    ).rejects.toMatchObject({ code: "content_filter_refusal" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
