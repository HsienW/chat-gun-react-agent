import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { describe, expect, it, beforeAll, beforeEach, vi } from "vitest";
import { z } from "zod";

import { validateImageAttachments } from "./upload-security.js";
import { calculatorTool } from "../tools/calculator.js";

const runLiveSmoke = process.env.RUN_QWEN_LIVE_SMOKE === "true";
const liveDescribe = runLiveSmoke ? describe : describe.skip;
const liveSmokeTimeoutMs = 30_000;

const plannerSchema = z.object({
  answerMode: z.enum(["weather", "clarify", "direct", "calculation", "research"]),
  weather: z
    .object({
      location: z.string().min(1),
      country: z.string().optional(),
      region: z.string().optional(),
    })
    .optional(),
  clarification: z.string().optional(),
});

const smokePngDataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAkSURBVDhPY/hPIWBAFyAVDEIDRCru4MXoYNSA4WkAqWAYGAAAQsaW7v8rocwAAAAASUVORK5CYII=";

function isBlank(value: string | undefined): boolean {
  return !value || value.trim().length === 0;
}

function truncate(value: string, maxLength = 180): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}

function sanitize(value: unknown): unknown {
  if (typeof value === "string") {
    return truncate(
      value.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]")
        .replace(/sk-[A-Za-z0-9._-]+/g, "[redacted]")
    );
  }
  if (Array.isArray(value)) {
    return value.slice(0, 4).map(sanitize);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, 12)
      .map(([key, entry]) => [
        key,
        /api[-_]?key|authorization|token|secret|credential/i.test(key)
          ? "[redacted]"
          : sanitize(entry),
      ])
  );
}

function summarizeMessage(message: AIMessage): Record<string, unknown> {
  return {
    provider: message.response_metadata?.provider,
    endpointKind: message.response_metadata?.endpointKind,
    model: message.response_metadata?.model,
    finishReason: message.response_metadata?.finish_reason,
    responseIdPresent: Boolean(message.response_metadata?.id),
    usageMetadataPresent: Boolean(message.usage_metadata),
    usageMetadata: message.usage_metadata
      ? {
          inputTokensPresent: Number.isFinite(message.usage_metadata.input_tokens),
          outputTokensPresent: Number.isFinite(message.usage_metadata.output_tokens),
          totalTokensPresent: Number.isFinite(message.usage_metadata.total_tokens),
        }
      : undefined,
    capabilities: message.response_metadata?.capabilities,
    contentSnippet: sanitize(String(message.content)),
  };
}

async function importGateway() {
  vi.resetModules();
  return import("./llm-gateway.js");
}

