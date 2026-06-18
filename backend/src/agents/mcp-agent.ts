import { RunnableConfig } from "@langchain/core/runnables";
import { END, MessagesAnnotation, START, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";

import { getEnv } from "../platform/env.js";
import { llmGateway } from "../platform/llm-gateway.js";
import { mcpSystemMessage } from "../prompts.js";
import { loadAgentTools } from "../tools/registry.js";
import { normalizeAiMessageForStream } from "./message-normalization.js";

const tools = await loadAgentTools("mcp_agent", { includeMcp: true });
const toolNode = new ToolNode(tools);

function shouldContinue(state: typeof MessagesAnnotation.State): "tools" | typeof END {
  const lastMessage = state.messages[state.messages.length - 1] as {
    tool_calls?: unknown[];
  };
  return lastMessage?.tool_calls?.length ? "tools" : END;
}

async function callModel(
  state: typeof MessagesAnnotation.State,
  _config: RunnableConfig
): Promise<typeof MessagesAnnotation.Update> {
  const llm = llmGateway.createChatModel({
    purpose: "tool",
    model: getEnv("MCP_AGENT_MODEL").trim() || undefined,
    temperature: Number(process.env.MCP_AGENT_TEMPERATURE ?? 0.2),
  });

  if (!llm.bindTools) {
    throw new Error("The selected model does not support bindTools.");
  }

  const modelWithTools = llm.bindTools(tools);
  const response = await modelWithTools.invoke([
    { role: "system", content: mcpSystemMessage },
    ...state.messages,
  ]);

  return {
    messages: [normalizeAiMessageForStream(response)],
  };
}

const builder = new StateGraph(MessagesAnnotation)
  .addNode("call_model", callModel)
  .addNode("tools", toolNode)
  .addEdge(START, "call_model")
  .addConditionalEdges("call_model", shouldContinue, {
    tools: "tools",
    [END]: END,
  })
  .addEdge("tools", "call_model");

export const mcpAgentGraph = builder.compile();
