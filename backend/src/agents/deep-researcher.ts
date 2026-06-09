import { AIMessage, BaseMessage, ToolMessage } from "@langchain/core/messages";
import { RunnableConfig } from "@langchain/core/runnables";
import { StructuredToolInterface } from "@langchain/core/tools";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

import { getBooleanEnv } from "../platform/env.js";
import { formatLlmError, llmGateway, resolveModel } from "../platform/llm-gateway.js";
import { getResearchTopic, messageContentToString } from "../state.js";
import { loadAgentTools } from "../tools/registry.js";
import { normalizeAiMessageForStream } from "./message-normalization.js";

const DEFAULT_RESEARCH_MODEL = "gemini-2.5-flash";
const DEFAULT_SEARCH_QUERY_COUNT = 3;
const DEFAULT_MAX_FETCHED_SOURCES = 5;

type AnswerMode = "direct" | "weather" | "calculation" | "research" | "clarify";
type Freshness = "pd" | "pw" | "pm" | "py";

type WeatherRequest = {
  location: string;
  country?: string;
  region?: string;
};

type CalculationRequest = {
  expression: string;
};

type ResearchPlan = {
  question: string;
  answerMode: AnswerMode;
  rationale: string;
  queries: string[];
  urls: string[];
  freshness?: Freshness;
  weather?: WeatherRequest;
  calculation?: CalculationRequest;
  clarification?: string;
  requiredSourceCount: number;
};

type SearchResult = {
  title: string;
  url: string;
  snippet: string;
  query: string;
  sourceType: string;
  age?: string;
};

type RankedSource = SearchResult & {
  score: number;
  rankReason: string;
};

type FetchedSource = RankedSource & {
  content: string;
  contentType?: string;
  fetchError?: string;
};

type ExtractedSource = {
  index: number;
  title: string;
  url: string;
  summary: string;
  keyClaims: string[];
  usable: boolean;
};

type VerificationReport = {
  usableSourceCount: number;
  rejectedSourceCount: number;
  warnings: string[];
};

const DeepResearchState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  initial_search_query_count: Annotation<number>({
    reducer: (_left, right) => right,
    default: () => DEFAULT_SEARCH_QUERY_COUNT,
  }),
  max_research_loops: Annotation<number>({
    reducer: (_left, right) => right,
    default: () => DEFAULT_MAX_FETCHED_SOURCES,
  }),
  reasoning_model: Annotation<string>({
    reducer: (_left, right) => right,
    default: () => DEFAULT_RESEARCH_MODEL,
  }),
  plan: Annotation<ResearchPlan | undefined>({
    reducer: (_left, right) => right,
    default: () => undefined,
  }),
  searchResults: Annotation<SearchResult[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  rankedSources: Annotation<RankedSource[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  fetchedSources: Annotation<FetchedSource[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  extractedSources: Annotation<ExtractedSource[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  verification: Annotation<VerificationReport | undefined>({
    reducer: (_left, right) => right,
    default: () => undefined,
  }),
});

const tools = await loadAgentTools("deep_researcher", {
  includeMcp: getBooleanEnv("DEEP_RESEARCHER_MCP_ENABLED", false),
});
const toolByName = new Map(tools.map((tool) => [tool.name, tool]));

function today(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(Math.trunc(parsed), max));
}

function getMaxFetchedSources(state: typeof DeepResearchState.State): number {
  return clampInt(state.max_research_loops, DEFAULT_MAX_FETCHED_SOURCES, 1, 10);
}

function normalizeUrlForDedup(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_") || key.toLowerCase() === "fbclid") {
        url.searchParams.delete(key);
      }
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return rawUrl.trim();
  }
}

function extractJsonObject(raw: string): string | undefined {
  const withoutFence = raw.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return undefined;
  }
  return withoutFence.slice(start, end + 1);
}

function parseJsonObject<T>(raw: string): T | undefined {
  const json = extractJsonObject(raw);
  if (!json) {
    return undefined;
  }
  try {
    return JSON.parse(json) as T;
  } catch {
    return undefined;
  }
}

