import { HumanMessage } from "@langchain/core/messages";
import { afterEach, describe, expect, it, vi } from "vitest";

import { mathAgentGraph } from "./math-agent.js";
import { llmGateway } from "../platform/llm-gateway.js";

describe("math agent deterministic calculator", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not call the model or rewrite calculator result when an expression is extractable", async () => {
    const createChatModel = vi.spyOn(llmGateway, "createChatModel");

    const result = await mathAgentGraph.invoke({
      messages: [new HumanMessage("請計算 2 + 2 * 3")],
    });
    const lastMessage = result.messages.at(-1);
    const content = String(lastMessage?.content);

    expect(createChatModel).not.toHaveBeenCalled();
    expect(content).toContain("2 + 2 * 3");
    expect(content).toContain("8");
  });
});
