import { AIMessage, BaseMessage } from "@langchain/core/messages";
import type { ToolCall } from "@langchain/core/messages/tool";

type FunctionCallBlock = {
  functionCall?: {
    name?: string;
    args?: Record<string, unknown>;
  };
  type?: string;
  text?: string;
};

type MessageWithToolCalls = BaseMessage & {
  tool_calls?: ToolCall[];
};

function getTextFromContent(content: BaseMessage["content"]): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((block) => {
      if (typeof block === "string") {
        return block;
      }
      if (!block || typeof block !== "object") {
        return "";
      }
      const typedBlock = block as FunctionCallBlock;
      return typedBlock.text ?? "";
    })
    .filter((text) => text.trim().length > 0)
    .join("\n\n");
}

function getFunctionCallBlocks(content: BaseMessage["content"]): FunctionCallBlock[] {
  if (!Array.isArray(content)) {
    return [];
  }

  return content.filter((block): block is FunctionCallBlock => {
    return (
      block !== null &&
      typeof block === "object" &&
      "functionCall" in block &&
      typeof (block as FunctionCallBlock).functionCall?.name === "string"
    );
  });
}

function ensureToolCallIds(toolCalls: ToolCall[], messageId?: string): ToolCall[] {
  return toolCalls.map((toolCall, index) => ({
    ...toolCall,
    id: toolCall.id ?? `${messageId ?? "tool-call"}-${toolCall.name}-${index}`,
    type: "tool_call",
  }));
}

export function normalizeAiMessageForStream(message: BaseMessage): BaseMessage {
  const messageWithToolCalls = message as MessageWithToolCalls;
  const existingToolCalls = Array.isArray(messageWithToolCalls.tool_calls)
    ? ensureToolCallIds(messageWithToolCalls.tool_calls, message.id)
    : [];
  const functionCallToolCalls = getFunctionCallBlocks(message.content).map(
    (block, index): ToolCall => ({
      id: `${message.id ?? "function-call"}-${block.functionCall?.name}-${index}`,
      name: block.functionCall?.name ?? "tool",
      args: block.functionCall?.args ?? {},
      type: "tool_call",
    })
  );
  const toolCalls = existingToolCalls.length
    ? existingToolCalls
    : functionCallToolCalls;

  if (toolCalls.length > 0) {
    return new AIMessage({
      id: message.id,
      content: "",
      tool_calls: toolCalls,
      response_metadata: message.response_metadata,
      usage_metadata: (message as AIMessage).usage_metadata,
    });
  }

  if (Array.isArray(message.content)) {
    return new AIMessage({
      id: message.id,
      content: getTextFromContent(message.content),
      response_metadata: message.response_metadata,
      usage_metadata: (message as AIMessage).usage_metadata,
    });
  }

  return message;
}
