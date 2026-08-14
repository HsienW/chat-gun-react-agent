import { createHash } from "node:crypto";

import type { BaseMessage } from "@langchain/core/messages";
import { z } from "zod";

import {
  getConfiguredLlmProvider,
  llmGateway,
} from "../../../platform/llm-gateway.js";
import { sanitizeErrorMessage } from "../../../platform/tracing/span-manager.js";
import { sanitizeMetadata } from "../../../platform/tracing/opik/opik-redaction.js";
import type {
  AgentRunResult,
  EvaluationItem,
  EvaluationMetric,
  MetricScore,
} from "../types.js";

const JudgeOutputSchema = z.object({
  score: z.number().min(0).max(1),
  reasoning: z.string().min(1),
});

export interface LlmJudgeConfig {
  model: string;
  provider: string;
  temperature?: number;
  promptTemplate: string;
  promptVersion: string;
}

export interface ResolvedLlmJudgeConfig {
  model: string;
  provider: string;
  temperature: 0;
  promptTemplate: string;
  promptVersion: string;
  promptTemplateHash: string;
}

interface JudgeInvocation {
  model: string;
  provider: string;
  temperature: 0;
  prompt: string;
}

export interface JudgeInvoker {
  invoke(input: JudgeInvocation): Promise<unknown>;
}

function contentToString(message: BaseMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .map((block) => {
      if (typeof block === "string") return block;
      if (block && typeof block === "object" && "text" in block) {
        return typeof block.text === "string" ? block.text : "";
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

class GatewayJudgeInvoker implements JudgeInvoker {
  async invoke(input: JudgeInvocation): Promise<unknown> {
    const configuredProvider = getConfiguredLlmProvider();
    if (input.provider !== configuredProvider) {
      throw new Error(
        `Judge provider ${input.provider} does not match configured provider ${configuredProvider}`
      );
    }
    const model = llmGateway.createChatModel({
      purpose: "research",
      model: input.model,
      temperature: 0,
      responseFormat: { type: "json_object" },
      maxRetries: 0,
    });
    const response = await model.invoke(input.prompt);
    return JSON.parse(contentToString(response));
  }
}

function hashPromptTemplate(template: string): string {
  return createHash("sha256").update(template).digest("hex");
}

function buildJudgePrompt(
  config: ResolvedLlmJudgeConfig,
  item: EvaluationItem,
  result: AgentRunResult
): string {
  return [
    config.promptTemplate,
    `Prompt version: ${config.promptVersion}`,
    "Return one JSON object with numeric score (0 to 1) and non-empty reasoning.",
    `Evaluation item: ${JSON.stringify(sanitizeMetadata({ input: item.input, expectedOutput: item.expectedOutput }))}`,
    `Agent result: ${JSON.stringify(sanitizeMetadata({ response: result.response, toolCalls: result.toolCalls }))}`,
  ].join("\n");
}

export class ResponseQualityMetric implements EvaluationMetric {
  readonly name = "response_quality";
  readonly deterministic = false;
  readonly judgeConfig: ResolvedLlmJudgeConfig;

  constructor(
    config: LlmJudgeConfig,
    private readonly invoker: JudgeInvoker = new GatewayJudgeInvoker()
  ) {
    this.judgeConfig = Object.freeze({
      model: config.model,
      provider: config.provider,
      temperature: 0,
      promptTemplate: config.promptTemplate,
      promptVersion: config.promptVersion,
      promptTemplateHash: hashPromptTemplate(config.promptTemplate),
    });
  }

  async evaluate(
    item: EvaluationItem,
    result: AgentRunResult
  ): Promise<MetricScore> {
    try {
      const output = await this.invoker.invoke({
        model: this.judgeConfig.model,
        provider: this.judgeConfig.provider,
        temperature: 0,
        prompt: buildJudgePrompt(this.judgeConfig, item, result),
      });
      const parsed = JudgeOutputSchema.parse(output);
      return {
        name: this.name,
        value: parsed.score,
        reason: parsed.reasoning,
        status: "COMPLETED",
        deterministic: false,
      };
    } catch (error) {
      return {
        name: this.name,
        value: 0,
        reason: sanitizeErrorMessage(error instanceof Error ? error.message : String(error)),
        status: "FAILED",
        deterministic: false,
        failureType: "JUDGE_FAILED",
      };
    }
  }
}
