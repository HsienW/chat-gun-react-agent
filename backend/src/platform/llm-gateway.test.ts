import { afterEach, describe, expect, it, vi } from "vitest";

describe("llm-gateway provider selection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("keeps explicit Gemini provider even when a CCR base URL is present", async () => {
    vi.stubEnv("LLM_PROVIDER", "gemini");
    vi.stubEnv("CCR_BASE_URL", "http://127.0.0.1:3456/v1");
    vi.resetModules();

    const gatewayModule = await import("./llm-gateway.js");

    expect(gatewayModule.getConfiguredLlmProvider()).toBe("gemini");
    expect(gatewayModule.describeLlmGatewayConfig()).toMatchObject({
      provider: "gemini",
      endpointKind: "gemini-sdk",
    });
  });

  it("routes CCR provider through CCR Anthropic messages endpoint", async () => {
    vi.stubEnv("LLM_PROVIDER", "ccr");
    vi.stubEnv("CCR_BASE_URL", "http://127.0.0.1:3456/v1");
    vi.stubEnv("CCR_PROVIDER", "deepseek");
    vi.stubEnv("CCR_MODEL", "ccr-test-model");
    vi.resetModules();

    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        model?: string;
        messages?: Array<{ role: string; content: Array<{ type: string; text: string }> }>;
      };

      expect(body.model).toBe("deepseek,ccr-test-model");
      expect(body.messages?.[0]).toEqual({
        role: "user",
        content: [{ type: "text", text: "ping" }],
      });

      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: "pong" }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const { llmGateway } = await import("./llm-gateway.js");
    const response = await llmGateway.createChatModel().invoke("ping");

    expect(String(response.content)).toBe("pong");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "http://127.0.0.1:3456/v1/messages?beta=true"
    );
    const gatewayModule = await import("./llm-gateway.js");
    expect(gatewayModule.describeLlmGatewayConfig()).toMatchObject({
      provider: "ccr",
      endpointKind: "anthropic-messages",
    });
  });

  it("routes OpenAI-compatible provider through chat completions endpoint", async () => {
    vi.stubEnv("LLM_PROVIDER", "openai-compatible");
    vi.stubEnv("OPENAI_COMPATIBLE_BASE_URL", "http://127.0.0.1:9999/v1");
    vi.stubEnv("OPENAI_COMPATIBLE_MODEL", "openai-compatible-test-model");
    vi.resetModules();

    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        model?: string;
        messages?: Array<{ role: string; content: unknown }>;
      };

      expect(body.model).toBe("openai-compatible-test-model");
      expect(body.messages?.[0]).toEqual({
        role: "user",
        content: "ping",
      });

      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "pong" } }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const { llmGateway } = await import("./llm-gateway.js");
    const response = await llmGateway.createChatModel().invoke("ping");

    expect(String(response.content)).toBe("pong");
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "http://127.0.0.1:9999/v1/chat/completions"
    );
  });

  it("allows OpenAI-compatible provider to reuse local CCR env aliases", async () => {
    vi.stubEnv("LLM_PROVIDER", "openai-compatible");
    vi.stubEnv("CCR_BASE_URL", "http://127.0.0.1:3456/v1");
    vi.stubEnv("CCR_API_KEY", "ccr-test-key");
    vi.stubEnv("CCR_MODEL", "ccr-openai-compatible-model");
    vi.resetModules();

    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        model?: string;
      };
      const headers = init?.headers as Record<string, string>;

      expect(body.model).toBe("ccr-openai-compatible-model");
      expect(headers.authorization).toBe("Bearer ccr-test-key");

      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "pong" } }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const { llmGateway, describeLlmGatewayConfig } = await import("./llm-gateway.js");
    const response = await llmGateway.createChatModel().invoke("ping");

    expect(String(response.content)).toBe("pong");
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "http://127.0.0.1:3456/v1/chat/completions"
    );
    expect(describeLlmGatewayConfig()).toMatchObject({
      provider: "openai-compatible",
      endpointKind: "openai-chat-completions",
      baseUrlConfigured: true,
      apiKeyConfigured: true,
    });
  });

  it("reports sanitized JSON parse diagnostics without response body contents", async () => {
    vi.stubEnv("LLM_PROVIDER", "openai-compatible");
    vi.stubEnv("OPENAI_COMPATIBLE_BASE_URL", "http://127.0.0.1:9999/v1");
    vi.stubEnv("OPENAI_COMPATIBLE_MODEL", "openai-compatible-test-model");
    vi.resetModules();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response('{"apiKey":"sk-secret-value"', {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
    );

    const { llmGateway } = await import("./llm-gateway.js");

    let error: unknown;
    try {
      await llmGateway.createChatModel().invoke("ping");
    } catch (caught) {
      error = caught;
    }

    const message = error instanceof Error ? error.message : String(error);
    expect(message).toContain("llm_response_json_parse_failed");
    expect(message).toContain('"provider":"openai-compatible"');
    expect(message).toContain('"endpointKind":"openai-chat-completions"');
    expect(message).toContain('"responseContentLength":');
    expect(message).not.toContain("sk-secret-value");
  });
});