function uniqueStrings(values: unknown[], max: number): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const normalized = value.trim();
    if (!normalized || seen.has(normalized.toLowerCase())) {
      continue;
    }
    seen.add(normalized.toLowerCase());
    output.push(normalized);
    if (output.length >= max) {
      break;
    }
  }
  return output;
}

function fallbackPlan(question: string, state: typeof DeepResearchState.State): ResearchPlan {
  const weatherPattern = /weather|temperature|forecast|rain|humidity|wind|天氣|天气|氣溫|气温|溫度|温度|下雨|降雨|濕度|湿度|風|风/iu;
  const currentPattern = /today|latest|recent|current|now|202[0-9]|目前|現在|今天|最新|最近|即時|实时/iu;
  const calculationPattern = /^[\s\d+\-*/().,^%]+$/u;
  const queryCount = clampInt(
    state.initial_search_query_count,
    DEFAULT_SEARCH_QUERY_COUNT,
    1,
    5
  );

  if (weatherPattern.test(question)) {
    return {
      question,
      answerMode: "weather",
      rationale: "The question asks for weather data.",
      queries: [],
      urls: [],
      weather: { location: question },
      requiredSourceCount: 1,
    };
  }

  if (calculationPattern.test(question.trim())) {
    return {
      question,
      answerMode: "calculation",
      rationale: "The question is a mathematical expression.",
      queries: [],
      urls: [],
      calculation: { expression: question.trim() },
      requiredSourceCount: 1,
    };
  }

  return {
    question,
    answerMode: currentPattern.test(question) ? "research" : "direct",
    rationale: "Fallback plan created without structured planner output.",
    queries: uniqueStrings([question, `${question} ${today()}`], queryCount),
    urls: [],
    requiredSourceCount: 3,
  };
}

function coercePlan(rawPlan: Partial<ResearchPlan> | undefined, question: string, state: typeof DeepResearchState.State): ResearchPlan {
  const fallback = fallbackPlan(question, state);
  const modes: AnswerMode[] = ["direct", "weather", "calculation", "research", "clarify"];
  const answerMode = modes.includes(rawPlan?.answerMode as AnswerMode)
    ? (rawPlan?.answerMode as AnswerMode)
    : fallback.answerMode;
  const maxQueries = clampInt(state.initial_search_query_count, DEFAULT_SEARCH_QUERY_COUNT, 1, 5);

  return {
    question: typeof rawPlan?.question === "string" && rawPlan.question.trim() ? rawPlan.question.trim() : question,
    answerMode,
    rationale: typeof rawPlan?.rationale === "string" ? rawPlan.rationale : fallback.rationale,
    queries: uniqueStrings(Array.isArray(rawPlan?.queries) ? rawPlan.queries : fallback.queries, maxQueries),
    urls: uniqueStrings(Array.isArray(rawPlan?.urls) ? rawPlan.urls : [], 5),
    freshness: ["pd", "pw", "pm", "py"].includes(rawPlan?.freshness as string)
      ? (rawPlan?.freshness as Freshness)
      : undefined,
    weather:
      rawPlan?.weather && typeof rawPlan.weather.location === "string"
        ? {
            location: rawPlan.weather.location,
            country: rawPlan.weather.country,
            region: rawPlan.weather.region,
          }
        : fallback.weather,
    calculation:
      rawPlan?.calculation && typeof rawPlan.calculation.expression === "string"
        ? { expression: rawPlan.calculation.expression }
        : fallback.calculation,
    clarification:
      typeof rawPlan?.clarification === "string" ? rawPlan.clarification : undefined,
    requiredSourceCount: clampInt(rawPlan?.requiredSourceCount, fallback.requiredSourceCount, 1, 8),
  };
}

async function invokeTool(toolName: string, input: Record<string, unknown>): Promise<string> {
  const selectedTool = toolByName.get(toolName) as StructuredToolInterface | undefined;
  if (!selectedTool) {
    return `Error: tool ${toolName} is not loaded.`;
  }

  try {
    const result = await selectedTool.invoke(input);
    return typeof result === "string" ? result : JSON.stringify(result, null, 2);
  } catch (error) {
    return `Error: ${toolName} failed - ${error instanceof Error ? error.message : String(error)}`;
  }
}

