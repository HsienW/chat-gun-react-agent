/**
 * Opt-in hosted Opik evaluation.
 *
 * Required:
 * RUN_OPIK_EVALUATION=true
 * OPIK_ENABLED=true
 * OPIK_API_KEY=<configured outside source control>
 * OPIK_WORKSPACE=<configured outside source control>
 * OPIK_EVAL_AGENT_MODEL_A=<first supported model>
 * OPIK_EVAL_AGENT_MODEL_B=<different supported model>
 * OPIK_EVAL_JUDGE_MODEL=<supported judge model>
 */
import { describe, expect, it } from "vitest";

import { getAgentRuntimeConfig } from "../../platform/runtime-config.js";
import { loadOrCreateWeatherGoldenDataset } from "./dataset.js";
import { createPinnedDatasetLoader, runExperiment } from "./experiment.js";
import { ResponseQualityMetric } from "./metrics/response-quality.js";
import { ToolCallCorrectnessMetric } from "./metrics/tool-call-correctness.js";

const liveEvaluationEnabled =
  process.env.RUN_OPIK_EVALUATION?.toLowerCase() === "true";
const LIVE_TIMEOUT_MS = 10 * 60 * 1_000;

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for hosted Opik evaluation`);
  return value;
}

describe.runIf(liveEvaluationEnabled)("hosted Opik evaluation", () => {
  it(
    "runs two versioned experiments with different agent models",
    async () => {
      const runtime = getAgentRuntimeConfig();
      if (
        !runtime.opikEnabled ||
        !runtime.opikRedactEnabled ||
        !runtime.opikApiKey ||
        !runtime.opikWorkspace
      ) {
        throw new Error(
          "Hosted evaluation requires OPIK_ENABLED=true, OPIK_REDACT_ENABLED=true, OPIK_API_KEY, and OPIK_WORKSPACE"
        );
      }
      const modelA = requireEnv("OPIK_EVAL_AGENT_MODEL_A");
      const modelB = requireEnv("OPIK_EVAL_AGENT_MODEL_B");
      const judgeModel = requireEnv("OPIK_EVAL_JUDGE_MODEL");
      if (modelA === modelB) {
        throw new Error("OPIK_EVAL_AGENT_MODEL_A and OPIK_EVAL_AGENT_MODEL_B must differ");
      }
      const promptTemplate = [
        "Evaluate whether the response fulfills the structured weather request.",
        "Use only the supplied expected output and agent result.",
      ].join(" ");
      const createMetrics = () => [
        new ToolCallCorrectnessMetric(),
        new ResponseQualityMetric({
          model: judgeModel,
          provider: "qwen",
          temperature: 0,
          promptTemplate,
          promptVersion: "weather-judge-v1",
        }),
      ];
      const maxItems = Number(process.env.OPIK_EVAL_MAX_ITEMS ?? 1);
      const common = {
        datasetVersion: "v1.0.0",
        judgeConfig: {
          model: judgeModel,
          provider: "qwen",
          temperature: 0,
          promptVersion: "weather-judge-v1",
          promptTemplateHash:
            new ResponseQualityMetric({
              model: judgeModel,
              provider: "qwen",
              temperature: 0,
              promptTemplate,
              promptVersion: "weather-judge-v1",
            }).judgeConfig.promptTemplateHash,
        },
        maxItems,
        perItemTimeoutMs: Number(process.env.OPIK_EVAL_ITEM_TIMEOUT_MS ?? 120_000),
      };
      const dataset = await loadOrCreateWeatherGoldenDataset(
        common.datasetVersion
      );
      const loadDataset = createPinnedDatasetLoader(dataset);

      const first = await runExperiment(
        {
          ...common,
          agentConfig: {
            model: modelA,
            provider: "qwen",
            promptVersion: "weather-agent-v1-a",
          },
          metrics: createMetrics(),
        },
        { loadDataset }
      );
      const second = await runExperiment(
        {
          ...common,
          agentConfig: {
            model: modelB,
            provider: "qwen",
            promptVersion: "weather-agent-v1-b",
          },
          metrics: createMetrics(),
        },
        { loadDataset }
      );

      expect(first.datasetVersion).toBe("v1.0.0");
      expect(second.datasetVersion).toBe("v1.0.0");
      expect(first.agentConfig.model).not.toBe(second.agentConfig.model);
      expect(first.traceIds.length).toBeGreaterThan(0);
      expect(second.traceIds.length).toBeGreaterThan(0);
      const expectedCompletedItems = Math.min(maxItems, dataset.items.length);
      for (const result of [first, second]) {
        expect(
          result.items.filter((item) => item.status === "COMPLETED")
        ).toHaveLength(expectedCompletedItems);
        expect(
          result.items
            .slice(expectedCompletedItems)
            .every((item) => item.status === "SKIPPED")
        ).toBe(true);
      }
    },
    LIVE_TIMEOUT_MS
  );
});
