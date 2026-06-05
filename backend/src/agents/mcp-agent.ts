import { RunnableConfig } from "@langchain/core/runnables";
import { END, MessagesAnnotation, START, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";

import { llmGateway } from "../platform/llm-gateway.js";
import { mcpSystemMessage } from "../prompts.js";
import { calculatorTool } from "../tools/calculator.js";
import { loadMcpTools } from "../tools/mcp-loader.js";

const localTools = [calculatorTool];
const mcpTools =
  process.env.MCP_LOAD_ON_START === "true"
    ? await loadMcpTools().catch((error) => {
        console.warn("MCP tools 載入失敗，將只使用 local tools。", error);
        return [];
      })
    : [];
const tools = [...localTools, ...mcpTools];
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
    model: process.env.MCP_AGENT_MODEL ?? "gemini-2.5-flash",
    temperature: Number(process.env.MCP_AGENT_TEMPERATURE ?? 0.2),
  });

  if (!llm.bindTools) {
    throw new Error("目前 LLM Gateway 回傳的 model 不支援 bindTools。");
  }
  const modelWithTools = llm.bindTools(tools);
  const response = await modelWithTools.invoke([
    { role: "system", content: mcpSystemMessage },
    ...state.messages,
  ]);

  return {
    messages: [response],
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