function createToolMessage(name: string, content: string, index = 0): ToolMessage {
  return new ToolMessage({
    content,
    name,
    tool_call_id: `${name}_${Date.now()}_${index}`,
  });
}

async function repairWeatherRequest(
  request: WeatherRequest,
  state: typeof DeepResearchState.State,
  errorText: string
): Promise<WeatherRequest | undefined> {
  const model = resolveModel(state.reasoning_model, DEFAULT_RESEARCH_MODEL);
  const llm = llmGateway.createChatModel({ model, temperature: 0 });
  const prompt = [
    "Return only one JSON object. Do not use markdown.",
    "Convert this failed weather geocoding request into a geocoding-friendly location request.",
    "Translate the place name to its commonly used English name when appropriate. Do not invent coordinates.",
    "Keep country and region hints if they are correct.",
    'JSON schema: {"location":"string","country":"string optional","region":"string optional"}',
    `Original request: ${JSON.stringify(request)}`,
    `Tool error: ${errorText}`,
  ].join("\n");

  try {
    const response = await llm.invoke(prompt);
    const parsed = parseJsonObject<Partial<WeatherRequest>>(messageContentToString(response));
    if (parsed?.location && typeof parsed.location === "string") {
      return {
        location: parsed.location,
        country: typeof parsed.country === "string" ? parsed.country : request.country,
        region: typeof parsed.region === "string" ? parsed.region : request.region,
      };
    }
  } catch {
    return undefined;
  }

  return undefined;
}

async function planResearch(
  state: typeof DeepResearchState.State,
  _config: RunnableConfig
): Promise<Partial<typeof DeepResearchState.State>> {
  const question = getResearchTopic(state.messages).trim();
  if (!question) {
    return {
      plan: {
        question: "",
        answerMode: "clarify",
        rationale: "No user question was provided.",
        queries: [],
        urls: [],
        clarification: "Please provide a question to research.",
        requiredSourceCount: 1,
      },
    };
  }

  const model = resolveModel(state.reasoning_model, DEFAULT_RESEARCH_MODEL);
  const llm = llmGateway.createChatModel({ model, temperature: 0 });
  const prompt = [
    "You are a research pipeline planner for a LangGraph agent.",
    "Return only one JSON object. Do not use markdown.",
    "Classify the user request and decide whether it needs direct answer, current weather, calculation, web research, or clarification.",
    "Use web research for current facts, news, products, prices, law, regulations, company/person changes, technical docs that may have changed, and any topic requiring external evidence.",
    "Use weather only for actual weather/temperature/rain/wind/humidity questions.",
    "For weather, extract a clean geocoding-friendly place name. Translate common non-English place names to their widely used English form when you can infer it from the user request, and include country or region when available.",
    "If a location is ambiguous, include country or region when the user supplied it; otherwise leave it to the weather tool to request clarification.",
    "JSON schema:",
    '{"question":"string","answerMode":"direct|weather|calculation|research|clarify","rationale":"string","queries":["string"],"urls":["https://..."],"freshness":"pd|pw|pm|py optional","weather":{"location":"string","country":"string optional","region":"string optional"},"calculation":{"expression":"string"},"clarification":"string optional","requiredSourceCount":3}',
    `Today is ${today()}.`,
    "User request:",
    question,
  ].join("\n");

  try {
    const response = await llm.invoke(prompt);
    const parsed = parseJsonObject<Partial<ResearchPlan>>(messageContentToString(response));
    return { plan: coercePlan(parsed, question, state) };
  } catch {
    return { plan: fallbackPlan(question, state) };
  }
}

function routeAfterPlan(state: typeof DeepResearchState.State): string {
  switch (state.plan?.answerMode) {
    case "clarify":
      return "synthesize";
    case "weather":
    case "calculation":
      return "targeted_tools";
    case "research":
      return "search_web";
    case "direct":
    default:
      return "synthesize";
  }
}

