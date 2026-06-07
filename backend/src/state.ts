import {
  AIMessage,
  BaseMessage,
  HumanMessage,
} from "@langchain/core/messages";

export interface MessageState {
  messages: BaseMessage[];
}

export function getMessageType(message: BaseMessage | undefined): string | undefined {
  if (!message) {
    return undefined;
  }

  const maybeTypedMessage = message as BaseMessage & {
    type?: string;
    role?: string;
    _getType?: () => string;
    getType?: () => string;
  };

  return (
    maybeTypedMessage.type ??
    maybeTypedMessage.role ??
    maybeTypedMessage.getType?.() ??
    maybeTypedMessage._getType?.()
  );
}

export function isHumanMessage(message: BaseMessage | undefined): boolean {
  return message instanceof HumanMessage || getMessageType(message) === "human";
}

export function isAiMessage(message: BaseMessage | undefined): boolean {
  return message instanceof AIMessage || getMessageType(message) === "ai";
}

export function getLatestUserMessage(messages: BaseMessage[]): string {
  const latest = [...messages].reverse().find((message) => {
    return isHumanMessage(message);
  });
  return messageContentToString(latest);
}

export function buildConversationContext(messages: BaseMessage[]): string {
  return messages
    .slice(-10)
    .map((message) => {
      const role = isHumanMessage(message) ? "Human" : "Assistant";
      return `${role}: ${messageContentToString(message)}`;
    })
    .join("\n");
}

export function getResearchTopic(messages: BaseMessage[]): string {
  if (messages.length === 1) {
    return messageContentToString(messages[0]);
  }
  return messages
    .map((message) => {
      const role = isAiMessage(message) ? "Assistant" : "User";
      return `${role}: ${messageContentToString(message)}`;
    })
    .join("\n");
}

export function messageContentToString(message?: BaseMessage): string {
  if (!message) {
    return "";
  }
  if (typeof message.content === "string") {
    return message.content;
  }
  return JSON.stringify(message.content);
}
