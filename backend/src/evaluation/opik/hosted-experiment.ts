import { getAgentRuntimeConfig } from "../../platform/runtime-config.js";
import type { EvaluationDataset } from "./types.js";

const DATASET_VERSION_PAGE_SIZE = 100;
const MAX_DATASET_VERSION_PAGES = 100;
const SDK_VERSION_NAME_PATTERN = /^v(\d+)$/;

export type HostedExperimentSkipReason =
  | "disabled"
  | "missing_api_key"
  | "redaction_required";

export type HostedExperimentPublication =
  | {
      hostedStatus: "SUCCEEDED";
      hostedExperimentId: string;
      hostedExperimentUrl: string;
      hostedDatasetId: string;
      hostedDatasetVersionId: string;
    }
  | {
      hostedStatus: "SKIPPED";
      hostedSkipReason: HostedExperimentSkipReason;
    };

export interface HostedExperimentInput {
  localExperimentId: string;
  dataset: EvaluationDataset;
  agentConfig: {
    model: string;
    provider: string;
    promptVersion?: string;
  };
  judgeConfig?: {
    model: string;
    provider: string;
    temperature: number;
    promptVersion: string;
    promptTemplateHash: string;
  };
  metrics: Array<{ name: string; deterministic: boolean }>;
  traceReferences: Array<{ caseId: string; traceId: string }>;
}

export interface HostedExperimentPublisher {
  publish(input: HostedExperimentInput): Promise<HostedExperimentPublication>;
}

interface SdkDatasetVersionSummary {
  id?: string;
  versionName?: string;
}

interface SdkDatasetVersionPage {
  content?: SdkDatasetVersionSummary[];
  page?: number;
  size?: number;
  total?: number;
}

interface SdkDatasetVersion {
  getItems(): Promise<Array<Record<string, unknown>>>;
}

interface SdkDataset {
  id: string;
  getVersionView(versionName: string): Promise<SdkDatasetVersion>;
}

interface SdkExperimentItemReference {
  datasetItemId: string;
  traceId: string;
  projectName?: string;
}

interface SdkExperiment {
  id: string;
  insert(references: SdkExperimentItemReference[]): Promise<void>;
  getUrl(): Promise<string>;
}

interface SdkHostedExperimentClient {
  api: {
    datasets: {
      listDatasetVersions(
        datasetId: string,
        request: { page: number; size: number }
      ): Promise<SdkDatasetVersionPage>;
    };
  };
  getDataset(name: string, projectName?: string): Promise<SdkDataset>;
  createExperiment(input: {
    datasetName: string;
    datasetVersionId: string;
    projectName: string;
    experimentConfig: Record<string, unknown>;
  }): Promise<SdkExperiment>;
  flush(options?: { silent?: boolean }): Promise<void>;
}

interface OpikSdkModule {
  Opik: new (options: {
    apiKey: string;
    apiUrl: string;
    projectName: string;
    workspaceName?: string;
  }) => SdkHostedExperimentClient;
}

interface HostedDatasetReference {
  datasetId: string;
  datasetVersionId: string;
  itemIdByCaseId: ReadonlyMap<string, string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isOpikSdkModule(value: unknown): value is OpikSdkModule {
  return Boolean(
    isRecord(value) && "Opik" in value && typeof value.Opik === "function"
  );
}

function requireNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
}

function requireHttpUrl(value: unknown, name: string): string {
  const url = new URL(requireNonEmptyString(value, name));
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError(`${name} must use http or https`);
  }
  return url.toString();
}

function sdkVersionOrdinal(versionName: string): number {
  const match = SDK_VERSION_NAME_PATTERN.exec(versionName);
  if (!match) throw new TypeError(`Invalid hosted dataset version: ${versionName}`);
  return Number(match[1]);
}

async function listDatasetVersions(
  client: SdkHostedExperimentClient,
  datasetId: string
): Promise<Array<{ id: string; versionName: string }>> {
  const versions: Array<{ id: string; versionName: string }> = [];
  for (let page = 1; page <= MAX_DATASET_VERSION_PAGES; page += 1) {
    const response = await client.api.datasets.listDatasetVersions(datasetId, {
      page,
      size: DATASET_VERSION_PAGE_SIZE,
    });
    const content = response.content ?? [];
    for (const version of content) {
      versions.push({
        id: requireNonEmptyString(version.id, "hosted dataset version id"),
        versionName: requireNonEmptyString(
          version.versionName,
          "hosted dataset version name"
        ),
      });
    }
    const total = response.total;
    if (
      content.length < DATASET_VERSION_PAGE_SIZE ||
      (typeof total === "number" && versions.length >= total)
    ) {
      return versions;
    }
  }
  throw new Error("Hosted dataset version history exceeds the safety limit");
}

function mapHostedItemIdsByCaseId(
  items: Array<Record<string, unknown>>,
  dataset: EvaluationDataset
): ReadonlyMap<string, string> | undefined {
  const expectedCaseIds = new Set(dataset.items.map((item) => item.id));
  const itemIdByCaseId = new Map<string, string>();

  for (const item of items) {
    if (!isRecord(item.metadata)) continue;
    const caseId = item.metadata.caseId;
    const datasetVersion = item.metadata.datasetVersion;
    if (
      typeof caseId !== "string" ||
      datasetVersion !== dataset.version ||
      !expectedCaseIds.has(caseId)
    ) {
      continue;
    }
    const itemId = requireNonEmptyString(item.id, "hosted dataset item id");
    if (itemIdByCaseId.has(caseId)) {
      throw new Error(`Hosted dataset version contains duplicate case ${caseId}`);
    }
    itemIdByCaseId.set(caseId, itemId);
  }

  return itemIdByCaseId.size === expectedCaseIds.size
    ? itemIdByCaseId
    : undefined;
}

