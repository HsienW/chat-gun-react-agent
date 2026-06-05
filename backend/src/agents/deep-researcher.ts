import { BaseMessage } from "@langchain/core/messages";
import { RunnableConfig } from "@langchain/core/runnables";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

import {
  buildQueryWriterPrompt,
  buildResearchAnswerPrompt,
} from "../prompts.js";
import { llmGateway, resolveModel } from "../platform/llm-gateway.js";
import { getResearchTopic, messageContentToString } from "../state.js";

const DeepResearchState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  query_list: Annotation<string[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  search_query: Annotation<string[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  web_research_result: Annotation<string[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  sources_gathered: Annotation<Array<Record<string, unknown>>>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  initial_search_query_count: Annotation<number>({
    reducer: (_left, right) => right,
    default: () => 3,
  }),
  max_research_loops: Annotation<number>({
    reducer: (_left, right) => right,
    default: () => 1,
  }),
  research_loop_count: Annotation<number>({
    reducer: (_left, right) => right,
    default: () => 0,
  }),
  reasoning_model: Annotation<string>({
    reducer: (_left, right) => right,
    default: () => "gemini-2.5-flash",
  }),
});

function extractJsonCandidate(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) {
    return fenced.trim();
  }

  const objectMatch = text.match(/\{[\s\S]*\}/);
  return objectMatch ? objectMatch[0] : text;
}

function parseQueryList(
  content: string,
  researchTopic: string,
  queryCount: number
): string[] {
  try {
    const parsed = JSON.parse(extractJsonCandidate(content)) as {
      query?: unknown;
    };
    if (Array.isArray(parsed.query)) {
      const queries = parsed.query
        .filter((query): query is string => typeof query === "string")
        .map((query) => query.trim())
        .filter((query) => query.length > 0);

      if (queries.length > 0) {
        return queries.slice(0, queryCount);
      }
    }
  } catch {
    // Gemini can return non-JSON text; fallback keeps the research flow runnable.
  }

  return Array.from({ length: queryCount }, (_, index) => {
    return `${researchTopic} research angle ${index + 1}`;
  });
}

async function generateQuery(
  state: typeof DeepResearchState.State,
  _config: RunnableConfig
): Promise<Partial<typeof DeepResearchState.State>> {
  const queryCount = state.initial_search_query_count || 3;
  const researchTopic = getResearchTopic(state.messages);
  const llm = llmGateway.createChatModel({
    model: "gemini-2.5-flash",
    temperature: 0.4,
  });
  const response = await llm.invoke(
    buildQueryWriterPrompt(researchTopic, queryCount)
  );

  return {
    query_list: parseQueryList(
      messageContentToString(response),
      researchTopic,
      queryCount
    ),
  };
}

async function webResearch(
  state: typeof DeepResearchState.State,
  _config: RunnableConfig
): Promise<Partial<typeof DeepResearchState.State>> {
  const llm = llmGateway.createChatModel({
    model: "gemini-2.5-flash",
    temperature: 0,
  });
  const queries = state.query_list.length
    ? state.query_list
    : [getResearchTopic(state.messages)];

  const summaries = await Promise.all(
    queries.map(async (query) => {
      const response = await llm.invoke(`請針對下方 research query 產生一段簡短研究摘要。

注意：
- 這裡不是實際 web search，不要聲稱你查過網路。
- 請根據既有模型知識整理可能的重點、風險與待驗證事項。
- 如果需要最新資訊，請明確標註「需要外部 search provider 驗證」。
- 使用繁體中文回答，保留必要的 English 技術字眼。

Query: ${query}`);
      return messageContentToString(response);
    })
  );

  return {
    search_query: queries,
    web_research_result: summaries,
  };
}

async function reflection(
  state: typeof DeepResearchState.State,
  _config: RunnableConfig
): Promise<Partial<typeof DeepResearchState.State>> {
  return {
    research_loop_count: (state.research_loop_count ?? 0) + 1,
  };
}

function evaluateResearch(state: typeof DeepResearchState.State): string {
  if (state.research_loop_count >= state.max_research_loops) {
    return "finalize_answer";
  }
  return "finalize_answer";
}

async function finalizeAnswer(
  state: typeof DeepResearchState.State,
  _config: RunnableConfig
): Promise<Partial<typeof DeepResearchState.State>> {
  const reasoningModel = resolveModel(state.reasoning_model, "gemini-2.5-flash");
  const llm = llmGateway.createChatModel({
    model: reasoningModel,
    temperature: 0,
  });
  const response = await llm.invoke(
    buildResearchAnswerPrompt(
      getResearchTopic(state.messages),
      state.web_research_result.join("\n\n---\n\n")
    )
  );

  return {
    messages: [response],
    sources_gathered: state.sources_gathered,
  };
}

const builder = new StateGraph(DeepResearchState)
  .addNode("generate_query", generateQuery)
  .addNode("web_research", webResearch)
  .addNode("reflection", reflection)
  .addNode("finalize_answer", finalizeAnswer)
  .addEdge(START, "generate_query")
  .addEdge("generate_query", "web_research")
  .addEdge("web_research", "reflection")
  .addConditionalEdges("reflection", evaluateResearch, {
    finalize_answer: "finalize_answer",
  })
  .addEdge("finalize_answer", END);

export const deepResearcherGraph = builder.compile();
