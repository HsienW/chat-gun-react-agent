import { AIMessage, BaseMessage, ToolMessage } from "@langchain/core/messages";
import type { UsageMetadata } from "@langchain/core/messages";
import type { ToolCall } from "@langchain/core/messages/tool";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

import { getEnv } from "./env.js";
import { createErrorEnvelope, formatErrorEnvelope } from "./errors.js";
import { configureNetwork } from "./network.js";

configureNetwork();

export type ModelPurpose = "chat" | "math" | "research" | "vision" | "tool";

export type ChatResponseFormat = {
  type: "json_object";
};

export interface ChatModelOptions {
  model?: string;
  purpose?: ModelPurpose;
  temperature?: number;
  maxRetries?: number;
  responseFormat?: ChatResponseFormat;
  toolChoice?: "auto" | "none" | { type: "function"; function: { name: string } };
}

type ChatModelInput = unknown;
type ChatModelOutput = BaseMessage;

export interface ChatModelInvoker {
  invoke(input: ChatModelInput): Promise<ChatModelOutput>;
  bindTools?: (
    tools: StructuredToolInterface[],
    kwargs?: Pick<ChatModelOptions, "toolChoice">
  ) => ChatModelInvoker;
}

export interface LlmGateway {
  createChatModel(options?: ChatModelOptions): ChatModelInvoker;
}

export type LlmProviderName = "ccr" | "openai-compatible" | "qwen";
export type LlmEndpointKind = "anthropic-messages" | "openai-chat-completions";

export type LlmCapabilities = {
  supportsStructuredOutput: boolean;
  supportsToolCalling: boolean;
  supportsVision: boolean;
  supportsStreaming: boolean;
  supportsUsageMetadata: boolean;
};

type LlmResponseDiagnostics = {
  provider: LlmProviderName;
  endpointKind: LlmEndpointKind;
  responseContentLength: number;
  jsonParseFailureCode?: "llm_response_json_parse_failed";
};

type JsonSchema = {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  additionalProperties?: boolean | JsonSchema;
};

type OpenAiContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: string | { url?: string } };

type OpenAiToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JsonSchema;
  };
};

type OpenAiToolCall = {
  id?: string;
  type?: "function";
  function?: {
    name?: string;
    arguments?: unknown;
  };
};

type OpenAiChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | OpenAiContentPart[] | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
};

type OpenAiChatCompletionResponse = {
  id?: unknown;
  model?: unknown;
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    total_tokens?: unknown;
  };
  choices?: Array<{
    finish_reason?: unknown;
    message?: {
      content?: unknown;
      tool_calls?: unknown;
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

class ProviderHttpError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly provider: LlmProviderName,
    readonly endpointKind: LlmEndpointKind,
    readonly responseContentLength: number
  ) {
    super(message);
    this.name = "ProviderHttpError";
  }
}

class ProviderResponseParseError extends Error {
  constructor(
    message: string,
    readonly provider: LlmProviderName,
    readonly endpointKind: LlmEndpointKind,
    readonly responseContentLength: number
  ) {
    super(message);
    this.name = "ProviderResponseParseError";
  }
}

function responseDiagnostics(
  provider: LlmProviderName,
  endpointKind: LlmEndpointKind,
  responseText: string,
  jsonParseFailureCode?: LlmResponseDiagnostics["jsonParseFailureCode"]
): LlmResponseDiagnostics {
  return {
    provider,
    endpointKind,
    responseContentLength: responseText.length,
    ...(jsonParseFailureCode ? { jsonParseFailureCode } : {}),
  };
}

function formatResponseDiagnostics(diagnostics: LlmResponseDiagnostics): string {
  return JSON.stringify(diagnostics);
}

function parseJsonResponse<T>(
  responseText: string,
  provider: LlmProviderName,
  endpointKind: LlmEndpointKind
): T {
  try {
    return JSON.parse(responseText) as T;
  } catch {
    const diagnostics = responseDiagnostics(
      provider,
      endpointKind,
      responseText,
      "llm_response_json_parse_failed"
    );
    throw new ProviderResponseParseError(
      `LLM gateway response JSON parse failed: ${formatResponseDiagnostics(diagnostics)}`,
      provider,
      endpointKind,
      responseText.length
    );
  }
}

