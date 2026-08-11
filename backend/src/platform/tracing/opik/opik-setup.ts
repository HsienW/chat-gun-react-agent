export type OpikPayload =
  | null
  | boolean
  | number
  | string
  | OpikPayload[]
  | { [key: string]: OpikPayload };

export type OpikMetadata = Record<string, OpikPayload>;

export interface OpikConfig {
  enabled: boolean;
  apiKey?: string;
  workspace?: string;
  host: string;
  projectName: string;
  redactEnabled: boolean;
}

export interface OpikSpan {
  readonly id?: string;
  startSpan(name: string, metadata?: OpikMetadata): OpikSpan;
  end(input?: OpikPayload, output?: OpikPayload): void;
  update(metadata: OpikMetadata): void;
}

export interface OpikTrace {
  readonly id?: string;
  startSpan(name: string, metadata?: OpikMetadata): OpikSpan;
  end(input?: OpikPayload, output?: OpikPayload): void;
  update(metadata: OpikMetadata): void;
  logFeedback(name: string, value: number, reason?: string): void;
}

export interface OpikClient {
  startTrace(name: string, metadata?: OpikMetadata): OpikTrace;
  isConfigured(): boolean;
  flush(): Promise<void>;
}

interface OpikSdkSpan {
  data?: { id?: unknown };
  update(updates: {
    input?: OpikPayload;
    output?: OpikPayload;
    metadata?: OpikMetadata;
  }): unknown;
  end(): unknown;
  span(data: { name: string; metadata?: OpikMetadata }): OpikSdkSpan;
}

interface OpikSdkTrace {
  data?: { id?: unknown };
  update(updates: {
    input?: OpikPayload;
    output?: OpikPayload;
    metadata?: OpikMetadata;
  }): unknown;
  end(): unknown;
  score(score: { name: string; value: number; reason?: string }): unknown;
  span(data: { name: string; metadata?: OpikMetadata }): OpikSdkSpan;
}

interface OpikSdkClient {
  trace(data: { name: string; metadata?: OpikMetadata }): OpikSdkTrace;
  flush(options?: { silent?: boolean }): Promise<void>;
}

export interface OpikSdkConstructorOptions {
  apiKey: string;
  apiUrl: string;
  projectName: string;
  workspaceName?: string;
}

export interface OpikSdkModule {
  Opik: new (options: OpikSdkConstructorOptions) => OpikSdkClient;
}

export interface OpikInitResult {
  enabled: boolean;
  client: OpikClient;
  reason?:
    | "disabled"
    | "redaction_required"
    | "missing_api_key"
    | "sdk_unavailable"
    | "initialization_failed";
}

interface InitOpikOptions {
  loadSdk?: () => Promise<unknown>;
}

function warnOpikOperation(operation: string, error: unknown): void {
  console.warn(
    JSON.stringify({
      event: "opik_operation_failed",
      operation,
      errorName: error instanceof Error ? error.name : "UnknownError",
    })
  );
}

function readSdkEntityId(entity: { data?: { id?: unknown } }): string | undefined {
  return typeof entity.data?.id === "string" ? entity.data.id : undefined;
}

class NoopOpikSpan implements OpikSpan {
  readonly id = undefined;

  startSpan(): OpikSpan {
    return this;
  }

  end(): void {}

  update(): void {}
}

class NoopOpikTrace implements OpikTrace {
  readonly id = undefined;
  private readonly span = new NoopOpikSpan();

  startSpan(): OpikSpan {
    return this.span;
  }

  end(): void {}

  update(): void {}

  logFeedback(): void {}
}

class NoopOpikClient implements OpikClient {
  private readonly trace = new NoopOpikTrace();

  startTrace(): OpikTrace {
    return this.trace;
  }

  isConfigured(): boolean {
    return false;
  }

  async flush(): Promise<void> {}
}

class SdkOpikSpan implements OpikSpan {
  readonly id: string | undefined;

  constructor(private readonly span: OpikSdkSpan) {
    this.id = readSdkEntityId(span);
  }

  startSpan(name: string, metadata?: OpikMetadata): OpikSpan {
    try {
      return new SdkOpikSpan(this.span.span({ name, ...(metadata ? { metadata } : {}) }));
    } catch (error) {
      warnOpikOperation("span.startSpan", error);
      return new NoopOpikSpan();
    }
  }

  end(input?: OpikPayload, output?: OpikPayload): void {
    try {
      if (input !== undefined || output !== undefined) {
        this.span.update({
          ...(input !== undefined ? { input } : {}),
          ...(output !== undefined ? { output } : {}),
        });
      }
    } catch (error) {
      warnOpikOperation("span.update", error);
    }

    try {
      this.span.end();
    } catch (error) {
      warnOpikOperation("span.end", error);
    }
  }

  update(metadata: OpikMetadata): void {
    try {
      this.span.update({ metadata });
    } catch (error) {
      warnOpikOperation("span.updateMetadata", error);
    }
  }
}

class SdkOpikTrace implements OpikTrace {
  readonly id: string | undefined;

  constructor(private readonly trace: OpikSdkTrace) {
    this.id = readSdkEntityId(trace);
  }

