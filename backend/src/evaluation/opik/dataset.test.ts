import { describe, expect, it, vi } from "vitest";

import type { WeatherGoldenEvalCase } from "../../tools/weather-golden-eval.js";
import {
  createWeatherGoldenDataset,
  DatasetVersionConflictError,
  datasetTestInternals,
  type DatasetUploadPort,
} from "./dataset.js";

function createUploader(hasVersion = false): DatasetUploadPort & {
  upload: ReturnType<typeof vi.fn>;
} {
  return {
    hasVersion: vi.fn(async () => hasVersion),
    upload: vi.fn(async () => undefined),
  };
}

describe("createWeatherGoldenDataset", () => {
  it("checks the named dataset directly without a bounded dataset listing", async () => {
    const target = {
      getItems: vi.fn(async () => [
        { metadata: { datasetVersion: "v1.0.0" } },
      ]),
      insert: vi.fn(async () => undefined),
    };
    const client = {
      getOrCreateDataset: vi.fn(async () => target),
      flush: vi.fn(async () => undefined),
    };
    const uploader = datasetTestInternals.createSdkUploader(client);

    await expect(uploader.hasVersion("weather-golden", "v1.0.0")).resolves.toBe(
      true
    );
    expect(client.getOrCreateDataset).toHaveBeenCalledWith(
      "weather-golden",
      expect.any(String)
    );
  });

  it("namespaces uploaded item identifiers by immutable dataset version", async () => {
    const target = {
      getItems: vi.fn(async () => []),
      insert: vi.fn(async () => undefined),
    };
    const client = {
      getOrCreateDataset: vi.fn(async () => target),
      flush: vi.fn(async () => undefined),
    };
    const uploader = datasetTestInternals.createSdkUploader(client);

    const dataset = await createWeatherGoldenDataset("v1.0.0", { uploader });

    expect(target.insert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: `v1.0.0:${dataset.items[0].id}`,
          metadata: expect.objectContaining({ datasetVersion: "v1.0.0" }),
        }),
      ])
    );
  });

  it("builds and uploads the approved weather cases as a versioned dataset", async () => {
    const uploader = createUploader();

    const dataset = await createWeatherGoldenDataset("v1.0.0", { uploader });

    expect(dataset.name).toBe("weather-golden");
    expect(dataset.version).toBe("v1.0.0");
    expect(dataset.items.length).toBeGreaterThan(10);
    expect(dataset.items[0]).toMatchObject({
      id: expect.any(String),
      input: {
        intent: "weather",
        capability: expect.any(String),
      },
      metadata: {
        datasetVersion: "v1.0.0",
      },
    });
    expect(JSON.stringify(dataset)).not.toContain("台北現在幾度？");
    expect(uploader.upload).toHaveBeenCalledWith(dataset);
  });

  it("redacts PII while constructing structured input", () => {
    const piiCase: WeatherGoldenEvalCase = {
      id: "WGE-PII-TEST",
      mode: "deterministic",
      capabilityCategory: "current_observation",
      input: {
        prompt: "Email jane@example.com or call +1 415 555 0100",
        toolInput: { location: "jane@example.com", queryName: "+1 415 555 0100" },
      },
      expected: { status: "success", summary: "PII redaction fixture" },
      diagnosticTags: ["pii-test"],
    };

    const dataset = datasetTestInternals.buildWeatherGoldenDataset(
      "v1.0.0",
      [piiCase]
    );
    const serialized = JSON.stringify(dataset);

    expect(serialized).not.toContain("jane@example.com");
    expect(serialized).not.toContain("415 555 0100");
    expect(serialized).not.toContain(piiCase.input.prompt);
    expect(serialized).toContain("[email]");
    expect(serialized).toContain("[phone]");
  });

  it("rejects an existing immutable dataset version without uploading", async () => {
    const uploader = createUploader(true);

    await expect(
      createWeatherGoldenDataset("v1.0.0", { uploader })
    ).rejects.toBeInstanceOf(DatasetVersionConflictError);
    expect(uploader.upload).not.toHaveBeenCalled();
  });
});
