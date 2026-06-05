import { AIMessage } from "@langchain/core/messages";
import { RunnableConfig } from "@langchain/core/runnables";
import { END, MessagesAnnotation, START, StateGraph } from "@langchain/langgraph";

import { llmGateway } from "../platform/llm-gateway.js";
import { buildConversationContext, getLatestUserMessage } from "../state.js";
import { chatbotInstructions } from "../prompts.js";

function formatPrompt(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce((prompt, [key, value]) => {
    return prompt.replaceAll(`{${key}}`, value);
  }, template);
}

async function chatResponse(
  state: typeof MessagesAnnotation.State,
  _config: RunnableConfig
): Promise<typeof MessagesAnnotation.Update> {
  if (!state.messages.length) {
    return {
      messages: [new AIMessage("你好！今天需要我幫你什麼？")],
    };
  }

  const llm = llmGateway.createChatModel({
    model: process.env.CHAT_MODEL ?? "gemini-2.5-flash",
    temperature: Number(process.env.CHAT_TEMPERATURE ?? 0.7),
  });

  const prompt = formatPrompt(chatbotInstructions, {
    conversation_context: buildConversationContext(state.messages),
    current_message: getLatestUserMessage(state.messages),
  });

  const response = await llm.invoke(prompt);
  return {
    messages: [response],
  };
}

const builder = new StateGraph(MessagesAnnotation)
  .addNode("chat_response", chatResponse)
  .addEdge(START, "chat_response")
  .addEdge("chat_response", END);

export const chatbotGraph = builder.compile();
