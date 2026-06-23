import { BaseMessage } from "@langchain/core/messages";

import {
  extractImageAttachmentBlocksFromContent,
  getImageUrl,
} from "./upload-security.js";
import {
  getMessageType,
  isAiMessage,
  isHumanMessage,
  messageContentToString,
} from "../state.js";

export type ImContextInputType = "text" | "image" | "audio";

export type ImAgentContextPack = {
  currentMessage: {
    text: string;
    inputType: ImContextInputType;
  };
  recentMessages: Array<{
    role: "user" | "assistant" | "system";
    content: string;
    ts: number;
  }>;
  assets: Array<{
    assetId: string;
    type: "image" | "audio";
    status: "uploaded" | "ocr_done" | "asr_done" | "failed";
    extractedText?: string;
    caption?: string;
  }>;
  businessCards: Array<{
    cardId: string;
    cardType: "coupon" | "product" | "order" | "store" | "after_sale";
    summary: string;
    payloadRef: string;
  }>;
  userProfile?: {
    memberLevel?: string;
    city?: string;
    preferences?: string[];
  };
  constraints: {
    maxTokens: number;
    locale: "zh-TW" | "zh-CN" | "en";
  };
};

export type ImContextPackOptions = {
  maxTokens: number;
  locale: ImAgentContextPack["constraints"]["locale"];
  recentMessageLimit: number;
  businessCards?: ImAgentContextPack["businessCards"];
  userProfile?: ImAgentContextPack["userProfile"];
};

const DEFAULT_CONTEXT_OPTIONS: ImContextPackOptions = {
  maxTokens: 12_000,
  locale: "zh-TW",
  recentMessageLimit: 10,
};

export function buildImAgentContextPack(
  messages: BaseMessage[],
  options: Partial<ImContextPackOptions> = {}
): ImAgentContextPack {
  const resolvedOptions = {
    ...DEFAULT_CONTEXT_OPTIONS,
    ...options,
  };
  const latestHumanMessage = [...messages].reverse().find(isHumanMessage);
  const currentText = messageContentToString(latestHumanMessage);
  const assets = messages.flatMap((message, messageIndex) =>
    getAssetsFromMessage(message, messageIndex)
  );

  return {
    currentMessage: {
      text: currentText,
      inputType: getInputType(latestHumanMessage),
    },
    recentMessages: messages
      .slice(-resolvedOptions.recentMessageLimit)
      .map((message) => ({
        role: getContextRole(message),
        content: messageContentToString(message),
        ts: getMessageTimestamp(message),
      })),
    assets,
    businessCards: resolvedOptions.businessCards ?? [],
    userProfile: resolvedOptions.userProfile,
    constraints: {
      maxTokens: resolvedOptions.maxTokens,
      locale: resolvedOptions.locale,
    },
  };
}

export function estimateContextPackTokens(contextPack: ImAgentContextPack): number {
  return Math.ceil(JSON.stringify(contextPack).length / 4);
}

function getInputType(message?: BaseMessage): ImContextInputType {
  if (!message || !Array.isArray(message.content)) return "text";

  const hasImage = extractImageAttachmentBlocksFromContent(message.content).length > 0;
  return hasImage ? "image" : "text";
}

function getAssetsFromMessage(
  message: BaseMessage,
  messageIndex: number
): ImAgentContextPack["assets"] {
  if (!Array.isArray(message.content)) return [];

  return extractImageAttachmentBlocksFromContent(message.content).map((block, index) => {
    const assetId = [
      message.id ?? `message-${messageIndex + 1}`,
      block.fileName ?? `image-${index + 1}`,
    ].join(":");

    return {
      assetId,
      type: "image",
      status: "uploaded",
      caption: [
        block.fileName,
        block.mimeType,
        typeof block.width === "number" && typeof block.height === "number"
          ? `${block.width}x${block.height}`
          : undefined,
        getImageUrl(block) ? "base64-data-url" : undefined,
      ]
        .filter(Boolean)
        .join(", "),
    };
  });
}

function getContextRole(message: BaseMessage): "user" | "assistant" | "system" {
  if (isHumanMessage(message)) return "user";
  if (isAiMessage(message)) return "assistant";
  return getMessageType(message) === "system" ? "system" : "assistant";
}

function getMessageTimestamp(message: BaseMessage): number {
  const metadata = message.response_metadata as
    | { ts?: unknown; timestamp?: unknown }
    | undefined;
  if (!metadata) return Date.now();

  const value = metadata.ts ?? metadata.timestamp;
  return typeof value === "number" ? value : Date.now();
}
