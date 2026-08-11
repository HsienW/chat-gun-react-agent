import { performance } from "node:perf_hooks";

import { describe, expect, it } from "vitest";

import type { OpikClient, OpikSpan, OpikTrace } from "./opik-setup.js";
import { createOpikTracer, type OpikTracer } from "./opik-tracer.js";

const ITERATIONS = 500;

function createInMemoryClient(): OpikClient {
  const span: OpikSpan = {
    id: "span-benchmark",
    startSpan: () => span,
    end: () => undefined,
    update: () => undefined,
  };
  const trace: OpikTrace = {
    id: "trace-benchmark",
    startSpan: () => span,
    end: () => undefined,
    update: () => undefined,
    logFeedback: () => undefined,
  };
  return {
    startTrace: () => trace,
    isConfigured: () => true,
    flush: async () => undefined,
  };
}

async function executeRepresentativeRun(tracer: OpikTracer, index: number): Promise<void> {
  await tracer.traceAgentRun(
    "weather",
    { threadId: `thread-${index}`, runId: `run-${index}`, taskId: `task-${index}` },
    () =>
      tracer.withNodeSpan("targeted_tools", { stepId: "targeted_tools" }, async () => {
        await tracer.withLlmSpan(
          {
            stepId: "targeted_tools",
            modelName: "benchmark-model",
            providerName: "benchmark-provider",
          },
          async () => ({ usage_metadata: { input_tokens: 10, output_tokens: 5 } }),
          { prompt: "benchmark prompt" }
        );
        await tracer.withToolSpan(
          {
            stepId: "targeted_tools",
            toolName: "current_weather",
            toolCallId: `tool-${index}`,
          },
          async () => ({ status: "success" }),
          { location: "Taipei" }
        );
      })
  );
}

async function measure(tracer: OpikTracer): Promise<number> {
  for (let index = 0; index < 25; index += 1) {
    await executeRepresentativeRun(tracer, index);
  }
  const startedAt = performance.now();
  for (let index = 0; index < ITERATIONS; index += 1) {
    await executeRepresentativeRun(tracer, index);
  }
  return performance.now() - startedAt;
}

describe("Opik instrumentation overhead benchmark", () => {
  it("reports local in-memory overhead without asserting a production SLO", async () => {
    const disabled = createOpikTracer({
      enabled: false,
      host: "https://opik.example/api",
      projectName: "benchmark",
      redactEnabled: true,
    });
    const enabled = createOpikTracer(
      {
        enabled: true,
        apiKey: "benchmark-only",
        host: "https://opik.example/api",
        projectName: "benchmark",
        redactEnabled: true,
      },
      { client: createInMemoryClient() }
    );

    const disabledTotalMs = await measure(disabled);
    const enabledTotalMs = await measure(enabled);
    const result = {
      iterations: ITERATIONS,
      disabledTotalMs,
      enabledTotalMs,
      disabledPerRunMs: disabledTotalMs / ITERATIONS,
      enabledPerRunMs: enabledTotalMs / ITERATIONS,
      estimatedInstrumentationOverheadPerRunMs:
        (enabledTotalMs - disabledTotalMs) / ITERATIONS,
      excludes: ["network", "SDK batching", "hosted ingestion", "agent/model latency"],
    };

    expect(Number.isFinite(result.disabledPerRunMs)).toBe(true);
    expect(Number.isFinite(result.enabledPerRunMs)).toBe(true);
    console.info("opik_in_memory_overhead", JSON.stringify(result));
  });
});