async function targetedTools(
  state: typeof DeepResearchState.State,
  _config: RunnableConfig
): Promise<Partial<typeof DeepResearchState.State>> {
  const plan = state.plan;
  const messages: ToolMessage[] = [];

  if (plan?.answerMode === "weather") {
    const request = plan.weather ?? { location: plan.question };
    let content = await invokeTool("current_weather", request as Record<string, unknown>);

    if (content.startsWith("Error:")) {
      const repairedRequest = await repairWeatherRequest(request, state, content);
      if (repairedRequest) {
        const retryContent = await invokeTool(
          "current_weather",
          repairedRequest as Record<string, unknown>
        );
        content = [
          `Initial current_weather request failed: ${content}`,
          `Retried with geocoding-friendly request: ${JSON.stringify(repairedRequest)}`,
          retryContent,
        ].join("\n\n");
      }
    }

    messages.push(createToolMessage("current_weather", content));
  }

  if (plan?.answerMode === "calculation" && plan.calculation?.expression) {
    const content = await invokeTool("calculator_tool", {
      expression: plan.calculation.expression,
    });
    messages.push(createToolMessage("calculator_tool", content));
  }

  return { messages };
}

function parseSearchToolOutput(output: string, query: string): SearchResult[] {
  const parsed = parseJsonObject<{ results?: SearchResult[] }>(output);
  if (parsed?.results?.length) {
    return parsed.results
      .filter((result) => result.url)
      .map((result) => ({
        title: result.title ?? "Untitled",
        url: result.url,
        snippet: result.snippet ?? "",
        query: result.query ?? query,
        sourceType: result.sourceType ?? "web",
        age: result.age,
      }));
  }

  const results: SearchResult[] = [];
  const blocks = output.split(/\n\n+/g);
  for (const block of blocks) {
    const url = block.match(/URL:\s*(\S+)/i)?.[1];
    if (!url || url === "N/A") {
      continue;
    }
    const title = block.split("\n")[0]?.replace(/^\d+\.\s*/, "").trim() || "Untitled";
    const snippet = block.match(/Snippet:\s*(.+)/i)?.[1] ?? "";
    const age = block.match(/Age:\s*(.+)/i)?.[1];
    results.push({ title, url, snippet, query, sourceType: "web", age });
  }
  return results;
}

async function searchWeb(
  state: typeof DeepResearchState.State,
  _config: RunnableConfig
): Promise<Partial<typeof DeepResearchState.State>> {
  const plan = state.plan ?? fallbackPlan(getResearchTopic(state.messages), state);
  const queries = plan.queries.length ? plan.queries : [plan.question];
  const allResults: SearchResult[] = [];
  const messages: ToolMessage[] = [];

  for (const [index, query] of queries.entries()) {
    const content = await invokeTool("web_search", {
      query,
      count: 8,
      freshness: plan.freshness,
      format: "json",
    });
    messages.push(createToolMessage("web_search", content, index));
    allResults.push(...parseSearchToolOutput(content, query));
  }

  for (const url of plan.urls) {
    allResults.push({
      title: url,
      url,
      snippet: "URL supplied by planner or user.",
      query: plan.question,
      sourceType: "provided_url",
    });
  }

  return { messages, searchResults: allResults };
}

function sourceScore(result: SearchResult, question: string): { score: number; reason: string } {
  const text = `${result.title} ${result.snippet}`.toLowerCase();
  const terms = question
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length >= 3);
  const termHits = terms.filter((term) => text.includes(term)).length;
  let score = termHits * 8;

  if (result.url.startsWith("https://")) {
    score += 4;
  }
  if (result.sourceType === "news") {
    score += 3;
  }
  if (result.age) {
    score += 2;
  }
  if (/\.gov|\.edu|\.org|docs\.|developer\.|official|官方/i.test(result.url)) {
    score += 5;
  }

  return {
    score,
    reason: `${termHits} query term hits${result.age ? `, freshness: ${result.age}` : ""}`,
  };
}

