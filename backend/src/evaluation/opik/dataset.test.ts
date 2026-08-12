import { describe, expect, it, vi } from "vitest";

import type { WeatherGoldenEvalCase } from "../../tools/weather-golden-eval.js";
import {
  createWeatherGoldenDataset,
  DatasetVersionConflictError,
  datasetTestInternals,
  type DatasetUploadPort,
} from "./dataset.js";

const UUID_V7_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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
          id: expect.stringMatching(UUID_V7_RE),
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
        caseId: expect.any(String),
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

describe("toDeterministicUuid", () => {
  const { OPIK_DATASET_NAMESPACE, toDeterministicUuid } = datasetTestInternals;
  const caseId = "WGE-CURRENT-CJK-TAIPEI";

  it("produces a valid UUID v7 with the RFC 9562 variant", () => {
    const transportId = toDeterministicUuid(
      OPIK_DATASET_NAMESPACE,
      `v1.0.0:${caseId}`
    );

    expect(transportId).toMatch(UUID_V7_RE);
    expect(transportId[14]).toBe("7");
    expect(["8", "9", "a", "b"]).toContain(transportId[19]);
  });

  it("returns the same UUID for the same namespace and name", () => {
    const name = `v1.0.0:${caseId}`;

    expect(toDeterministicUuid(OPIK_DATASET_NAMESPACE, name)).toBe(
      toDeterministicUuid(OPIK_DATASET_NAMESPACE, name)
    );
  });

  it("returns different UUIDs for different dataset versions", () => {
    expect(
      toDeterministicUuid(OPIK_DATASET_NAMESPACE, `v1.0.0:${caseId}`)
    ).not.toBe(
      toDeterministicUuid(OPIK_DATASET_NAMESPACE, `v1.0.1:${caseId}`)
    );
  });

  it("returns different UUIDs for different case identifiers", () => {
    expect(
      toDeterministicUuid(OPIK_DATASET_NAMESPACE, `v1.0.0:${caseId}`)
    ).not.toBe(
      toDeterministicUuid(
        OPIK_DATASET_NAMESPACE,
        "v1.0.0:WGE-CURRENT-EN-US-SEATTLE"
      )
    );
  });

  it("returns different UUIDs for different namespaces", () => {
    const name = `v1.0.0:${caseId}`;

    expect(toDeterministicUuid(OPIK_DATASET_NAMESPACE, name)).not.toBe(
      toDeterministicUuid("6ba7b811-9dad-11d1-80b4-00c04fd430c8", name)
    );
  });

  it("never exposes the colon-delimited composite key", () => {
    const transportId = toDeterministicUuid(
      OPIK_DATASET_NAMESPACE,
      `v1.0.0:${caseId}`
    );

    expect(transportId).not.toContain(":");
  });

  it("keeps the hosted Opik transport identifier stable", () => {
    expect(
      toDeterministicUuid(
        OPIK_DATASET_NAMESPACE,
        "v1.0.0:WGE-CURRENT-CJK-TAIPEI"
      )
    ).toMatchInlineSnapshot(`"372997ac-bd9b-7778-984e-f62115eb88dd"`);
  });
});
