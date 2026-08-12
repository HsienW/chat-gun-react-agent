import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createNoopOpikTracer } from "../../platform/tracing/opik/opik-tracer.js";
import type {
  AgentRunMetadata,
} from "../../platform/tracing/opik/opik-tracer.js";
import { ToolCallCorrectnessMetric } from "./metrics/tool-call-correctness.js";
import { ResponseQualityMetric } from "./metrics/response-quality.js";
import {
  createPinnedDatasetLoader,
  experimentTestInternals,
  runExperiment,
  type ExperimentDependencies,
  type ExperimentConfig,
} from "./experiment.js";
import type { EvaluationDataset } from "./types.js";

const tempDirectories: string[] = [];

const dataset: EvaluationDataset = {
  name: "weather-golden",
  version: "v1.0.0",
  items: [
    {
      id: "tokyo",
      input: { intent: "weather", parameters: { location: "Tokyo" } },
      expectedOutput: {
        toolCalls: [{ name: "current_weather", arguments: { location: "Tokyo" } }],
        summary: "Current Tokyo weather",
      },
    },
    {
      id: "taipei",
      input: { intent: "weather", parameters: { location: "Taipei" } },
      expectedOutput: {
        toolCalls: [{ name: "current_weather", arguments: { location: "Taipei" } }],
        summary: "Current Taipei weather",
      },
    },
  ],
};

function baseConfig(outputDir: string, model = "agent-a"): ExperimentConfig {
  return {
    datasetVersion: "v1.0.0",
    agentConfig: { model, provider: "qwen", promptVersion: "weather-v1" },
    judgeConfig: {
      model: "judge-a",
      provider: "qwen",
      temperature: 0,
      promptVersion: "judge-v1",
      promptTemplateHash: "a".repeat(64),
    },
    metrics: [new ToolCallCorrectnessMetric()],
    outputDir,
    perItemTimeoutMs: 1_000,
  };
}

function dependencies(
  overrides: Partial<ExperimentDependencies> = {}
): ExperimentDependencies {
  return {
    loadDataset: async () => dataset,
    runAgent: async (item) => ({
      response: `Weather response for ${item.id}`,
      toolCalls: [
        {
          name: "current_weather",
          arguments: {
            location: item.id === "tokyo" ? "Tokyo" : "Taipei",
          },
        },
      ],
      tokenCostUsd: 0.01,
    }),
    tracer: createNoopOpikTracer(),
    now: () => new Date("2026-08-11T00:00:00.000Z"),
    experimentId: () => "experiment-test",
    ...overrides,
  };
}