async function rankSources(
  state: typeof DeepResearchState.State,
  _config: RunnableConfig
): Promise<Partial<typeof DeepResearchState.State>> {
  const plan = state.plan ?? fallbackPlan(getResearchTopic(state.messages), state);
  const deduped = new Map<string, SearchResult>();

  for (const result of state.searchResults) {
    const key = normalizeUrlForDedup(result.url);
    if (!deduped.has(key)) {
      deduped.set(key, { ...result, url: key });
    }
  }

  const ranked = [...deduped.values()]
    .map((result) => {
      const scoring = sourceScore(result, plan.question);
      return { ...result, score: scoring.score, rankReason: scoring.reason };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(plan.requiredSourceCount, getMaxFetchedSources(state)));

  return { rankedSources: ranked };
}

function parseFetchOutput(output: string): { content: string; contentType?: string; error?: string } {
  if (output.startsWith("Error:")) {
    return { content: "", error: output };
  }
  const contentType = output.match(/Content-Type:\s*(.+)/i)?.[1];
  const separator = output.indexOf("\n\n");
  return {
    content: separator >= 0 ? output.slice(separator + 2).trim() : output.trim(),
    contentType,
  };
}

async function fetchSources(
  state: typeof DeepResearchState.State,
  _config: RunnableConfig
): Promise<Partial<typeof DeepResearchState.State>> {
  const maxSources = getMaxFetchedSources(state);
  const selected = state.rankedSources.slice(0, maxSources);
  const fetchedSources: FetchedSource[] = [];
  const messages: ToolMessage[] = [];

  for (const [index, source] of selected.entries()) {
    const content = await invokeTool("web_fetch", {
      url: source.url,
      maxCharacters: 16_000,
    });
    messages.push(createToolMessage("web_fetch", content, index));
    const parsed = parseFetchOutput(content);
    fetchedSources.push({
      ...source,
      content: parsed.content,
      contentType: parsed.contentType,
      fetchError: parsed.error,
    });
  }

  return { messages, fetchedSources };
}

function excerpt(text: string, maxChars: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length <= maxChars ? compact : `${compact.slice(0, maxChars)}...`;
}

async function extractEvidence(
  state: typeof DeepResearchState.State,
  _config: RunnableConfig
): Promise<Partial<typeof DeepResearchState.State>> {
  const question = state.plan?.question ?? getResearchTopic(state.messages);
  const extractedSources: ExtractedSource[] = state.fetchedSources.map((source, index) => {
    const usable = !source.fetchError && source.content.trim().length >= 200;
    const sentences = source.content
      .split(/(?<=[.!?。！？])\s+/u)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length > 40);
    const keyClaims = sentences.slice(0, 5).map((sentence) => excerpt(sentence, 320));

    return {
      index: index + 1,
      title: source.title,
      url: source.url,
      summary: usable
        ? excerpt(source.content, 900)
        : source.fetchError ?? "Fetched content was too short to use as evidence.",
      keyClaims: keyClaims.length ? keyClaims : [excerpt(source.snippet, 320)],
      usable,
    };
  });

  if (extractedSources.length === 0 && state.searchResults.length > 0) {
    return {
      extractedSources: state.searchResults.slice(0, 5).map((result, index) => ({
        index: index + 1,
        title: result.title,
        url: result.url,
        summary: result.snippet,
        keyClaims: [result.snippet],
        usable: Boolean(result.snippet),
      })),
    };
  }

  void question;
  return { extractedSources };
}

async function verifyCitations(
  state: typeof DeepResearchState.State,
  _config: RunnableConfig
): Promise<Partial<typeof DeepResearchState.State>> {
  const usableSourceCount = state.extractedSources.filter((source) => source.usable).length;
  const rejectedSourceCount = state.extractedSources.length - usableSourceCount;
  const warnings: string[] = [];

  if (state.plan?.answerMode === "research" && usableSourceCount === 0) {
    warnings.push("No usable fetched sources are available. The final answer must explain the search/fetch failure instead of fabricating facts.");
  }
  if (state.plan?.answerMode === "research" && usableSourceCount === 1) {
    warnings.push("Only one usable source is available. Treat claims as weakly corroborated.");
  }

  return {
    verification: {
      usableSourceCount,
      rejectedSourceCount,
      warnings,
    },
  };
}

