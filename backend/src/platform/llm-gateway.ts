import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";

import { getEnv, requireEnv } from "./env.js";
import { configureNetwork } from "./network.js";

configureNetwork();

export interface ChatModelOptions {
  model?: string;
  temperature?: number;
  maxRetries?: number;
}

export interface LlmGateway {
  createChatModel(options?: ChatModelOptions): BaseChatModel;
}

class GeminiGateway implements LlmGateway {
  createChatModel(options: ChatModelOptions = {}): BaseChatModel {
    return new ChatGoogleGenerativeAI({
      model: options.model ?? getEnv("DEFAULT_MODEL", "gemini-2.5-flash"),
      temperature: options.temperature ?? 0.7,
      maxRetries: options.maxRetries ?? 2,
      apiKey: requireEnv("GEMINI_API_KEY"),
    });
  }
}

export const llmGateway: LlmGateway = new GeminiGateway();

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
  if (!(error instanceof Error)) {
    return String(error);
  }

  const cause = error.cause as
    | { code?: string; name?: string; message?: string }
    | undefined;
  const details = [
    error.message,
    cause?.code ? `cause code: ${cause.code}` : undefined,
    cause?.message ? `cause: ${cause.message}` : undefined,
  ].filter(Boolean);

  if (
    error.message.includes("fetch failed") ||
    cause?.code === "UND_ERR_CONNECT_TIMEOUT"
  ) {
    return [
      "Gemini request failed before receiving an API response.",
      "The backend Node process cannot connect to generativelanguage.googleapis.com:443.",
      "Check VPN/proxy/firewall/DNS settings, or set HTTPS_PROXY/HTTP_PROXY before starting the backend if your network requires a proxy.",
      `Raw error: ${details.join("; ")}`,
    ].join(" ");
  }

  return details.join("; ");
}
