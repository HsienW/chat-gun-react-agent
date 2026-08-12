import { afterEach, describe, expect, it, vi } from "vitest";

import { getHostedDatasetItemId } from "./dataset.js";
import {
  createSdkHostedExperimentPublisher,
  publishHostedExperiment,
  type HostedExperimentInput,
} from "./hosted-experiment.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

function hostedInput(): HostedExperimentInput {
  return {
    localExperimentId: "local-experiment-1",
    dataset: {
      name: "weather-golden",
      version: "v1.0.0",
      items: [
        { id: "tokyo", input: { intent: "weather" } },
        { id: "taipei", input: { intent: "weather" } },
      ],
    },
    agentConfig: {
      model: "agent-a",
      provider: "qwen",
      promptVersion: "weather-agent-v1",
    },
    judgeConfig: {
      model: "judge-a",
      provider: "qwen",
      temperature: 0,
      promptVersion: "weather-judge-v1",
      promptTemplateHash: "a".repeat(64),
    },
    metrics: [
      { name: "tool_call_correctness", deterministic: true },
      { name: "response_quality", deterministic: false },
    ],
    traceReferences: [
      { caseId: "tokyo", traceId: "trace-tokyo" },
      { caseId: "taipei", traceId: "trace-taipei" },
    ],
  };
}

describe("SdkHostedExperimentPublisher", () => {
  it("skips hosted publication when the development-only integration is disabled", async () => {
    vi.stubEnv("OPIK_ENABLED", "false");

    await expect(publishHostedExperiment(hostedInput())).resolves.toEqual({
      hostedStatus: "SKIPPED",
      hostedSkipReason: "disabled",
    });
  });

  it("creates a version-pinned experiment and inserts dataset-to-trace references", async () => {
    const insert = vi.fn(async () => undefined);
    const createExperiment = vi.fn(async () => ({
      id: "hosted-experiment-1",
      insert,
      getUrl: async () => "https://www.comet.com/opik/experiments/1",
    }));
    const tokyoItemId = getHostedDatasetItemId("v1.0.0", "tokyo");
    const taipeiItemId = getHostedDatasetItemId("v1.0.0", "taipei");
    const versionItems = [{ id: tokyoItemId }, { id: taipeiItemId }];
    const client = {
      api: {
        datasets: {
          listDatasetVersions: vi.fn(async () => ({
            content: [{ id: "hosted-version-1", versionName: "v1" }],
            page: 1,
            size: 100,
            total: 1,
          })),
        },
      },
      getDataset: vi.fn(async () => ({
        id: "hosted-dataset-1",
        getVersionView: async () => ({ getItems: async () => versionItems }),
      })),
      createExperiment,
      flush: vi.fn(async () => undefined),
    };

    const result = await createSdkHostedExperimentPublisher(
      client,
      "weather-project"
    ).publish(hostedInput());

    expect(createExperiment).toHaveBeenCalledWith({
      datasetName: "weather-golden",
      datasetVersionId: "hosted-version-1",
      projectName: "weather-project",
      experimentConfig: {
        dataset: { name: "weather-golden", version: "v1.0.0" },
        agent: {
          model: "agent-a",
          provider: "qwen",
          promptVersion: "weather-agent-v1",
        },
        judge: {
          model: "judge-a",
          provider: "qwen",
          temperature: 0,
          promptVersion: "weather-judge-v1",
          promptTemplateHash: "a".repeat(64),
        },
        metrics: [
          { name: "tool_call_correctness", deterministic: true },
          { name: "response_quality", deterministic: false },
        ],
      },
    });
    expect(insert).toHaveBeenCalledWith([
      {
        datasetItemId: tokyoItemId,
        traceId: "trace-tokyo",
        projectName: "weather-project",
      },
      {
        datasetItemId: taipeiItemId,
        traceId: "trace-taipei",
        projectName: "weather-project",
      },
    ]);
    expect(result).toEqual({
      hostedStatus: "SUCCEEDED",
      hostedExperimentId: "hosted-experiment-1",
      hostedExperimentUrl: "https://www.comet.com/opik/experiments/1",
      hostedDatasetId: "hosted-dataset-1",
      hostedDatasetVersionId: "hosted-version-1",
    });
  });

  it("fails without creating an experiment when no exact hosted dataset version exists", async () => {
    const createExperiment = vi.fn();
    const publisher = createSdkHostedExperimentPublisher(
      {
        api: {
          datasets: {
            listDatasetVersions: async () => ({
              content: [{ id: "wrong-version", versionName: "v2" }],
            }),
          },
        },
        getDataset: async () => ({
          id: "hosted-dataset-1",
          getVersionView: async () => ({
            getItems: async () => [{ id: "different-item" }],
          }),
        }),
        createExperiment,
        flush: async () => undefined,
      },
      "weather-project"
    );

    await expect(publisher.publish(hostedInput())).rejects.toThrow(
      /does not contain the requested immutable version/
    );
    expect(createExperiment).not.toHaveBeenCalled();
  });

  it("rejects an unsafe hosted experiment URL", async () => {
    const publisher = createSdkHostedExperimentPublisher(
      {
        api: {
          datasets: {
            listDatasetVersions: async () => ({
              content: [{ id: "hosted-version-1", versionName: "v1" }],
            }),
          },
        },
        getDataset: async () => ({
          id: "hosted-dataset-1",
          getVersionView: async () => ({
            getItems: async () =>
              hostedInput().dataset.items.map((item) => ({
                id: getHostedDatasetItemId("v1.0.0", item.id),
              })),
          }),
        }),
        createExperiment: async () => ({
          id: "hosted-experiment-1",
          insert: async () => undefined,
          getUrl: async () => "javascript:alert(1)",
        }),
        flush: async () => undefined,
      },
      "weather-project"
    );

    await expect(publisher.publish(hostedInput())).rejects.toThrow(
      /hosted experiment URL must use http or https/
    );
  });
});
