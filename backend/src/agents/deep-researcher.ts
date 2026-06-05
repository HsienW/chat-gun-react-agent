import { AIMessage, BaseMessage } from "@langchain/core/messages";
import { RunnableConfig } from "@langchain/core/runnables";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";

import {
  buildForcedFinalResearchPrompt,
  buildToolCallingResearchSystemMessage,
} from "../prompts.js";
import { llmGateway, resolveModel } from "../platform/llm-gateway.js";
import { messageContentToString } from "../state.js";
import { loadAgentTools } from "../tools/registry.js";
import { normalizeAiMessageForStream } from "./message-normalization.js";

const DEFAULT_RESEARCH_MODEL = "gemini-2.5-flash";
const DEFAULT_TOOL_LOOP_BUDGET = 6;

const DeepResearchState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  initial_search_query_count: Annotation<number>({
    reducer: (_left, right) => right,
    default: () => 3,
  }),
  max_research_loops: Annotation<number>({
    reducer: (_left, right) => right,
    default: () => DEFAULT_TOOL_LOOP_BUDGET,
  }),
  reasoning_model: Annotation<string>({
    reducer: (_left, right) => right,
    default: () => DEFAULT_RESEARCH_MODEL,
  }),
});

const tools = await loadAgentTools("deep_researcher");
const toolNode = new ToolNode(tools);

type MessageWithToolCalls = BaseMessage & {
  tool_calls?: unknown[];
};

function extractToolCalls(message: BaseMessage | undefined): unknown[] {
  const maybeToolMessage = message as MessageWithToolCalls | undefined;

  if (Array.isArray(maybeToolMessage?.tool_calls)) {
    return maybeToolMessage.tool_calls;
  }

  if (Array.isArray(message?.content)) {
    return message.content.filter((block) => {
      return (
        block &&
        typeof block === "object" &&
        ("functionCall" in block ||
          (block as { type?: string }).type === "tool_use")
      );
    });
  }

  return [];
}

function isEmptyAiResponse(message: BaseMessage): boolean {
  return (
    messageContentToString(message).trim().length === 0 &&
    extractToolCalls(message).length === 0
  );
}

function getMessageType(message: BaseMessage): string | undefined {
  const maybeTyped = message as BaseMessage & {
    type?: string;
    _getType?: () => string;
  };

  return maybeTyped.type ?? maybeTyped._getType?.();
}

function countToolResults(messages: BaseMessage[]): number {
  return messages.filter((message) => getMessageType(message) === "tool").length;
}

function getToolLoopBudget(state: typeof DeepResearchState.State): number {
  return Math.max(
    1,
    Math.min(Number(state.max_research_loops ?? DEFAULT_TOOL_LOOP_BUDGET), 20)
  );
}

function shouldContinue(
  state: typeof DeepResearchState.State
): "tools" | "finalize_answer" | typeof END {
  const lastMessage = state.messages[
    state.messages.length - 1
  ];
  const toolCalls = extractToolCalls(lastMessage);

  if (toolCalls.length === 0) {
    return END;
  }

  if (countToolResults(state.messages) >= getToolLoopBudget(state)) {
    return "finalize_answer";
  }

  return "tools";
}

async function callModel(
  state: typeof DeepResearchState.State,
  _config: RunnableConfig
): Promise<Partial<typeof DeepResearchState.State>> {
  const model = resolveModel(state.reasoning_model, DEFAULT_RESEARCH_MODEL);
  const llm = llmGateway.createChatModel({
    model,
    temperature: 0.1,
  });

  if (!llm.bindTools) {
    throw new Error("The selected model does not support bindTools.");
  }

  const modelWithTools = llm.bindTools(tools);
  let response: BaseMessage;
  try {
    response = await modelWithTools.invoke([
      {
        role: "system",
        content: buildToolCallingResearchSystemMessage(getToolLoopBudget(state)),
      },
      ...state.messages,
    ]);
  } catch (error) {
    return {
      messages: [
        new AIMessage(
          `模型工具規劃失敗：${
            error instanceof Error ? error.message : String(error)
          }`
        ),
      ],
    };
  }

  const normalizedResponse = normalizeAiMessageForStream(response);

  if (isEmptyAiResponse(normalizedResponse)) {
    return {
      messages: [
        new AIMessage(
          "模型回傳了空白內容且沒有提出 tool call；請重試，或確認模型與工具 schema 是否相容。"
        ),
      ],
    };
  }

  return {
    messages: [normalizedResponse],
  };
}

async function finalizeAnswer(
  state: typeof DeepResearchState.State,
  _config: RunnableConfig
): Promise<Partial<typeof DeepResearchState.State>> {
  const model = resolveModel(state.reasoning_model, DEFAULT_RESEARCH_MODEL);
  const llm = llmGateway.createChatModel({
    model,
    temperature: 0,
  });
  let response: BaseMessage;
  try {
    response = await llm.invoke([
      {
        role: "system",
        content: buildForcedFinalResearchPrompt(),
      },
      ...state.messages,
    ]);
  } catch (error) {
    response = new AIMessage(
      `最終回答產生失敗：${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  return {
    messages: [normalizeAiMessageForStream(response)],
  };
}

const builder = new StateGraph(DeepResearchState)
  .addNode("call_model", callModel)
  .addNode("tools", toolNode)
  .addNode("finalize_answer", finalizeAnswer)
  .addEdge(START, "call_model")
  .addConditionalEdges("call_model", shouldContinue, {
    tools: "tools",
    finalize_answer: "finalize_answer",
    [END]: END,
  })
  .addEdge("tools", "call_model")
  .addEdge("finalize_answer", END);

export const deepResearcherGraph = builder.compile();