function endpointKindForProvider(provider: LlmProviderName): LlmEndpointKind {
  if (provider === "ccr") {
    return "anthropic-messages";
  }
  return "openai-chat-completions";
}

function capabilitiesForProvider(provider: LlmProviderName, purpose: ModelPurpose): LlmCapabilities {
  if (provider === "ccr") {
    return {
      supportsStructuredOutput: false,
      supportsToolCalling: false,
      supportsVision: false,
      supportsStreaming: false,
      supportsUsageMetadata: false,
    };
  }

  return {
    supportsStructuredOutput: true,
    supportsToolCalling: true,
    supportsVision: purpose === "vision",
    supportsStreaming: false,
    supportsUsageMetadata: true,
  };
}

function assertProviderCapability(
  capabilities: LlmCapabilities,
  provider: LlmProviderName,
  endpointKind: LlmEndpointKind,
  capability: keyof Pick<LlmCapabilities, "supportsStructuredOutput" | "supportsToolCalling">
): void {
  if (capabilities[capability]) {
    return;
  }

  throw new Error(
    `Provider ${provider} endpoint ${endpointKind} does not support ${capability}.`
  );
}

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
    "CCR_BASE_URL",
  ]);
}

function getOpenAiCompatibleApiKey(): string {
  return getFirstEnv([
    "OPENAI_COMPATIBLE_API_KEY",
    "OPENAI_API_KEY",
    "CCR_API_KEY",
  ]);
}

function getQwenBaseUrl(): string {
  return getEnv("QWEN_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1").trim();
}

function getQwenApiKey(): string {
  return getEnv("QWEN_API_KEY").trim();
}

function getLegacyPurposeModel(purpose: ModelPurpose): string {
  switch (purpose) {
    case "chat":
      return getFirstEnv(["CHAT_MODEL", "DEFAULT_MODEL"]);
    case "math":
      return getFirstEnv(["MATH_MODEL", "CHAT_MODEL", "DEFAULT_MODEL"]);
    case "research":
    case "vision":
      return getEnv("DEFAULT_MODEL").trim();
    case "tool":
      return getFirstEnv(["MCP_AGENT_MODEL", "CHAT_MODEL", "DEFAULT_MODEL"]);
  }
}

function resolveQwenModel(purpose: ModelPurpose, requestedModel: string | undefined): string {
  const requested = requestedModel?.trim();
  if (requested) {
    return requested;
  }

  const qwenPurposeModel =
    purpose === "research"
      ? getFirstEnv(["QWEN_RESEARCH_MODEL", "QWEN_CHAT_MODEL"])
      : purpose === "vision"
        ? getEnv("QWEN_VISION_MODEL").trim()
        : purpose === "tool"
          ? getFirstEnv(["QWEN_TOOL_MODEL", "QWEN_CHAT_MODEL"])
          : getEnv("QWEN_CHAT_MODEL").trim();

  const fallback =
    purpose === "vision"
      ? "qwen-vl-plus"
      : "qwen-plus";

  return qwenPurposeModel || getLegacyPurposeModel(purpose) || fallback;
}

function getOpenAiCompatibleModel(requestedModel: string | undefined, purpose: ModelPurpose): string {
  const configuredModel = getFirstEnv([
    "OPENAI_COMPATIBLE_MODEL",
    "OPENAI_MODEL",
    "CCR_MODEL",
    ...(
      purpose === "tool"
        ? ["MCP_AGENT_MODEL"]
        : purpose === "math"
          ? ["MATH_MODEL"]
          : purpose === "chat"
            ? ["CHAT_MODEL"]
            : []
    ),
    "DEFAULT_MODEL",
  ]);
  const requested = requestedModel?.trim();

  if (requested) {
    return requested;
  }

  return configuredModel || requested || "gpt-4o-mini";
}

