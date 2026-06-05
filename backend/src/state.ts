import {
  AIMessage,
  BaseMessage,
  HumanMessage,
} from "@langchain/core/messages";

export interface MessageState {
  messages: BaseMessage[];
}

export function getLatestUserMessage(messages: BaseMessage[]): string {
  const latest = [...messages].reverse().find((message) => {
    return message instanceof HumanMessage || message.getType() === "human";
  });
  return messageContentToString(latest);
}

export function buildConversationContext(messages: BaseMessage[]): string {
  return messages
    .slice(-10)
    .map((message) => {
      const role =
        message instanceof HumanMessage || message.getType() === "human"
          ? "Human"
          : "Assistant";
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
      const role =
        message instanceof AIMessage || message.getType() === "ai"
          ? "Assistant"
          : "User";
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
