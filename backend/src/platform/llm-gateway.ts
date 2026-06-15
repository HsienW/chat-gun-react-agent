import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { AIMessage, BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import { getEnv, requireEnv } from "./env.js";
import { createErrorEnvelope, formatErrorEnvelope } from "./errors.js";
import { configureNetwork } from "./network.js";

configureNetwork();

export interface ChatModelOptions {
  model?: string;
  temperature?: number;
  maxRetries?: number;
}

type ChatModelInput = Parameters<BaseChatModel["invoke"]>[0];
type ChatModelOutput = BaseMessage;

export interface ChatModelInvoker {
  invoke(input: ChatModelInput): Promise<ChatModelOutput>;
  bindTools?: BaseChatModel["bindTools"];
}

export interface LlmGateway {
  createChatModel(options?: ChatModelOptions): ChatModelInvoker;
}

class GeminiGateway implements LlmGateway {
  createChatModel(options: ChatModelOptions = {}): ChatModelInvoker {
    return new ChatGoogleGenerativeAI({
      model: options.model ?? getEnv("DEFAULT_MODEL", "gemini-2.5-flash"),
      temperature: options.temperature ?? 0.7,
      maxRetries: options.maxRetries ?? 2,
      apiKey: requireEnv("GEMINI_API_KEY"),
    });
  }
}

type OpenAiChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: unknown;
};

type OpenAiChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
};

type AnthropicContentBlock = {
  type: "text";
  text: string;
};

type AnthropicMessage = {
  role: "user" | "assistant";
  content: AnthropicContentBlock[];
};

type AnthropicMessagesResponse = {
  content?: Array<{
    type?: string;
    text?: unknown;
  }>;
};

function getFirstEnv(names: string[]): string {
  for (const name of names) {
    const value = getEnv(name).trim();
    if (value) {
      return value;
    }
  }
  return "";
}

function getOpenAiCompatibleBaseUrl(): string {
  return getFirstEnv([
    "OPENAI_COMPATIBLE_BASE_URL",
    "OPENAI_BASE_URL",
  ]);
}

function getOpenAiCompatibleApiKey(): string {
  return getFirstEnv([
    "OPENAI_COMPATIBLE_API_KEY",
    "OPENAI_API_KEY",
  ]);
}

function getOpenAiCompatibleModel(requestedModel: string | undefined): string {
  const configuredModel = getFirstEnv([
    "OPENAI_COMPATIBLE_MODEL",
    "OPENAI_MODEL",
    "DEFAULT_MODEL",
  ]);
  const requested = requestedModel?.trim();

  if (requested && !requested.startsWith("gemini-")) {
    return requested;
  }

  return configuredModel || requested || "gpt-4o-mini";
}

function buildChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/chat/completions")
    ? trimmed
    : `${trimmed}/chat/completions`;
}

function getCcrBaseUrl(): string {
  return getEnv("CCR_BASE_URL").trim();
}

function getCcrApiKey(): string {
  return getEnv("CCR_API_KEY").trim();
}

function getCcrProvider(): string {
  return getEnv("CCR_PROVIDER", "deepseek").trim();
}

function getCcrModel(requestedModel: string | undefined): string {
  const configuredModel = getEnv("CCR_MODEL").trim();
  const requested = requestedModel?.trim();
  const model = configuredModel || requested || "deepseek-v4-flash";

  if (model.includes(",")) {
    return model;
  }

  const provider = getCcrProvider();
  return provider ? `${provider},${model}` : model;
}

function buildAnthropicMessagesUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.endsWith("/v1/messages")) {
    return `${trimmed}?beta=true`;
  }
  if (trimmed.endsWith("/v1")) {
    return `${trimmed}/messages?beta=true`;
  }
  return `${trimmed}/v1/messages?beta=true`;
}

function roleForMessage(message: BaseMessage | { role?: unknown }): OpenAiChatMessage["role"] {
  const role = "role" in message && typeof message.role === "string"
    ? message.role
    : undefined;

  if (role === "system" || role === "assistant" || role === "tool") {
    return role;
  }
  if (role === "human" || role === "user") {
    return "user";
  }

  switch ("getType" in message ? message.getType?.() : undefined) {
    case "system":
      return "system";
    case "ai":
      return "assistant";
    case "tool":
      return "tool";
    case "human":
    default:
      return "user";
  }
}