function formatEvidence(state: typeof DeepResearchState.State): string {
  const toolEvidence = state.messages
    .filter((message) => message.getType?.() === "tool")
    .map((message, index) => `Tool result ${index + 1}:\n${excerpt(messageContentToString(message), 2_000)}`)
    .join("\n\n");

  const sourceEvidence = state.extractedSources
    .map((source) => {
      return [
        `[${source.index}] ${source.title}`,
        `URL: ${source.url}`,
        `Usable: ${source.usable}`,
        `Summary: ${source.summary}`,
        `Key claims: ${source.keyClaims.join(" | ")}`,
      ].join("\n");
    })
    .join("\n\n");

  return [toolEvidence, sourceEvidence].filter(Boolean).join("\n\n");
}

async function synthesizeAnswer(
  state: typeof DeepResearchState.State,
  _config: RunnableConfig
): Promise<Partial<typeof DeepResearchState.State>> {
  const plan = state.plan ?? fallbackPlan(getResearchTopic(state.messages), state);

  if (plan.answerMode === "clarify") {
    return {
      messages: [new AIMessage(plan.clarification ?? "Please clarify the request before I continue.")],
    };
  }

  const model = resolveModel(state.reasoning_model, DEFAULT_RESEARCH_MODEL);
  const llm = llmGateway.createChatModel({ model, temperature: 0.1 });
  const evidence = formatEvidence(state);
  const prompt = [
    "You are the final synthesis node in a production-style research graph.",
    "Answer the user in the same language as the user unless they requested otherwise.",
    "Use only the provided tool results and evidence for current or researched facts.",
    "If evidence contains tool/API errors or no usable sources, state the limitation clearly and do not fabricate facts.",
    "If a tool result includes an initial error followed by a successful retry result, use the successful retry result as the answer basis and do not say the task failed.",
    "For web research answers, cite sources inline with [1], [2], etc. using the evidence index numbers.",
    "For weather or calculation answers, cite the tool/provider name instead of web citations.",
    "For weather answers, current_weather returns the latest current observation, not a full-day forecast. If the user asks about today/current weather and the tool returned data, answer with the latest observation time and values. Do not claim the weather is unavailable only because the observation timestamp differs from the prompt date.",
    "Keep the answer concise but include exact numbers, dates, and source limitations when relevant.",
    `Today is ${today()}.`,
    `Plan: ${JSON.stringify(plan, null, 2)}`,
    `Verification: ${JSON.stringify(state.verification ?? {}, null, 2)}`,
    "Evidence:",
    evidence || "No external evidence was collected.",
    "Conversation:",
    getResearchTopic(state.messages),
  ].join("\n\n");

  try {
    const response = await llm.invoke(prompt);
    return { messages: [normalizeAiMessageForStream(response)] };
  } catch (error) {
    return {
      messages: [
        new AIMessage(
          `Research synthesis failed: ${formatLlmError(error)}`
        ),
      ],
    };
  }
}

function routeAfterSearch(state: typeof DeepResearchState.State): string {
  if (state.searchResults.length === 0) {
    return "verify";
  }
  return "rank";
}

function routeAfterRank(state: typeof DeepResearchState.State): string {
  if (state.rankedSources.length === 0) {
    return "verify";
  }
  return "fetch";
}

const builder = new StateGraph(DeepResearchState)
  .addNode("plan_research", planResearch)
  .addNode("targeted_tools", targetedTools)
  .addNode("search_web", searchWeb)
  .addNode("rank_sources", rankSources)
  .addNode("fetch_sources", fetchSources)
  .addNode("extract_evidence", extractEvidence)
  .addNode("verify_citations", verifyCitations)
  .addNode("synthesize_answer", synthesizeAnswer)
  .addEdge(START, "plan_research")
  .addConditionalEdges("plan_research", routeAfterPlan, {
    targeted_tools: "targeted_tools",
    search_web: "search_web",
    synthesize: "synthesize_answer",
  })
  .addEdge("targeted_tools", "synthesize_answer")
  .addConditionalEdges("search_web", routeAfterSearch, {
    rank: "rank_sources",
    verify: "verify_citations",
  })
  .addConditionalEdges("rank_sources", routeAfterRank, {
    fetch: "fetch_sources",
    verify: "verify_citations",
  })
  .addEdge("fetch_sources", "extract_evidence")
  .addEdge("extract_evidence", "verify_citations")
  .addEdge("verify_citations", "synthesize_answer")
  .addEdge("synthesize_answer", END);

export const deepResearcherGraph = builder.compile();