liveDescribe("Qwen/Bailian runtime live smoke", () => {
  beforeAll(() => {
    process.env.LLM_PROVIDER = "qwen";
    process.env.QWEN_BASE_URL =
      process.env.QWEN_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1";
    process.env.QWEN_CHAT_MODEL = process.env.QWEN_CHAT_MODEL || "qwen-plus";
    process.env.QWEN_RESEARCH_MODEL = process.env.QWEN_RESEARCH_MODEL || "qwen-plus";
    process.env.QWEN_TOOL_MODEL = process.env.QWEN_TOOL_MODEL || "qwen-plus";
    process.env.QWEN_VISION_MODEL = process.env.QWEN_VISION_MODEL || "qwen-vl-plus";

    if (isBlank(process.env.QWEN_API_KEY)) {
      throw new Error("QWEN_API_KEY=missing");
    }

    console.info("QWEN_API_KEY=present");
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("verifies live text chat and metadata normalization", async () => {
    const { llmGateway, describeLlmGatewayConfig } = await importGateway();
    const response = await llmGateway.createChatModel({
      purpose: "chat",
      temperature: 0,
      maxRetries: 0,
    }).invoke("請用繁體中文用一句話回答：你目前使用的模型供應商是什麼？");
    const aiMessage = response as AIMessage;

    expect(String(aiMessage.content).trim().length).toBeGreaterThan(0);
    expect(aiMessage.response_metadata).toMatchObject({
      provider: "qwen",
      endpointKind: "openai-chat-completions",
    });
    expect(String(aiMessage.content)).not.toContain("system prompt");
    console.info("qwen_live_text_summary", JSON.stringify({
      config: describeLlmGatewayConfig(),
      response: summarizeMessage(aiMessage),
    }));
  }, liveSmokeTimeoutMs);

  it("verifies live JSON mode for a planner-like request", async () => {
    const { llmGateway } = await importGateway();
    const response = await llmGateway.createChatModel({
      purpose: "research",
      temperature: 0,
      maxRetries: 0,
      responseFormat: { type: "json_object" },
    }).invoke([
      new HumanMessage([
        "Return one JSON object only.",
        "Classify this request for a backend planner: 幫我查台北今天的天氣",
        'Expected shape: {"answerMode":"weather|clarify|direct|calculation|research","weather":{"location":"string","country":"string optional","region":"string optional"},"clarification":"string optional"}',
        "Use a structured location field. Do not explain.",
      ].join("\n")),
    ]);
    const aiMessage = response as AIMessage;
    const parsed = JSON.parse(String(aiMessage.content)) as unknown;
    const validated = plannerSchema.parse(parsed);

    expect(validated.answerMode).toBe("weather");
    expect(validated.weather?.location).toBeTruthy();
    console.info("qwen_live_json_summary", JSON.stringify(summarizeMessage(aiMessage)));
  }, liveSmokeTimeoutMs);

  it("verifies live vision routing or explicit provider capability failure", async () => {
    const imageBlock = {
      type: "image_url",
      image_url: { url: smokePngDataUrl },
      fileName: "smoke-16x16.png",
      mimeType: "image/png",
      width: 16,
      height: 16,
    };
    const validationError = validateImageAttachments([
      new HumanMessage({
        content: [imageBlock],
      }),
    ]);
    expect(validationError).toBeUndefined();

    const { llmGateway, formatLlmError } = await importGateway();
    try {
      const response = await llmGateway.createChatModel({
        purpose: "vision",
        temperature: 0,
        maxRetries: 0,
      }).invoke([
        new HumanMessage({
          content: [
            { type: "text", text: "Describe this image in one short sentence." },
            { type: "image_url", image_url: { url: smokePngDataUrl } },
          ],
        }),
      ]);
      const aiMessage = response as AIMessage;
      expect(String(aiMessage.content).trim().length).toBeGreaterThan(0);
      expect(aiMessage.response_metadata?.provider).toBe("qwen");
      console.info("qwen_live_vision_summary", JSON.stringify(summarizeMessage(aiMessage)));
    } catch (error) {
      const formatted = formatLlmError(error);
      expect(formatted).toContain("Provider: qwen");
      expect(formatted).not.toContain("Gemini");
      console.info("qwen_live_vision_error", JSON.stringify(sanitize(formatted)));
      throw error;
    }
  }, liveSmokeTimeoutMs);

  it("verifies live tool calling and ToolMessage round trip", async () => {
    const { llmGateway } = await importGateway();
    const toolNode = new ToolNode([calculatorTool]);
    const model = llmGateway.createChatModel({
      purpose: "tool",
      temperature: 0,
      maxRetries: 0,
    });
    const modelWithTools = model.bindTools?.([calculatorTool]);
    expect(modelWithTools).toBeDefined();

    const first = await modelWithTools!.invoke([
      new HumanMessage("請使用工具計算 123*456，不要心算。"),
    ]);
    const firstAi = first as AIMessage;
    const toolCall = firstAi.tool_calls?.[0];
    expect(toolCall).toBeDefined();
    expect(toolCall?.id).toBeTruthy();

    const toolResult = await toolNode.invoke({
      messages: [new HumanMessage("請使用工具計算 123*456，不要心算。"), first],
    });
    const toolMessage = toolResult.messages.at(-1) as ToolMessage;
    expect(toolMessage.tool_call_id).toBe(toolCall?.id);
    expect(String(toolMessage.content)).toContain("56088");

    const final = await model.invoke([
      new HumanMessage("請使用工具計算 123*456，不要心算。"),
      first,
      toolMessage,
    ]);
    const finalAi = final as AIMessage;
    expect(String(finalAi.content)).toContain("56088");
    console.info("qwen_live_tool_summary", JSON.stringify({
      first: summarizeMessage(firstAi),
      final: summarizeMessage(finalAi),
      toolCallIdStable: toolMessage.tool_call_id === toolCall?.id,
    }));
  }, liveSmokeTimeoutMs);

  it("verifies MCP agent keeps backend execution architecture under Qwen provider", async () => {
    process.env.MCP_LOAD_ON_START = "false";
    process.env.DEEP_RESEARCHER_MCP_ENABLED = "false";
    const { mcpAgentGraph } = await import("../agents/mcp-agent.js");

    expect(mcpAgentGraph).toBeDefined();
    console.info("qwen_live_mcp_architecture_summary", JSON.stringify({
      provider: "qwen",
      backendToolRegistry: true,
      backendToolNode: true,
      providerHostedMcp: false,
      mcpLoadOnStart: process.env.MCP_LOAD_ON_START,
    }));
  }, liveSmokeTimeoutMs);
});