function resolveProviderModel(
  provider: LlmProviderName,
  purpose: ModelPurpose,
  requestedModel: string | undefined
): string {
  const requested = requestedModel?.trim();
  if (provider === "qwen") {
    return resolveQwenModel(purpose, requested);
  }
  if (provider === "openai-compatible") {
    return getOpenAiCompatibleModel(requested, purpose);
  }
  if (provider === "ccr") {
    return getCcrModel(requested);
  }
  return resolveQwenModel(purpose, requested);
}

export function buildChatCompletionsUrl(baseUrl: string): string {
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

function isSupportedContentPart(part: unknown): part is OpenAiContentPart {
  if (!part || typeof part !== "object") {
    return false;
  }
  const record = part as Record<string, unknown>;
  if (record.type === "text" && typeof record.text === "string") {
    return true;
  }
  return record.type === "image_url" && (
    typeof record.image_url === "string" ||
    Boolean(record.image_url && typeof record.image_url === "object")
  );
}

function contentToOpenAiContent(content: unknown): OpenAiChatMessage["content"] {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const parts = content.filter(isSupportedContentPart);
    if (parts.length === content.length && parts.length > 0) {
      return parts;
    }
    return contentToString(content);
  }
  return content === undefined || content === null ? "" : contentToString(content);
}

function openAiToolCallsFromMessage(message: BaseMessage): OpenAiChatMessage["tool_calls"] {
  const toolCalls = (message as { tool_calls?: ToolCall[] }).tool_calls;
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    return undefined;
  }

  return toolCalls.map((toolCall, index) => ({
    id: toolCall.id ?? `tool-call-${toolCall.name}-${index}`,
    type: "function" as const,
    function: {
      name: toolCall.name,
      arguments: JSON.stringify(toolCall.args ?? {}),
    },
  }));
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

  return input.map((message) => {
    const role = roleForMessage(message);
    const content =
      message &&
      typeof message === "object" &&
      "content" in message
        ? contentToOpenAiContent((message as { content?: unknown }).content)
        : contentToString(message);

    if (role === "tool") {
      const toolMessage = message as ToolMessage;
      return {
        role,
        content: contentToString(content),
        tool_call_id: toolMessage.tool_call_id,
      };
    }

    if (role === "assistant" && message instanceof BaseMessage) {
      return {
        role,
        content: content ?? "",
        tool_calls: openAiToolCallsFromMessage(message),
      };
    }

    return {
      role,
      content,
    };
  });
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

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function usageMetadataFromResponse(
  usage: OpenAiChatCompletionResponse["usage"] | undefined
): UsageMetadata | undefined {
  const input = numberOrUndefined(usage?.prompt_tokens);
  const output = numberOrUndefined(usage?.completion_tokens);
  const total = numberOrUndefined(usage?.total_tokens);
  if (input === undefined && output === undefined && total === undefined) {
    return undefined;
  }
  return {
    input_tokens: input ?? 0,
    output_tokens: output ?? 0,
    total_tokens: total ?? (input ?? 0) + (output ?? 0),
  };
}

function parseToolCallArgs(rawArgs: unknown): Record<string, unknown> {
  if (!rawArgs) {
    return {};
  }
  if (typeof rawArgs === "object" && !Array.isArray(rawArgs)) {
    return rawArgs as Record<string, unknown>;
  }
  if (typeof rawArgs !== "string") {
    return {};
  }
  try {
    const parsed = JSON.parse(rawArgs) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function parseOpenAiToolCalls(value: unknown): ToolCall[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry, index): ToolCall[] => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const toolCall = entry as OpenAiToolCall;
    const name = toolCall.function?.name;
    if (!name) {
      return [];
    }
    return [{
      id: toolCall.id ?? `tool-call-${name}-${index}`,
      name,
      args: parseToolCallArgs(toolCall.function?.arguments),
      type: "tool_call",
    }];
  });
}

