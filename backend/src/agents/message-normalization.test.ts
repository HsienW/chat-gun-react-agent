import { AIMessage, isAIMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import { normalizeAiMessageForStream } from "./message-normalization.js";

describe("normalizeAiMessageForStream", () => {
  it("normalizes a provider function-call content block into a LangChain tool call", () => {
    const message = new AIMessage({
      id: "message-1",
      content: [
        {
          type: "function_call",
          functionCall: {
            name: "lookup_weather",
            args: { city: "Taipei" },
          },
        },
      ],
    });

    const normalizedMessage = normalizeAiMessageForStream(message);

    expect(isAIMessage(normalizedMessage)).toBe(true);
    if (!isAIMessage(normalizedMessage)) {
      throw new Error("Expected an AIMessage after normalization");
    }
    expect(normalizedMessage.content).toBe("");
    expect(normalizedMessage.tool_calls).toEqual([
      {
        id: "message-1-lookup_weather-0",
        name: "lookup_weather",
        args: { city: "Taipei" },
        type: "tool_call",
      },
    ]);
  });

  it("returns string-content messages unchanged", () => {
    const message = new AIMessage({
      id: "message-string",
      content: "Plain response",
      response_metadata: { provider: "test-provider" },
      usage_metadata: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
    });

    const normalizedMessage = normalizeAiMessageForStream(message);

    expect(normalizedMessage).toBe(message);
  });

  it("joins text content blocks while preserving response and usage metadata", () => {
    const responseMetadata = { provider: "test-provider" };
    const usageMetadata = { input_tokens: 4, output_tokens: 3, total_tokens: 7 };
    const message = new AIMessage({
      id: "message-text-blocks",
      content: [
        { type: "text", text: "First paragraph" },
        { type: "text", text: "Second paragraph" },
      ],
      response_metadata: responseMetadata,
      usage_metadata: usageMetadata,
    });

    const normalizedMessage = normalizeAiMessageForStream(message);

    expect(isAIMessage(normalizedMessage)).toBe(true);
    if (!isAIMessage(normalizedMessage)) {
      throw new Error("Expected an AIMessage after normalization");
    }
    expect(normalizedMessage.content).toBe("First paragraph\n\nSecond paragraph");
    expect(normalizedMessage.response_metadata).toEqual(responseMetadata);
    expect(normalizedMessage.usage_metadata).toEqual(usageMetadata);
  });

  it("prefers existing tool calls over provider function-call content blocks", () => {
    const message = new AIMessage({
      id: "message-existing-tool-call",
      content: [
        {
          type: "function_call",
          functionCall: {
            name: "provider_function",
            args: { source: "content" },
          },
        },
      ],
      tool_calls: [
        {
          name: "existing_tool",
          args: { source: "tool_calls" },
          type: "tool_call",
        },
      ],
    });

    const normalizedMessage = normalizeAiMessageForStream(message);

    expect(isAIMessage(normalizedMessage)).toBe(true);
    if (!isAIMessage(normalizedMessage)) {
      throw new Error("Expected an AIMessage after normalization");
    }
    expect(normalizedMessage.content).toBe("");
    expect(normalizedMessage.tool_calls).toEqual([
      {
        id: "message-existing-tool-call-existing_tool-0",
        name: "existing_tool",
        args: { source: "tool_calls" },
        type: "tool_call",
      },
    ]);
  });

  it("normalizes empty content arrays without dropping metadata", () => {
    const responseMetadata = { finish_reason: "stop" };
    const usageMetadata = { input_tokens: 1, output_tokens: 0, total_tokens: 1 };
    const message = new AIMessage({
      id: "message-empty-content",
      content: [],
      response_metadata: responseMetadata,
      usage_metadata: usageMetadata,
    });

    const normalizedMessage = normalizeAiMessageForStream(message);

    expect(isAIMessage(normalizedMessage)).toBe(true);
    if (!isAIMessage(normalizedMessage)) {
      throw new Error("Expected an AIMessage after normalization");
    }
    expect(normalizedMessage.content).toBe("");
    expect(normalizedMessage.tool_calls).toEqual([]);
    expect(normalizedMessage.response_metadata).toEqual(responseMetadata);
    expect(normalizedMessage.usage_metadata).toEqual(usageMetadata);
  });
});