function toOpenAiMessages(input: unknown): OpenAiChatMessage[] {
  if (typeof input === "string") {
    return [{ role: "user", content: input }];
  }

  if (
    input &&
    typeof input === "object" &&
    "toChatMessages" in input &&
    typeof (input as { toChatMessages?: unknown }).toChatMessages === "function"
  ) {
    return toOpenAiMessages((input as { toChatMessages: () => unknown }).toChatMessages());
  }

  if (!Array.isArray(input)) {
    return [{ role: "user", content: contentToString(input) }];
  }

  return input.map((message) => ({
    role: roleForMessage(message),
    content:
      message &&
      typeof message === "object" &&
      "content" in message
        ? (message as { content?: unknown }).content
        : contentToString(message),
  }));
}

function contentToString(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (
          part &&
          typeof part === "object" &&
          "text" in part &&
          typeof (part as { text?: unknown }).text === "string"
        ) {
          return (part as { text: string }).text;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return content === undefined || content === null ? "" : JSON.stringify(content);
}

function toAnthropicPayload(input: unknown): {
  messages: AnthropicMessage[];
  system?: AnthropicContentBlock[];
} {
  const openAiMessages = toOpenAiMessages(input);
  const messages: AnthropicMessage[] = [];
  const system: AnthropicContentBlock[] = [];

  for (const message of openAiMessages) {
    const block = { type: "text" as const, text: contentToString(message.content) };
    if (message.role === "system") {
      system.push(block);
      continue;
    }

    messages.push({
      role: message.role === "assistant" ? "assistant" : "user",
      content: [block],
    });
  }

  return {
    messages: messages.length ? messages : [{ role: "user", content: [{ type: "text", text: "" }] }],
    system: system.length ? system : undefined,
  };
}

class OpenAiCompatibleChatModel implements ChatModelInvoker {
  constructor(
    private readonly options: Required<Pick<ChatModelOptions, "temperature" | "maxRetries">> & {
      model: string;
      baseUrl: string;
      apiKey?: string;
    }
  ) {}

  async invoke(input: ChatModelInput): Promise<ChatModelOutput> {
    const url = buildChatCompletionsUrl(this.options.baseUrl);
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };

    if (this.options.apiKey) {
      headers.authorization = `Bearer ${this.options.apiKey}`;
    }

    let lastError: Error | undefined;
    const attempts = Math.max(1, this.options.maxRetries + 1);
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: this.options.model,
            temperature: this.options.temperature,
            messages: toOpenAiMessages(input),
          }),
        });

        if (!response.ok) {
          const responseText = await response.text();
          throw new Error(
            `OpenAI-compatible chat completion failed: ${response.status} ${response.statusText}${responseText ? ` ${responseText.slice(0, 500)}` : ""}`
          );
        }

        const parsed = (await response.json()) as OpenAiChatCompletionResponse;
        const content = parsed.choices?.[0]?.message?.content;
        return new AIMessage(contentToString(content));
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt >= attempts) {
          throw lastError;
        }
      }
    }

    throw lastError ?? new Error("OpenAI-compatible chat completion failed.");
  }
}

class OpenAiCompatibleGateway implements LlmGateway {
  createChatModel(options: ChatModelOptions = {}): ChatModelInvoker {
    const baseUrl = getOpenAiCompatibleBaseUrl();
    if (!baseUrl) {
      throw new Error(
        "OpenAI-compatible LLM provider selected but CCR_BASE_URL, OPENAI_COMPATIBLE_BASE_URL, or OPENAI_BASE_URL is not configured."
      );
    }

    return new OpenAiCompatibleChatModel({
      model: getOpenAiCompatibleModel(options.model),
      baseUrl,
      apiKey: getOpenAiCompatibleApiKey() || undefined,
      temperature: options.temperature ?? 0.7,
      maxRetries: options.maxRetries ?? 2,
    });
  }
}

class CcrAnthropicChatModel implements ChatModelInvoker {
  constructor(
    private readonly options: Required<Pick<ChatModelOptions, "temperature" | "maxRetries">> & {
      model: string;
      baseUrl: string;
      apiKey?: string;
    }
  ) {}