function jsonSchemaFromZod(schema: unknown): JsonSchema {
  if (!schema || typeof schema !== "object" || !("_def" in schema)) {
    return { type: "object", additionalProperties: true };
  }

  const zodSchema = schema as z.ZodTypeAny;
  const def = zodSchema._def as { typeName?: z.ZodFirstPartyTypeKind; [key: string]: unknown };
  const description = typeof zodSchema.description === "string" ? zodSchema.description : undefined;

  switch (def.typeName) {
    case z.ZodFirstPartyTypeKind.ZodObject: {
      const shapeFactory = def.shape;
      const shape = typeof shapeFactory === "function"
        ? shapeFactory() as Record<string, z.ZodTypeAny>
        : {};
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = jsonSchemaFromZod(value);
        if (!(value instanceof z.ZodOptional) && !(value instanceof z.ZodDefault)) {
          required.push(key);
        }
      }
      return {
        type: "object",
        ...(description ? { description } : {}),
        properties,
        ...(required.length ? { required } : {}),
        additionalProperties: false,
      };
    }
    case z.ZodFirstPartyTypeKind.ZodString:
      return { type: "string", ...(description ? { description } : {}) };
    case z.ZodFirstPartyTypeKind.ZodNumber:
      return { type: "number", ...(description ? { description } : {}) };
    case z.ZodFirstPartyTypeKind.ZodBoolean:
      return { type: "boolean", ...(description ? { description } : {}) };
    case z.ZodFirstPartyTypeKind.ZodArray: {
      const itemType = def.type;
      return {
        type: "array",
        ...(description ? { description } : {}),
        items: jsonSchemaFromZod(itemType),
      };
    }
    case z.ZodFirstPartyTypeKind.ZodEnum:
      return {
        type: "string",
        ...(description ? { description } : {}),
        enum: Array.isArray(def.values) ? def.values : undefined,
      };
    case z.ZodFirstPartyTypeKind.ZodOptional:
    case z.ZodFirstPartyTypeKind.ZodDefault:
      return jsonSchemaFromZod(def.innerType);
    case z.ZodFirstPartyTypeKind.ZodEffects:
      return jsonSchemaFromZod(def.schema);
    case z.ZodFirstPartyTypeKind.ZodLiteral:
      return {
        enum: "value" in def ? [def.value] : undefined,
        ...(description ? { description } : {}),
      };
    default:
      return { type: "object", ...(description ? { description } : {}), additionalProperties: true };
  }
}

function toOpenAiTool(tool: StructuredToolInterface): OpenAiToolDefinition {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: jsonSchemaFromZod(tool.schema),
    },
  };
}

function sanitizeHeaderValue(value: string): string {
  return value ? "[redacted]" : "";
}

function createProviderHttpError(
  status: number,
  statusText: string,
  responseText: string,
  provider: LlmProviderName,
  endpointKind: LlmEndpointKind
): ProviderHttpError {
  return new ProviderHttpError(
    `Provider request failed: [${status} ${statusText}] ${formatResponseDiagnostics(
      responseDiagnostics(provider, endpointKind, responseText)
    )}`,
    status,
    provider,
    endpointKind,
    responseText.length
  );
}

class OpenAiCompatibleChatModel implements ChatModelInvoker {
  constructor(
    private readonly options: Required<Pick<ChatModelOptions, "temperature" | "maxRetries">> & {
      model: string;
      baseUrl: string;
      provider: Extract<LlmProviderName, "openai-compatible" | "qwen">;
      apiKey?: string;
      purpose: ModelPurpose;
      responseFormat?: ChatResponseFormat;
      tools?: OpenAiToolDefinition[];
      toolChoice?: ChatModelOptions["toolChoice"];
    }
  ) {}

  bindTools(
    tools: StructuredToolInterface[],
    kwargs?: Pick<ChatModelOptions, "toolChoice">
  ): ChatModelInvoker {
    assertProviderCapability(
      capabilitiesForProvider(this.options.provider, this.options.purpose),
      this.options.provider,
      "openai-chat-completions",
      "supportsToolCalling"
    );

    return new OpenAiCompatibleChatModel({
      ...this.options,
      tools: tools.map(toOpenAiTool),
      toolChoice: kwargs?.toolChoice ?? this.options.toolChoice ?? "auto",
    });
  }

