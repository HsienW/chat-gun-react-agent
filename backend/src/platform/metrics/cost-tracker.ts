import type { MetricRecorder } from "./metrics-collector.js";
import { getMetricsCollector } from "./metrics-collector.js";

export type TokenRate = {
  inputPerMillion: number;
  outputPerMillion: number;
  currency: "USD";
};

export type TokenRateTable = Readonly<Record<string, TokenRate>>;

export const DEFAULT_TOKEN_RATE: TokenRate = {
  inputPerMillion: 1,
  outputPerMillion: 3,
  currency: "USD",
};

export type TokenCost = {
  inputCost: number;
  outputCost: number;
  totalCost: number;
  currency: "USD";
  rateSource: "provider" | "default";
};

const TOKENS_PER_MILLION = 1_000_000;

export function computeTokenCost(
  usage: { provider: string; inputTokens: number; outputTokens: number },
  rateTable: TokenRateTable = {}
): TokenCost {
  const providerRate = rateTable[usage.provider];
  const rate = providerRate ?? DEFAULT_TOKEN_RATE;
  const inputCost = (usage.inputTokens / TOKENS_PER_MILLION) * rate.inputPerMillion;
  const outputCost = (usage.outputTokens / TOKENS_PER_MILLION) * rate.outputPerMillion;

  return {
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
    currency: rate.currency,
    rateSource: providerRate ? "provider" : "default",
  };
}

export function recordCostMetric(
  input: { taskId: string; modelCost: number; toolCost: number },
  recorder: MetricRecorder = getMetricsCollector()
): void {
  try {
    recorder.record({
      kind: "cost",
      taskId: input.taskId,
      totalCost: input.modelCost + input.toolCost,
      currency: "USD",
      breakdown: {
        modelCost: input.modelCost,
        toolCost: input.toolCost,
      },
      ts: Date.now(),
    });
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "metric_collection_failed",
        metricKind: "cost",
        errorName: error instanceof Error ? error.name : "UnknownError",
      })
    );
  }
}
