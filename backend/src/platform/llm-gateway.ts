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

export function resolveModel(requestedModel: unknown, fallback: string): string {
  return typeof requestedModel === "string" && requestedModel.trim()
    ? requestedModel
    : fallback;
}