  async invoke(input: ChatModelInput): Promise<ChatModelOutput> {
    const url = buildChatCompletionsUrl(this.options.baseUrl);
    const endpointKind: LlmEndpointKind = "openai-chat-completions";
    const capabilities = capabilitiesForProvider(this.options.provider, this.options.purpose);
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };

    if (this.options.apiKey) {
      headers.authorization = `Bearer ${this.options.apiKey}`;
    }

    if (this.options.purpose === "vision" && !capabilities.supportsVision) {
      throw new Error(
        `Selected provider does not support vision: ${JSON.stringify({
          provider: this.options.provider,
          endpointKind,
          model: this.options.model,
        })}`
      );
    }

    if (this.options.responseFormat) {
      assertProviderCapability(
        capabilities,
        this.options.provider,
        endpointKind,
        "supportsStructuredOutput"
      );
    }

    let lastError: Error | undefined;
    const attempts = Math.max(1, this.options.maxRetries + 1);
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const body = {
          model: this.options.model,
          temperature: this.options.temperature,
          messages: toOpenAiMessages(input),
          ...(this.options.responseFormat ? { response_format: this.options.responseFormat } : {}),
          ...(this.options.tools?.length ? { tools: this.options.tools } : {}),
          ...(this.options.tools?.length
            ? { tool_choice: this.options.toolChoice ?? "auto" }
            : {}),
        };
        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
        const responseText = await response.text();

        if (!response.ok) {
          throw createProviderHttpError(
            response.status,
            response.statusText,
            responseText,
            this.options.provider,
            endpointKind
          );
        }

        const parsed = parseJsonResponse<OpenAiChatCompletionResponse>(
          responseText,
          this.options.provider,
          endpointKind
        );
        const choice = parsed.choices?.[0];
        const message = choice?.message;
        const toolCalls = parseOpenAiToolCalls(message?.tool_calls);
        const content = contentToString(message?.content);
        return new AIMessage({
          content: toolCalls.length ? "" : content,
          tool_calls: toolCalls.length ? toolCalls : undefined,
          usage_metadata: usageMetadataFromResponse(parsed.usage),
          response_metadata: {
            provider: this.options.provider,
            endpointKind,
            model: typeof parsed.model === "string" ? parsed.model : this.options.model,
            id: typeof parsed.id === "string" ? parsed.id : undefined,
            finish_reason: choice?.finish_reason,
            capabilities,
          },
        });
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt >= attempts) {
          throw lastError;
        }
      }
    }

    throw lastError ?? new Error("OpenAI-compatible chat completion failed.");
  }

  redactForDiagnostics(): Record<string, unknown> {
    return {
      ...this.options,
      apiKey: this.options.apiKey ? sanitizeHeaderValue(this.options.apiKey) : undefined,
    };
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
    const purpose = options.purpose ?? "chat";

    return new OpenAiCompatibleChatModel({
      model: resolveProviderModel("openai-compatible", purpose, options.model),
      baseUrl,
      provider: "openai-compatible",
      apiKey: getOpenAiCompatibleApiKey() || undefined,
      temperature: options.temperature ?? 0.7,
      maxRetries: options.maxRetries ?? 2,
      purpose,
      responseFormat: options.responseFormat,
      toolChoice: options.toolChoice,
    });
  }
}

