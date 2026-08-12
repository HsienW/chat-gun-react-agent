import { createHash } from "node:crypto";

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
const OPIK_DATASET_NAMESPACE = "477b9cd7-75c2-4a86-a642-4ba6dfb16f16";

export interface DatasetUploadPort {
  hasVersion(datasetName: string, version: string): Promise<boolean>;
  upload(dataset: EvaluationDataset): Promise<void>;
}

export interface DatasetStorePort extends DatasetUploadPort {
  getVersionItems(
    datasetName: string,
    version: string
  ): Promise<Array<Record<string, unknown>>>;
}

interface CreateWeatherGoldenDatasetOptions {
  uploader?: DatasetUploadPort;
}

interface LoadOrCreateWeatherGoldenDatasetOptions {
  store?: DatasetStorePort;
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
      caseId: testCase.id,
      datasetVersion: version,
      mode: testCase.mode,
      capabilityCategory: testCase.capabilityCategory,
      diagnosticTags: [...testCase.diagnosticTags],
    },
  };
}

export class DatasetVersionMismatchError extends Error {
  constructor(datasetName: string, version: string) {
    super(
      `Dataset ${datasetName} version ${version} does not match the immutable source`
    );
    this.name = "DatasetVersionMismatchError";
  }
}

function toDeterministicUuid(namespace: string, name: string): string {
  const namespaceBytes = Buffer.from(namespace.replaceAll("-", ""), "hex");
  const uuidBytes = createHash("sha256")
    .update(namespaceBytes)
    .update(name, "utf8")
    .digest()
    .subarray(0, 16);

  uuidBytes[6] = (uuidBytes[6] & 0x0f) | 0x70;
  uuidBytes[8] = (uuidBytes[8] & 0x3f) | 0x80;

  const hex = uuidBytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function toTransportItems(
  dataset: EvaluationDataset
): Array<Record<string, unknown>> {
  return dataset.items.map((item) => ({
    id: toDeterministicUuid(
      OPIK_DATASET_NAMESPACE,
      `${dataset.version}:${item.id}`
    ),
    input: item.input,
    ...(item.expectedOutput ? { expectedOutput: item.expectedOutput } : {}),
    ...(item.goldenTrace ? { goldenTrace: item.goldenTrace } : {}),
    ...(item.metadata ? { metadata: item.metadata } : {}),
  }));
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

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)])
  );
}

function transportItemCaseId(item: Record<string, unknown>): string | undefined {
  const metadata = item.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return undefined;
  }
  const caseId = (metadata as Record<string, unknown>).caseId;
  return typeof caseId === "string" ? caseId : undefined;
}

function comparableTransportContent(item: Record<string, unknown>): unknown {
  return stableValue({
    input: item.input,
    ...(item.expectedOutput !== undefined
      ? { expectedOutput: item.expectedOutput }
      : {}),
    ...(item.goldenTrace !== undefined ? { goldenTrace: item.goldenTrace } : {}),
    ...(item.metadata !== undefined ? { metadata: item.metadata } : {}),
  });
}

function hasMatchingTransportItems(
  expectedItems: Array<Record<string, unknown>>,
  actualItems: Array<Record<string, unknown>>
): boolean {
  if (expectedItems.length !== actualItems.length) return false;
  const toCaseMap = (items: Array<Record<string, unknown>>) => {
    const entries = items.flatMap((item) => {
      const caseId = transportItemCaseId(item);
      return caseId ? [[caseId, item] as const] : [];
    });
    return entries.length === items.length &&
      new Set(entries.map(([id]) => id)).size === items.length
      ? new Map(entries)
      : undefined;
  };
  const expectedByCase = toCaseMap(expectedItems);
  const actualByCase = toCaseMap(actualItems);
  if (!expectedByCase || !actualByCase) return false;
  return [...expectedByCase].every(([caseId, expectedItem]) => {
    const actualItem = actualByCase.get(caseId);
    return (
      actualItem !== undefined &&
      JSON.stringify(comparableTransportContent(expectedItem)) ===
        JSON.stringify(comparableTransportContent(actualItem))
    );
  });
}

class SdkDatasetUploader implements DatasetStorePort {
  constructor(private readonly client: SdkDatasetClient) {}

  async hasVersion(datasetName: string, version: string): Promise<boolean> {
    return (await this.getVersionItems(datasetName, version)).length > 0;
  }

  async getVersionItems(
    datasetName: string,
    version: string
  ): Promise<Array<Record<string, unknown>>> {
    const dataset = await this.client.getOrCreateDataset(
      datasetName,
      WEATHER_DATASET_DESCRIPTION
    );
    const items = await dataset.getItems();
    return items.filter((item) => itemHasVersion(item, version));
  }

  async upload(dataset: EvaluationDataset): Promise<void> {
    const target = await this.client.getOrCreateDataset(
      dataset.name,
      WEATHER_DATASET_DESCRIPTION
    );
    await target.insert(toTransportItems(dataset));
    await this.client.flush({ silent: true });
  }
}

async function createDefaultUploader(): Promise<DatasetStorePort | undefined> {
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

export async function loadOrCreateWeatherGoldenDataset(
  version: string,
  options: LoadOrCreateWeatherGoldenDatasetOptions = {}
): Promise<EvaluationDataset> {
  const dataset = buildWeatherGoldenDataset(version, WEATHER_GOLDEN_EVAL_CASES);
  const store = options.store ?? (await createDefaultUploader());
  if (!store) return dataset;

  const existingItems = await store.getVersionItems(
    dataset.name,
    dataset.version
  );
  if (existingItems.length === 0) {
    await store.upload(dataset);
    return dataset;
  }
  const expectedItems = toTransportItems(dataset);
  if (!hasMatchingTransportItems(expectedItems, existingItems)) {
    throw new DatasetVersionMismatchError(dataset.name, dataset.version);
  }
  return dataset;
}

export const datasetTestInternals = {
  OPIK_DATASET_NAMESPACE,
  WEATHER_GOLDEN_EVAL_CASES,
  buildWeatherGoldenDataset,
  createSdkUploader: (client: SdkDatasetClient): DatasetStorePort =>
    new SdkDatasetUploader(client),
  toTransportItems,
  toDeterministicUuid,
};