afterEach(async () => {
  for (const directory of tempDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("readToolCalls", () => {
  const readToolCalls = experimentTestInternals.readToolCalls;

  function executedToolMessage(
    name: string,
    arguments_: Record<string, unknown>,
    toolCallId: string
  ): ToolMessage {
    return new ToolMessage({
      content: JSON.stringify({ status: "success" }),
      name,
      tool_call_id: toolCallId,
      artifact: {
        schemaVersion: "1.0",
        type: "executed_tool_call",
        name,
        arguments: arguments_,
      },
    });
  }

  it("extracts current_weather from ToolMessage execution evidence", () => {
    const calls = readToolCalls([
      executedToolMessage(
        "current_weather",
        { raw: "台北", location: "台北", queryName: "Taipei" },
        "weather-1"
      ),
    ]);

    expect(calls).toEqual([
      {
        name: "current_weather",
        arguments: { raw: "台北", location: "台北", queryName: "Taipei" },
      },
    ]);
  });

  it("preserves every execution when a weather request is retried", () => {
    const calls = readToolCalls([
      executedToolMessage(
        "current_weather",
        { raw: "北京市", location: "北京市" },
        "weather-1"
      ),
      executedToolMessage(
        "current_weather",
        {
          raw: "北京市",
          location: "Beijing",
          country: "China",
          resolutionStrategy: "llm_repair",
        },
        "weather-2"
      ),
    ]);

    expect(calls).toHaveLength(2);
    expect(calls[1]?.arguments).toMatchObject({
      raw: "北京市",
      location: "Beijing",
      country: "China",
      resolutionStrategy: "llm_repair",
    });
  });

  it("does not infer tool calls from natural-language responses", () => {
    expect(
      readToolCalls([
        new AIMessage("I called current_weather for Taipei and it is sunny."),
      ])
    ).toEqual([]);
  });

  it("gives the Taipei live-case tool evidence a non-zero correctness score", () => {
    const item = dataset.items.find((candidate) => candidate.id === "taipei");
    if (!item) throw new Error("Taipei fixture is required");
    const toolCalls = readToolCalls([
      executedToolMessage(
        "current_weather",
        { raw: "台北", location: "Taipei", queryName: "Taipei" },
        "weather-1"
      ),
    ]);

    const score = new ToolCallCorrectnessMetric().evaluate(item, {
      response: "Taipei weather",
      toolCalls,
    });

    expect(score.value).toBeGreaterThan(0);
    expect(score.reason).not.toBe("No tool calls executed");
  });
});

describe("runExperiment", () => {
  it.each([
    ["maxItems", Number.NaN],
    ["maxItems", 1.5],
    ["perItemTimeoutMs", Number.POSITIVE_INFINITY],
    ["maxTotalCostUsd", -0.01],
  ] as const)("rejects invalid bounded-run config %s=%s", async (key, value) => {
    const outputDir = await mkdtemp(join(tmpdir(), "opik-eval-"));
    tempDirectories.push(outputDir);

    await expect(
      runExperiment(
        { ...baseConfig(outputDir), [key]: value },
        dependencies()
      )
    ).rejects.toBeInstanceOf(TypeError);
  });

  it("rejects a default-runner provider label that differs from the gateway", () => {
    expect(() =>
      experimentTestInternals.validateDefaultProvider("openai", "qwen")
    ).toThrow(/does not match configured provider/);
  });

  it("rejects judge evidence that differs from the executing metric", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "opik-eval-"));
    tempDirectories.push(outputDir);
    const responseMetric = new ResponseQualityMetric(
      {
        model: "judge-real",
        provider: "qwen",
        promptTemplate: "Return score and reasoning.",
        promptVersion: "judge-v1",
      },
      { invoke: async () => ({ score: 1, reasoning: "ok" }) }
    );

    await expect(
      runExperiment(
        {
          ...baseConfig(outputDir),
          metrics: [responseMetric],
          judgeConfig: {
            model: "judge-recorded-wrongly",
            provider: "qwen",
            temperature: 0,
            promptVersion: "judge-v1",
            promptTemplateHash: responseMetric.judgeConfig.promptTemplateHash,
          },
        },
        dependencies()
      )
    ).rejects.toThrow(/judgeConfig does not match/);
  });

  it("flushes trace feedback and keeps offline results when flush fails", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "opik-eval-"));
    tempDirectories.push(outputDir);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const tracer = createNoopOpikTracer();
    tracer.flush = vi.fn(async () => {
      throw new Error("hosted unavailable");
    });

    const result = await runExperiment(
      baseConfig(outputDir),
      dependencies({ tracer })
    );

    expect(result.items.every((item) => item.status === "COMPLETED")).toBe(true);
    expect(tracer.flush).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('"event":"opik_experiment_flush_failed"')
    );
  });

  it("produces comparable deterministic scores for the same config", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "opik-eval-"));
    tempDirectories.push(outputDir);
    const config = baseConfig(outputDir);

    const first = await runExperiment(config, dependencies());
    const second = await runExperiment(config, dependencies());

    expect(first.comparisonKey).toBe(second.comparisonKey);
    expect(first.items.map((item) => item.metrics)).toEqual(
      second.items.map((item) => item.metrics)
    );
  });

  it("records different agent models for side-by-side comparison", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "opik-eval-"));
    tempDirectories.push(outputDir);

    const first = await runExperiment(baseConfig(outputDir, "agent-a"), dependencies());
    const second = await runExperiment(baseConfig(outputDir, "agent-b"), dependencies());

    expect(first.agentConfig.model).toBe("agent-a");
    expect(second.agentConfig.model).toBe("agent-b");
    expect(first.comparisonKey).not.toBe(second.comparisonKey);
    expect(first).toMatchObject({
      datasetName: "weather-golden",
      datasetVersion: "v1.0.0",
      judgeConfig: { temperature: 0, promptVersion: "judge-v1" },
      timestamp: "2026-08-11T00:00:00.000Z",
    });
  });

  it("reuses one pinned dataset for experiments with different models", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "opik-eval-"));
    tempDirectories.push(outputDir);
    const loadDataset = createPinnedDatasetLoader(dataset);

    const first = await runExperiment(
      baseConfig(outputDir, "agent-a"),
      dependencies({ loadDataset })
    );
    const second = await runExperiment(
      baseConfig(outputDir, "agent-b"),
      dependencies({ loadDataset })
    );

    expect(first.datasetVersion).toBe("v1.0.0");
    expect(second.datasetVersion).toBe("v1.0.0");
    expect(first.agentConfig.model).not.toBe(second.agentConfig.model);
  });

  it("rejects a requested version that differs from the pinned dataset", async () => {
    const loadDataset = createPinnedDatasetLoader(dataset);

    await expect(loadDataset("v1.0.1")).rejects.toThrow(
      /Pinned dataset version v1\.0\.0 does not match v1\.0\.1/
    );
  });

  it("records FAILED, TIMEOUT, and max-item SKIPPED statuses without stopping", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "opik-eval-"));
    tempDirectories.push(outputDir);
    const failingDataset: EvaluationDataset = {
      ...dataset,
      items: [
        ...dataset.items,
        { id: "third", input: { intent: "weather" } },
      ],
    };
    let call = 0;
    const result = await runExperiment(
      { ...baseConfig(outputDir), maxItems: 2, perItemTimeoutMs: 10 },
      dependencies({
        loadDataset: async () => failingDataset,
        runAgent: async () => {
          call += 1;
          if (call === 1) throw new Error("agent failed");
          return new Promise(() => undefined);
        },
      })
    );

    expect(result.items.map((item) => item.status)).toEqual([
      "FAILED",
      "TIMEOUT",
      "SKIPPED",
    ]);
    expect(result.items[0].metrics[0].value).toBe(0);
    expect(result.items[1].metrics[0].value).toBe(0);
  });

  it("writes structured offline JSON with experiment and metric evidence", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "opik-eval-"));
    tempDirectories.push(outputDir);

    const result = await runExperiment(baseConfig(outputDir), dependencies());
    const persisted = JSON.parse(await readFile(result.outputPath, "utf8"));

    expect(persisted).toMatchObject({
      experimentId: "experiment-test",
      datasetVersion: "v1.0.0",
      agentConfig: { model: "agent-a", provider: "qwen" },
      timestamp: "2026-08-11T00:00:00.000Z",
    });
    expect(persisted.items[0].metrics[0]).toMatchObject({
      name: "tool_call_correctness",
      value: 1,
      reason: "Tool call matches expected",
    });
  });

  it("links metric feedback and trace IDs to each successful item", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "opik-eval-"));
    tempDirectories.push(outputDir);
    const tracer = createNoopOpikTracer();
    const feedback: Array<{ traceId: string; name: string; value: number }> = [];
    let activeTraceId: string | undefined;
    tracer.traceAgentRun = async function traceAgentRunForTest<T>(
      _agentName: string,
      metadata: AgentRunMetadata,
      execution: () => Promise<T>
    ): Promise<T> {
      activeTraceId = `trace-${metadata.taskId}`;
      try {
        return await execution();
      } finally {
        activeTraceId = undefined;
      }
    };
    tracer.getActiveTraceId = () => activeTraceId;
    tracer.logFeedback = (name, value) => {
      if (activeTraceId) feedback.push({ traceId: activeTraceId, name, value });
    };

    const result = await runExperiment(
      baseConfig(outputDir),
      dependencies({ tracer })
    );

    expect(result.traceIds).toEqual(["trace-tokyo", "trace-taipei"]);
    expect(feedback).toEqual([
      { traceId: "trace-tokyo", name: "tool_call_correctness", value: 1 },
      { traceId: "trace-taipei", name: "tool_call_correctness", value: 1 },
    ]);
  });

  it("marks remaining items SKIPPED after the cost cap is reached", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "opik-eval-"));
    tempDirectories.push(outputDir);

    const result = await runExperiment(
      { ...baseConfig(outputDir), maxTotalCostUsd: 0.005 },
      dependencies()
    );

    expect(result.items.map((item) => item.status)).toEqual([
      "COMPLETED",
      "SKIPPED",
    ]);
  });
});
