import { getAgentRuntimeConfig } from "../../platform/runtime-config.js";
import { sanitizeMetadata } from "../../platform/tracing/opik/opik-redaction.js";
import {
  WEATHER_GOLDEN_EVAL_CASES,
  type WeatherGoldenEvalCase,
} from "../../tools/weather-golden-eval.js";
import type {
  EvaluationDataset,
  EvaluationItem,
  ExpectedToolCall,
} from "./types.js";

const WEATHER_DATASET_NAME = "weather-golden";
const WEATHER_DATASET_DESCRIPTION =
  "Immutable weather golden evaluation dataset; semantic version is stored per item.";
const SEMVER_PATTERN = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export interface DatasetUploadPort {
  hasVersion(datasetName: string, version: string): Promise<boolean>;
  upload(dataset: EvaluationDataset): Promise<void>;
}

interface CreateWeatherGoldenDatasetOptions {
  uploader?: DatasetUploadPort;
}

interface SdkDataset {
  getItems(): Promise<Array<Record<string, unknown>>>;
  insert(items: Array<Record<string, unknown>>): Promise<void>;
}

interface SdkDatasetClient {
  getOrCreateDataset(name: string, description?: string): Promise<SdkDataset>;
  flush(options?: { silent?: boolean }): Promise<void>;
}

interface OpikSdkModule {
  Opik: new (options: {
    apiKey: string;
    apiUrl: string;
    projectName: string;
    workspaceName?: string;
  }) => SdkDatasetClient;
}

export class DatasetVersionConflictError extends Error {
  constructor(datasetName: string, version: string) {
    super(`Dataset ${datasetName} version ${version} already exists`);
    this.name = "DatasetVersionConflictError";
  }
}

function isOpikSdkModule(value: unknown): value is OpikSdkModule {
  return Boolean(
    value &&
      typeof value === "object" &&
      "Opik" in value &&
      typeof value.Opik === "function"
  );
}

function expectedToolCalls(testCase: WeatherGoldenEvalCase): ExpectedToolCall[] {
  if (!testCase.input.toolInput) return [];
  const name =
    testCase.capabilityCategory === "daily_forecast" ||
    testCase.capabilityCategory === "hourly_forecast"
      ? "weather_forecast"
      : "current_weather";
  return [
    {
      name,
      arguments: sanitizeMetadata(testCase.input.toolInput),
    },
  ];
}

function toEvaluationItem(
  testCase: WeatherGoldenEvalCase,
  version: string
): EvaluationItem {
  const parameters = testCase.input.toolInput
    ? sanitizeMetadata(testCase.input.toolInput)
    : {};
  return {
    id: testCase.id,
    input: {
      intent: "weather",
      capability: testCase.capabilityCategory,
      parameters,
    },
    expectedOutput: {
      toolCalls: expectedToolCalls(testCase),
      summary: testCase.expected.summary,
      ...(testCase.expected.status ? { status: testCase.expected.status } : {}),
      ...(testCase.expected.code ? { code: testCase.expected.code } : {}),
    },
    metadata: {
      datasetVersion: version,
      mode: testCase.mode,
      capabilityCategory: testCase.capabilityCategory,
      diagnosticTags: [...testCase.diagnosticTags],
    },
  };
}

function buildWeatherGoldenDataset(
  version: string,
  cases: readonly WeatherGoldenEvalCase[]
): EvaluationDataset {
  if (!SEMVER_PATTERN.test(version)) {
    throw new TypeError(`Dataset version must use v-prefixed semver: ${version}`);
  }
  return {
    name: WEATHER_DATASET_NAME,
    version,
    items: cases.map((testCase) => toEvaluationItem(testCase, version)),
  };
}

function itemHasVersion(item: Record<string, unknown>, version: string): boolean {
  const metadata = item.metadata;
  return Boolean(
    metadata &&
      typeof metadata === "object" &&
      !Array.isArray(metadata) &&
      "datasetVersion" in metadata &&
      metadata.datasetVersion === version
  );
}

class SdkDatasetUploader implements DatasetUploadPort {
  constructor(private readonly client: SdkDatasetClient) {}

  async hasVersion(datasetName: string, version: string): Promise<boolean> {
    const dataset = await this.client.getOrCreateDataset(
      datasetName,
      WEATHER_DATASET_DESCRIPTION
    );
    const items = await dataset.getItems();
    return items.some((item) => itemHasVersion(item, version));
  }

  async upload(dataset: EvaluationDataset): Promise<void> {
    const target = await this.client.getOrCreateDataset(
      dataset.name,
      WEATHER_DATASET_DESCRIPTION
    );
    const transportItems: Array<Record<string, unknown>> = dataset.items.map(
      (item) => ({
        id: `${dataset.version}:${item.id}`,
        input: item.input,
        ...(item.expectedOutput ? { expectedOutput: item.expectedOutput } : {}),
        ...(item.goldenTrace ? { goldenTrace: item.goldenTrace } : {}),
        ...(item.metadata ? { metadata: item.metadata } : {}),
      })
    );
    await target.insert(transportItems);
    await this.client.flush({ silent: true });
  }
}

async function createDefaultUploader(): Promise<DatasetUploadPort | undefined> {
  const config = getAgentRuntimeConfig();
  if (!config.opikEnabled) return undefined;
  if (!config.opikRedactEnabled) {
    console.warn(
      JSON.stringify({
        event: "opik_dataset_upload_skipped",
        reason: "redaction_required",
      })
    );
    return undefined;
  }
  if (!config.opikApiKey) {
    console.warn(JSON.stringify({ event: "opik_dataset_upload_skipped", reason: "missing_api_key" }));
    return undefined;
  }

  try {
    const sdk: unknown = await import("opik");
    if (!isOpikSdkModule(sdk)) throw new TypeError("Opik SDK export is invalid");
    const client = new sdk.Opik({
      apiKey: config.opikApiKey,
      apiUrl: config.opikHost,
      projectName: config.opikProjectName,
      ...(config.opikWorkspace ? { workspaceName: config.opikWorkspace } : {}),
    });
    return new SdkDatasetUploader(client);
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "opik_dataset_upload_skipped",
        reason: "sdk_unavailable",
        errorName: error instanceof Error ? error.name : "UnknownError",
      })
    );
    return undefined;
  }
}

export async function createWeatherGoldenDataset(
  version: string,
  options: CreateWeatherGoldenDatasetOptions = {}
): Promise<EvaluationDataset> {
  const dataset = buildWeatherGoldenDataset(version, WEATHER_GOLDEN_EVAL_CASES);
  const uploader = options.uploader ?? (await createDefaultUploader());
  if (!uploader) return dataset;
  if (await uploader.hasVersion(dataset.name, dataset.version)) {
    throw new DatasetVersionConflictError(dataset.name, dataset.version);
  }
  await uploader.upload(dataset);
  return dataset;
}

export const datasetTestInternals = {
  buildWeatherGoldenDataset,
  createSdkUploader: (client: SdkDatasetClient): DatasetUploadPort =>
    new SdkDatasetUploader(client),
};