  async invoke(input: ChatModelInput): Promise<ChatModelOutput> {
    const url = buildAnthropicMessagesUrl(this.options.baseUrl);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
    };

    if (this.options.apiKey) {
      headers["x-api-key"] = this.options.apiKey;
      headers.authorization = `Bearer ${this.options.apiKey}`;
    }

    const payload = toAnthropicPayload(input);
    let lastError: Error | undefined;
    const attempts = Math.max(1, this.options.maxRetries + 1);
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: this.options.model,
            max_tokens: 8192,
            temperature: this.options.temperature,
            messages: payload.messages,
            ...(payload.system ? { system: payload.system } : {}),
          }),
        });

        if (!response.ok) {
          const responseText = await response.text();
          throw new Error(
            `CCR messages request failed: ${response.status} ${response.statusText}${responseText ? ` ${responseText.slice(0, 500)}` : ""}`
          );
        }

        const parsed = (await response.json()) as AnthropicMessagesResponse;
        const content = parsed.content
          ?.map((block) => block.type === "text" ? contentToString(block.text) : "")
          .filter(Boolean)
          .join("\n") ?? "";
        return new AIMessage(content);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt >= attempts) {
          throw lastError;
        }
      }
    }

    throw lastError ?? new Error("CCR messages request failed.");
  }
}

class CcrGateway implements LlmGateway {
  createChatModel(options: ChatModelOptions = {}): ChatModelInvoker {
    const baseUrl = getCcrBaseUrl();
    if (!baseUrl) {
      throw new Error("CCR LLM provider selected but CCR_BASE_URL is not configured.");
    }

    return new CcrAnthropicChatModel({
      model: getCcrModel(options.model),
      baseUrl,
      apiKey: getCcrApiKey() || undefined,
      temperature: options.temperature ?? 0.7,
      maxRetries: options.maxRetries ?? 2,
    });
  }
}

export type LlmProviderName = "gemini" | "ccr" | "openai-compatible";

export function getConfiguredLlmProvider(): LlmProviderName {
  const provider = getEnv("LLM_PROVIDER").trim().toLowerCase();
  if (provider === "gemini") {
    return "gemini";
  }

  if (provider === "ccr") {
    return "ccr";
  }

  if (provider === "openai" || provider === "openai-compatible") {
    return "openai-compatible";
  }

  if (getCcrBaseUrl()) {
    return "ccr";
  }

  if (getFirstEnv(["OPENAI_COMPATIBLE_BASE_URL", "OPENAI_BASE_URL"])) {
    return "openai-compatible";
  }

  return "gemini";
}

function createGateway(): LlmGateway {
  const provider = getConfiguredLlmProvider();
  if (provider === "ccr") {
    return new CcrGateway();
  }
  if (provider === "openai-compatible") {
    return new OpenAiCompatibleGateway();
  }
  return new GeminiGateway();
}

export function describeLlmGatewayConfig(): Record<string, string | boolean> {
  const provider = getConfiguredLlmProvider();
  return {
    provider,
    baseUrlConfigured: provider === "ccr"
      ? Boolean(getCcrBaseUrl())
      : provider === "openai-compatible"
        ? Boolean(getOpenAiCompatibleBaseUrl())
        : false,
    apiKeyConfigured: provider === "ccr"
      ? Boolean(getCcrApiKey())
      : provider === "openai-compatible"
        ? Boolean(getOpenAiCompatibleApiKey())
        : Boolean(getEnv("GEMINI_API_KEY")),
  };
}

export const llmGateway: LlmGateway = createGateway();

const deprecatedModelAliases: Record<string, string> = {
  "gemini-2.5-flash-preview-04-17": "gemini-2.5-flash",
  "gemini-2.5-pro-preview-05-06": "gemini-2.5-pro",
};

export function resolveModel(requestedModel: unknown, fallback: string): string {
  if (typeof requestedModel !== "string" || !requestedModel.trim()) {
    return fallback;
  }

  const model = requestedModel.trim();
  return deprecatedModelAliases[model] ?? model;
}

export function formatLlmError(error: unknown): string {
  return formatErrorEnvelope(
    createErrorEnvelope(error, {
      source: "backend",
      stage: "llm_request",
      provider: getConfiguredLlmProvider(),
    })
  );
}