  startSpan(name: string, metadata?: OpikMetadata): OpikSpan {
    try {
      return new SdkOpikSpan(this.trace.span({ name, ...(metadata ? { metadata } : {}) }));
    } catch (error) {
      warnOpikOperation("trace.startSpan", error);
      return new NoopOpikSpan();
    }
  }

  end(input?: OpikPayload, output?: OpikPayload): void {
    try {
      if (input !== undefined || output !== undefined) {
        this.trace.update({
          ...(input !== undefined ? { input } : {}),
          ...(output !== undefined ? { output } : {}),
        });
      }
    } catch (error) {
      warnOpikOperation("trace.update", error);
    }

    try {
      this.trace.end();
    } catch (error) {
      warnOpikOperation("trace.end", error);
    }
  }

  update(metadata: OpikMetadata): void {
    try {
      this.trace.update({ metadata });
    } catch (error) {
      warnOpikOperation("trace.updateMetadata", error);
    }
  }

  logFeedback(name: string, value: number, reason?: string): void {
    try {
      this.trace.score({ name, value, ...(reason ? { reason } : {}) });
    } catch (error) {
      warnOpikOperation("trace.score", error);
    }
  }
}

class SdkOpikClient implements OpikClient {
  constructor(private readonly client: OpikSdkClient) {}

  startTrace(name: string, metadata?: OpikMetadata): OpikTrace {
    try {
      return new SdkOpikTrace(
        this.client.trace({ name, ...(metadata ? { metadata } : {}) })
      );
    } catch (error) {
      warnOpikOperation("client.startTrace", error);
      return new NoopOpikTrace();
    }
  }

  isConfigured(): boolean {
    return true;
  }

  async flush(): Promise<void> {
    try {
      await this.client.flush({ silent: true });
    } catch (error) {
      warnOpikOperation("client.flush", error);
    }
  }
}

const noopClient = new NoopOpikClient();

function isOpikSdkModule(value: unknown): value is OpikSdkModule {
  return Boolean(
    value &&
      typeof value === "object" &&
      "Opik" in value &&
      typeof value.Opik === "function"
  );
}

function isOpikSdkClient(value: unknown): value is OpikSdkClient {
  return Boolean(
    value &&
      typeof value === "object" &&
      "trace" in value &&
      typeof value.trace === "function" &&
      "flush" in value &&
      typeof value.flush === "function"
  );
}

async function loadOpikSdk(): Promise<unknown> {
  return import("opik");
}

function configIdentity(config: OpikConfig): string {
  return JSON.stringify([
    config.enabled,
    config.apiKey,
    config.workspace,
    config.host,
    config.projectName,
    config.redactEnabled,
  ]);
}

let cachedIdentity: string | undefined;
let cachedInitialization: Promise<OpikInitResult> | undefined;

async function initializeOpik(
  config: OpikConfig,
  loadSdk: () => Promise<unknown>
): Promise<OpikInitResult> {
  if (!config.enabled) {
    return { enabled: false, client: noopClient, reason: "disabled" };
  }

  if (!config.redactEnabled) {
    console.warn("Opik tracing disabled because redaction is required");
    return { enabled: false, client: noopClient, reason: "redaction_required" };
  }

  if (!config.apiKey) {
    console.warn("Opik enabled but OPIK_API_KEY not configured");
    return { enabled: false, client: noopClient, reason: "missing_api_key" };
  }

  let sdkModule: unknown;
  try {
    sdkModule = await loadSdk();
  } catch {
    console.warn("Opik SDK not available, tracing disabled");
    return { enabled: false, client: noopClient, reason: "sdk_unavailable" };
  }

  if (!isOpikSdkModule(sdkModule)) {
    console.warn("Opik SDK not available, tracing disabled");
    return { enabled: false, client: noopClient, reason: "sdk_unavailable" };
  }

  try {
    const sdkClient = new sdkModule.Opik({
      apiKey: config.apiKey,
      apiUrl: config.host,
      projectName: config.projectName,
      ...(config.workspace ? { workspaceName: config.workspace } : {}),
    });
    if (!isOpikSdkClient(sdkClient)) {
      throw new Error("Opik SDK client does not expose trace and flush methods");
    }
    return { enabled: true, client: new SdkOpikClient(sdkClient) };
  } catch (error) {
    warnOpikOperation("client.initialize", error);
    return {
      enabled: false,
      client: noopClient,
      reason: "initialization_failed",
    };
  }
}

export function initOpik(
  config: OpikConfig,
  options: InitOpikOptions = {}
): Promise<OpikInitResult> {
  const identity = configIdentity(config);
  if (cachedInitialization && cachedIdentity === identity) {
    return cachedInitialization;
  }

  cachedIdentity = identity;
  cachedInitialization = initializeOpik(config, options.loadSdk ?? loadOpikSdk);
  return cachedInitialization;
}

export function createNoopOpikClient(): OpikClient {
  return new NoopOpikClient();
}

export function resetOpikForTests(): void {
  cachedIdentity = undefined;
  cachedInitialization = undefined;
}
