import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";

import { getEnv, requireEnv } from "./env.js";

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