class QwenGateway implements LlmGateway {
  createChatModel(options: ChatModelOptions = {}): ChatModelInvoker {
    const purpose = options.purpose ?? "chat";
    return new OpenAiCompatibleChatModel({
      model: resolveProviderModel("qwen", purpose, options.model),
      baseUrl: getQwenBaseUrl(),
      provider: "qwen",
      apiKey: getQwenApiKey() || undefined,
      temperature: options.temperature ?? 0.7,
      maxRetries: options.maxRetries ?? 2,
      purpose,
      responseFormat: options.responseFormat,
      toolChoice: options.toolChoice,
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
    const provider: LlmProviderName = "ccr";
    const endpointKind: LlmEndpointKind = "anthropic-messages";
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
        const responseText = await response.text();

        if (!response.ok) {
          throw createProviderHttpError(
            response.status,
            response.statusText,
            responseText,
            provider,
            endpointKind
          );
        }

        const parsed = parseJsonResponse<AnthropicMessagesResponse>(
          responseText,
          provider,
          endpointKind
        );
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
    const provider: LlmProviderName = "ccr";
    const purpose = options.purpose ?? "chat";
    const endpointKind: LlmEndpointKind = "anthropic-messages";

    if (options.responseFormat) {
      assertProviderCapability(
        capabilitiesForProvider(provider, purpose),
        provider,
        endpointKind,
        "supportsStructuredOutput"
      );
    }

    return new CcrAnthropicChatModel({
      model: resolveProviderModel(provider, purpose, options.model),
      baseUrl,
      apiKey: getCcrApiKey() || undefined,
      temperature: options.temperature ?? 0.7,
      maxRetries: options.maxRetries ?? 2,
    });
  }
}

export function getConfiguredLlmProvider(): LlmProviderName {
  const provider = getEnv("LLM_PROVIDER").trim().toLowerCase();
  if (provider === "qwen") {
    return "qwen";
  }

  if (provider === "ccr") {
    return "ccr";
  }

  if (provider === "openai" || provider === "openai-compatible") {
    return "openai-compatible";
  }
  if (provider) {
    throw new Error(
      `Unsupported LLM_PROVIDER "${provider}". Supported providers: qwen, ccr, openai-compatible.`
    );
  }

  if (getCcrBaseUrl()) {
    return "ccr";
  }

  if (getFirstEnv(["OPENAI_COMPATIBLE_BASE_URL", "OPENAI_BASE_URL"])) {
    return "openai-compatible";
  }

  return "qwen";
}

function createGateway(): LlmGateway {
  const provider = getConfiguredLlmProvider();
  if (provider === "qwen") {
    return new QwenGateway();
  }
  if (provider === "ccr") {
    return new CcrGateway();
  }
  if (provider === "openai-compatible") {
    return new OpenAiCompatibleGateway();
  }
  return new QwenGateway();
}

export function describeLlmGatewayConfig(): Record<string, string | boolean> {
  const provider = getConfiguredLlmProvider();
  return {
    provider,
    endpointKind: endpointKindForProvider(provider),
    baseUrlConfigured: provider === "ccr"
      ? Boolean(getCcrBaseUrl())
      : provider === "openai-compatible"
        ? Boolean(getOpenAiCompatibleBaseUrl())
        : Boolean(getQwenBaseUrl()),
    apiKeyConfigured: provider === "ccr"
      ? Boolean(getCcrApiKey())
      : provider === "openai-compatible"
        ? Boolean(getOpenAiCompatibleApiKey())
        : Boolean(getQwenApiKey()),
  };
}

export function getConfiguredLlmCapabilities(
  purpose: ModelPurpose = "chat"
): Readonly<LlmCapabilities> {
  return capabilitiesForProvider(getConfiguredLlmProvider(), purpose);
}

export const llmGateway: LlmGateway = createGateway();

export function resolveModel(requestedModel: unknown, fallback: string): string {
  if (typeof requestedModel !== "string" || !requestedModel.trim()) {
    return fallback;
  }

  return requestedModel.trim();
}

export function resolveModelForPurpose(
  purpose: ModelPurpose,
  requestedModel?: string
): string {
  return resolveProviderModel(getConfiguredLlmProvider(), purpose, requestedModel);
}

export function formatLlmError(error: unknown): string {
  return formatErrorEnvelope(
    createErrorEnvelope(error, {
      source: "backend",
      stage: "llm_request",
      provider: getConfiguredLlmProvider(),
      details:
        error instanceof ProviderHttpError
          ? {
              statusCode: error.statusCode,
              endpointKind: error.endpointKind,
              responseContentLength: error.responseContentLength,
            }
          : error instanceof ProviderResponseParseError
            ? {
                endpointKind: error.endpointKind,
                responseContentLength: error.responseContentLength,
              }
            : undefined,
    })
  );
}
