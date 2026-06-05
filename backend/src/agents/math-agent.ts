import { AIMessage, BaseMessage } from "@langchain/core/messages";
import { RunnableConfig } from "@langchain/core/runnables";
import { END, MessagesAnnotation, START, StateGraph } from "@langchain/langgraph";

import { llmGateway } from "../platform/llm-gateway.js";
import { mathSystemMessage } from "../prompts.js";
import { calculatorTool } from "../tools/calculator.js";

function extractExpressionFromUserMessage(messages: BaseMessage[]): string {
  const latestHuman = [...messages]
    .reverse()
    .find((message) => message.getType() === "human");

  const content =
    typeof latestHuman?.content === "string" ? latestHuman.content : "";
  const candidates =
    content.match(
      /(?:sqrt|sin|cos|tan|log10|log|exp|abs|round|ceil|floor|pi|e|[\d+\-*/().\s])+/gi
    ) ?? [];

  return candidates
    .map((candidate) => candidate.trim())
    .filter((candidate) => /\d/.test(candidate))
    .sort((left, right) => right.length - left.length)[0] ?? "";
}

function latestUserText(messages: BaseMessage[]): string {
  const latestHuman = [...messages]
    .reverse()
    .find((message) => message.getType() === "human");
  return typeof latestHuman?.content === "string" ? latestHuman.content : "";
}

async function callModel(
  state: typeof MessagesAnnotation.State,
  _config: RunnableConfig
): Promise<typeof MessagesAnnotation.Update> {
  const expression = extractExpressionFromUserMessage(state.messages);

  if (expression) {
    const result = await calculatorTool.invoke({ expression });
    return {
      messages: [
        new AIMessage(
          `計算步驟：\n\n1. 從問題中抽取 expression：\`${expression}\`。\n2. 使用 calculator_tool 計算。\n3. 得到結果：\`${result}\`。\n\n最終答案是 **${result}**。`
        ),
      ],
    };
  }

  const llm = llmGateway.createChatModel({
    model: process.env.MATH_MODEL ?? "gemini-2.5-flash",
    temperature: Number(process.env.MATH_TEMPERATURE ?? 0.1),
  });

  const response = await llm.invoke([
    { role: "system", content: mathSystemMessage },
    { role: "human", content: latestUserText(state.messages) },
  ]);

  return {
    messages: [response],
  };
}

const builder = new StateGraph(MessagesAnnotation)
  .addNode("call_model", callModel)
  .addEdge(START, "call_model")
  .addEdge("call_model", END);

export const mathAgentGraph = builder.compile();