async function resolveHostedDatasetReference(
  client: SdkHostedExperimentClient,
  dataset: EvaluationDataset,
  projectName: string
): Promise<HostedDatasetReference> {
  const hostedDataset = await client.getDataset(dataset.name, projectName);
  const datasetId = requireNonEmptyString(hostedDataset.id, "hosted dataset id");
  const versions = (await listDatasetVersions(client, datasetId)).sort(
    (left, right) =>
      sdkVersionOrdinal(left.versionName) - sdkVersionOrdinal(right.versionName)
  );

  for (const version of versions) {
    const versionView = await hostedDataset.getVersionView(version.versionName);
    const itemIdByCaseId = mapHostedItemIdsByCaseId(
      await versionView.getItems(),
      dataset
    );
    if (itemIdByCaseId) {
      return { datasetId, datasetVersionId: version.id, itemIdByCaseId };
    }
  }

  throw new Error(
    `Hosted dataset ${dataset.name} does not contain the requested immutable version ${dataset.version}`
  );
}

function experimentConfig(input: HostedExperimentInput): Record<string, unknown> {
  return {
    dataset: { name: input.dataset.name, version: input.dataset.version },
    agent: { ...input.agentConfig },
    ...(input.judgeConfig ? { judge: { ...input.judgeConfig } } : {}),
    metrics: input.metrics.map((metric) => ({ ...metric })),
  };
}

function buildExperimentItemReferences(
  input: HostedExperimentInput,
  projectName: string,
  itemIdByCaseId: ReadonlyMap<string, string>
): SdkExperimentItemReference[] {
  const caseIds = new Set(input.dataset.items.map((item) => item.id));
  const referencedCaseIds = new Set<string>();
  return input.traceReferences.map(({ caseId, traceId }) => {
    if (!caseIds.has(caseId)) {
      throw new TypeError(`Trace reference has unknown dataset case: ${caseId}`);
    }
    if (referencedCaseIds.has(caseId)) {
      throw new TypeError(`Trace reference is duplicated for dataset case: ${caseId}`);
    }
    referencedCaseIds.add(caseId);
    const datasetItemId = itemIdByCaseId.get(caseId);
    if (!datasetItemId) {
      throw new TypeError(`Hosted dataset item is missing for case: ${caseId}`);
    }
    return {
      datasetItemId,
      traceId: requireNonEmptyString(traceId, "trace id"),
      projectName,
    };
  });
}

class SdkHostedExperimentPublisher implements HostedExperimentPublisher {
  constructor(
    private readonly client: SdkHostedExperimentClient,
    private readonly projectName: string
  ) {}

  async publish(
    input: HostedExperimentInput
  ): Promise<HostedExperimentPublication> {
    const hostedDataset = await resolveHostedDatasetReference(
      this.client,
      input.dataset,
      this.projectName
    );
    const experiment = await this.client.createExperiment({
      datasetName: input.dataset.name,
      datasetVersionId: hostedDataset.datasetVersionId,
      projectName: this.projectName,
      experimentConfig: experimentConfig(input),
    });
    const references = buildExperimentItemReferences(
      input,
      this.projectName,
      hostedDataset.itemIdByCaseId
    );
    if (references.length > 0) await experiment.insert(references);
    await this.client.flush({ silent: true });

    return {
      hostedStatus: "SUCCEEDED",
      hostedExperimentId: requireNonEmptyString(
        experiment.id,
        "hosted experiment id"
      ),
      hostedExperimentUrl: requireHttpUrl(
        await experiment.getUrl(),
        "hosted experiment URL"
      ),
      hostedDatasetId: hostedDataset.datasetId,
      hostedDatasetVersionId: hostedDataset.datasetVersionId,
    };
  }
}

export function createSdkHostedExperimentPublisher(
  client: SdkHostedExperimentClient,
  projectName: string
): HostedExperimentPublisher {
  return new SdkHostedExperimentPublisher(client, projectName);
}

export async function publishHostedExperiment(
  input: HostedExperimentInput
): Promise<HostedExperimentPublication> {
  const config = getAgentRuntimeConfig();
  if (!config.opikEnabled) {
    return { hostedStatus: "SKIPPED", hostedSkipReason: "disabled" };
  }
  if (!config.opikRedactEnabled) {
    return {
      hostedStatus: "SKIPPED",
      hostedSkipReason: "redaction_required",
    };
  }
  if (!config.opikApiKey) {
    return {
      hostedStatus: "SKIPPED",
      hostedSkipReason: "missing_api_key",
    };
  }

  const sdk: unknown = await import("opik");
  if (!isOpikSdkModule(sdk)) throw new TypeError("Opik SDK export is invalid");
  const client = new sdk.Opik({
    apiKey: config.opikApiKey,
    apiUrl: config.opikHost,
    projectName: config.opikProjectName,
    ...(config.opikWorkspace ? { workspaceName: config.opikWorkspace } : {}),
  });
  return createSdkHostedExperimentPublisher(
    client,
    config.opikProjectName
  ).publish(input);
}
