import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPTraceExporter as OTLPGrpcTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc";
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
  NodeTracerProvider,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace-node";

export type TracingConfig = {
  enabled: boolean;
  serviceName: string;
  exporterEndpoint?: string;
  exporterProtocol: "grpc" | "http";
  sampleRate: number;
};

export type TracingExporter = "none" | "console" | "otlp-http" | "otlp-grpc";

export interface TracingProvider {
  register(): void;
  forceFlush(): Promise<void>;
  shutdown(): Promise<void>;
}

export type TracingProviderOptions = {
  exporter: Exclude<TracingExporter, "none">;
  exporterEndpoint?: string;
  sampleRate: number;
};

export type TracingSetupDependencies = {
  createProvider(options: TracingProviderOptions): TracingProvider;
};

export type TracingInitResult = {
  enabled: boolean;
  exporter: TracingExporter;
};

function createDefaultProvider(options: TracingProviderOptions): TracingProvider {
  const exporter = options.exporter === "otlp-http"
    ? new OTLPTraceExporter({ url: options.exporterEndpoint })
    : options.exporter === "otlp-grpc"
      ? new OTLPGrpcTraceExporter({ url: options.exporterEndpoint })
      : new ConsoleSpanExporter();

  return new NodeTracerProvider({
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(options.sampleRate),
    }),
    spanProcessors: [new BatchSpanProcessor(exporter)],
  });
}

const defaultDependencies: TracingSetupDependencies = {
  createProvider: createDefaultProvider,
};

let activeProvider: TracingProvider | undefined;
let activeResult: TracingInitResult | undefined;

function warnInitialization(error: unknown): void {
  console.warn(
    JSON.stringify({
      event: "otel_initialization_failed",
      errorName: error instanceof Error ? error.name : "UnknownError",
    })
  );
}

export function initTracing(
  config: TracingConfig,
  dependencies: TracingSetupDependencies = defaultDependencies
): TracingInitResult {
  if (activeResult) return activeResult;
  if (!config.enabled) {
    activeResult = { enabled: false, exporter: "none" };
    return activeResult;
  }

  try {
    if (!config.exporterEndpoint && process.env.NODE_ENV === "production") {
      throw new Error(
        "Production tracing requires OTEL_EXPORTER_OTLP_ENDPOINT."
      );
    }

    const exporter: Exclude<TracingExporter, "none"> = config.exporterEndpoint
      ? config.exporterProtocol === "grpc"
        ? "otlp-grpc"
        : "otlp-http"
      : "console";
    const provider = dependencies.createProvider({
      exporter,
      exporterEndpoint: config.exporterEndpoint,
      sampleRate: config.sampleRate,
    });
    provider.register();
    activeProvider = provider;
    activeResult = { enabled: true, exporter };
    return activeResult;
  } catch (error) {
    warnInitialization(error);
    activeResult = { enabled: false, exporter: "none" };
    return activeResult;
  }
}

export async function shutdownTracing(): Promise<void> {
  const provider = activeProvider;
  activeProvider = undefined;
  activeResult = undefined;
  if (!provider) return;

  try {
    await provider.forceFlush();
    await provider.shutdown();
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "otel_shutdown_failed",
        errorName: error instanceof Error ? error.name : "UnknownError",
      })
    );
  }
}

export async function resetTracingForTests(): Promise<void> {
  await shutdownTracing();
}
