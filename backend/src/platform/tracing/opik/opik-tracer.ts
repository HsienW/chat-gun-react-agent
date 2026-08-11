import { AsyncLocalStorage } from "node:async_hooks";

import { getAgentRuntimeConfig } from "../../runtime-config.js";
import {
  sanitizeMetadata,
  sanitizeSpanInput,
  sanitizeSpanOutput,
} from "./opik-redaction.js";
import {
  createNoopOpikClient,
  initOpik,
  type OpikClient,
  type OpikConfig,
  type OpikMetadata,
  type OpikPayload,
  type OpikSpan,
  type OpikTrace,
} from "./opik-setup.js";

export interface AgentRunMetadata {
  threadId: string;
  runId: string;
  taskId?: string;
  requestId?: string;
  modelName?: string;
  providerName?: string;
}

export interface NodeSpanMetadata {
  stepId?: string;
}

export interface LlmSpanMetadata {
  stepId?: string;
  modelName: string;
  providerName: string;
}

export interface ToolSpanMetadata {
  stepId?: string;
  toolName: string;
  toolCallId?: string;
}

export interface RetrySpanMetadata {
  attempt: number;
  reason: string;
  stepId?: string;
}

export interface OpikTracer {
  traceAgentRun<T>(
    agentName: string,
    metadata: AgentRunMetadata,
    execution: () => Promise<T>
  ): Promise<T>;
  traceAgentStream<T>(
    agentName: string,
    metadata: AgentRunMetadata,
    execution: () => AsyncIterable<T> | Promise<AsyncIterable<T>>
  ): AsyncIterable<T>;
  withNodeSpan<T>(
    nodeName: string,
    metadata: NodeSpanMetadata,
    execution: () => Promise<T>,
    input?: unknown
  ): Promise<T>;
  withLlmSpan<T>(
    metadata: LlmSpanMetadata,
    execution: () => Promise<T>,
    input?: unknown
  ): Promise<T>;
  withToolSpan<T>(
    metadata: ToolSpanMetadata,
    execution: () => Promise<T>,
    input?: unknown
  ): Promise<T>;
  withRetrySpan<T>(
    metadata: RetrySpanMetadata,
    execution: () => Promise<T>
  ): Promise<T>;
  getActiveTraceId(): string | undefined;
  logFeedback(name: string, value: number, reason?: string): void;
  flush(): Promise<void>;
}

interface OpikTraceContext {
  trace: OpikTrace;
  activeSpan?: OpikSpan;
  metadata: OpikMetadata;
}

interface CreateOpikTracerOptions {
  client?: OpikClient;
}

function warnTracerOperation(operation: string, error: unknown): void {
  console.warn(
    JSON.stringify({
      event: "opik_tracer_operation_failed",
      operation,
      errorName: error instanceof Error ? error.name : "UnknownError",
    })
  );
}

function errorMetadata(error: unknown): OpikMetadata {
  const safeError = sanitizeSpanOutput(
    error instanceof Error ? error : new Error(String(error))
  );
  if (
    safeError &&
    typeof safeError === "object" &&
    !Array.isArray(safeError)
  ) {
    return {
      status: "failed",
      "error.type": safeError.name ?? "UnknownError",
      "error.message": safeError.message ?? "Operation failed",
    };
  }
  return { status: "failed", "error.type": "UnknownError" };
}

function readUsageMetadata(output: unknown): OpikMetadata {
  if (!output || typeof output !== "object" || !("usage_metadata" in output)) {
    return {};
  }
  const usage = output.usage_metadata;
  if (!usage || typeof usage !== "object") return {};

  const metadata: OpikMetadata = {};
  if ("input_tokens" in usage && typeof usage.input_tokens === "number") {
    metadata.inputTokens = usage.input_tokens;
  }
  if ("output_tokens" in usage && typeof usage.output_tokens === "number") {
    metadata.outputTokens = usage.output_tokens;
  }
  if ("total_tokens" in usage && typeof usage.total_tokens === "number") {
    metadata.totalTokens = usage.total_tokens;
  }
  return metadata;
}

class NoopOpikTracer implements OpikTracer {
  traceAgentRun<T>(
    _agentName: string,
    _metadata: AgentRunMetadata,
    execution: () => Promise<T>
  ): Promise<T> {
    return execution();
  }

  traceAgentStream<T>(
    _agentName: string,
    _metadata: AgentRunMetadata,
    execution: () => AsyncIterable<T> | Promise<AsyncIterable<T>>
  ): AsyncIterable<T> {
    return {
      async *[Symbol.asyncIterator]() {
        const iterable = await execution();
        for await (const chunk of iterable) yield chunk;
      },
    };
  }

  withNodeSpan<T>(
    _nodeName: string,
    _metadata: NodeSpanMetadata,
    execution: () => Promise<T>
  ): Promise<T> {
    return execution();
  }

  withLlmSpan<T>(
    _metadata: LlmSpanMetadata,
    execution: () => Promise<T>
  ): Promise<T> {
    return execution();
  }

  withToolSpan<T>(
    _metadata: ToolSpanMetadata,
    execution: () => Promise<T>
  ): Promise<T> {
    return execution();
  }

  withRetrySpan<T>(
    _metadata: RetrySpanMetadata,
    execution: () => Promise<T>
  ): Promise<T> {
    return execution();
  }

  getActiveTraceId(): string | undefined {
    return undefined;
  }

  logFeedback(): void {}

  async flush(): Promise<void> {}
}

class RealOpikTracer implements OpikTracer {
  private readonly context = new AsyncLocalStorage<OpikTraceContext>();
  private readonly clientPromise: Promise<OpikClient>;

  constructor(config: OpikConfig, client?: OpikClient) {
    this.clientPromise = client
      ? Promise.resolve(client)
      : initOpik(config).then((result) => result.client);
  }

  async traceAgentRun<T>(
    agentName: string,
    metadata: AgentRunMetadata,
    execution: () => Promise<T>
  ): Promise<T> {
    const client = await this.clientPromise;
    if (!client.isConfigured()) return execution();

    const safeMetadata = sanitizeMetadata(metadata);
    let trace: OpikTrace;
    try {
      trace = client.startTrace(`agent.${agentName}`, safeMetadata);
    } catch (error) {
      warnTracerOperation("traceAgentRun.start", error);
      return execution();
    }

    try {
      const output = await this.context.run(
        { trace, metadata: safeMetadata },
        execution
      );
      try {
        trace.update({ status: "completed" });
        trace.end(undefined, sanitizeSpanOutput(output));
      } catch (error) {
        warnTracerOperation("traceAgentRun.end", error);
      }
      return output;
    } catch (error) {
      try {
        trace.update(errorMetadata(error));
        trace.end(undefined, sanitizeSpanOutput(error));
      } catch (traceError) {
        warnTracerOperation("traceAgentRun.error", traceError);
      }
      throw error;
    }
  }

  traceAgentStream<T>(
    agentName: string,
    metadata: AgentRunMetadata,
    execution: () => AsyncIterable<T> | Promise<AsyncIterable<T>>
  ): AsyncIterable<T> {
    const tracer = this;
    return {
      async *[Symbol.asyncIterator]() {
        yield* tracer.consumeTracedStream(agentName, metadata, execution);
      },
    };
  }

  withNodeSpan<T>(
    nodeName: string,
    metadata: NodeSpanMetadata,
    execution: () => Promise<T>,
    input?: unknown
  ): Promise<T> {
    return this.withSpan(
      `node.${nodeName}`,
      { ...metadata, nodeName },
      execution,
      input
    );
  }

  withLlmSpan<T>(
    metadata: LlmSpanMetadata,
    execution: () => Promise<T>,
    input?: unknown
  ): Promise<T> {
    return this.withSpan("llm.call", metadata, execution, input, readUsageMetadata);
  }

  withToolSpan<T>(
    metadata: ToolSpanMetadata,
    execution: () => Promise<T>,
    input?: unknown
  ): Promise<T> {
    return this.withSpan("tool.execute", metadata, execution, input, undefined, true);
  }

  withRetrySpan<T>(
    metadata: RetrySpanMetadata,
    execution: () => Promise<T>
  ): Promise<T> {
    return this.withSpan("retry.attempt", metadata, execution);
  }

  getActiveTraceId(): string | undefined {
    return this.context.getStore()?.trace.id;
  }

  logFeedback(name: string, value: number, reason?: string): void {
    const trace = this.context.getStore()?.trace;
    if (!trace) return;
    try {
      trace.logFeedback(name, value, reason);
    } catch (error) {
      warnTracerOperation("trace.feedback", error);
    }
  }

  async flush(): Promise<void> {
    const client = await this.clientPromise;
    await client.flush();
  }

  private async withSpan<T>(
    name: string,
    metadata: object,
    execution: () => Promise<T>,
    input?: unknown,
    outputMetadata?: (output: unknown) => OpikMetadata,
    recordDuration = false
  ): Promise<T> {
    const parentContext = this.context.getStore();
    if (!parentContext) return execution();

    const safeMetadata = sanitizeMetadata({
      ...parentContext.metadata,
      ...metadata,
    });
    let span: OpikSpan;
    try {
      span = parentContext.activeSpan
        ? parentContext.activeSpan.startSpan(name, safeMetadata)
        : parentContext.trace.startSpan(name, safeMetadata);
    } catch (error) {
      warnTracerOperation("span.start", error);
      return execution();
    }

    const startedAt = Date.now();
    try {
      const output = await this.context.run(
        { ...parentContext, activeSpan: span, metadata: safeMetadata },
        execution
      );
      try {
        const additionalMetadata = {
          ...(outputMetadata ? outputMetadata(output) : {}),
          ...(recordDuration ? { durationMs: Date.now() - startedAt } : {}),
          status: "completed",
        } satisfies OpikMetadata;
        span.update(additionalMetadata);
        span.end(
          input === undefined ? undefined : sanitizeSpanInput(input),
          sanitizeSpanOutput(output)
        );
      } catch (error) {
        warnTracerOperation("span.end", error);
      }
      return output;
    } catch (error) {
      try {
        span.update({
          ...errorMetadata(error),
          ...(recordDuration ? { durationMs: Date.now() - startedAt } : {}),
        });
        span.end(
          input === undefined ? undefined : sanitizeSpanInput(input),
          sanitizeSpanOutput(error)
        );
      } catch (spanError) {
        warnTracerOperation("span.error", spanError);
      }
      throw error;
    }
  }

  private async *consumeTracedStream<T>(
    agentName: string,
    metadata: AgentRunMetadata,
    execution: () => AsyncIterable<T> | Promise<AsyncIterable<T>>
  ): AsyncIterable<T> {
    const client = await this.clientPromise;
    if (!client.isConfigured()) {
      const iterable = await execution();
      for await (const chunk of iterable) yield chunk;
      return;
    }

    const safeMetadata = sanitizeMetadata(metadata);
    let trace: OpikTrace;
    try {
      trace = client.startTrace(`agent.${agentName}`, safeMetadata);
    } catch (error) {
      warnTracerOperation("traceAgentStream.start", error);
      const iterable = await execution();
      for await (const chunk of iterable) yield chunk;
      return;
    }

    const traceContext: OpikTraceContext = { trace, metadata: safeMetadata };
    let iterator: AsyncIterator<T> | undefined;
    let terminalStatus: "completed" | "cancelled" | "failed" = "cancelled";
    try {
      const iterable = await this.context.run(traceContext, execution);
      const activeIterator = iterable[Symbol.asyncIterator]();
      iterator = activeIterator;
      while (true) {
        const next = await this.context.run(traceContext, () => activeIterator.next());
        if (next.done) break;
        yield next.value;
      }
      terminalStatus = "completed";
    } catch (error) {
      terminalStatus = "failed";
      try {
        trace.update(errorMetadata(error));
        trace.end(undefined, sanitizeSpanOutput(error));
      } catch (traceError) {
        warnTracerOperation("traceAgentStream.error", traceError);
      }
      throw error;
    } finally {
      const activeIterator = iterator;
      const returnMethod = activeIterator?.return;
      if (activeIterator && returnMethod) {
        try {
          await this.context.run(traceContext, () => returnMethod.call(activeIterator));
        } catch (error) {
          warnTracerOperation("traceAgentStream.return", error);
        }
      }
      if (terminalStatus !== "failed") {
        try {
          trace.update({ status: terminalStatus });
          trace.end();
        } catch (error) {
          warnTracerOperation("traceAgentStream.end", error);
        }
      }
    }
  }
}

function configFromRuntime(): OpikConfig {
  const runtimeConfig = getAgentRuntimeConfig();
  return {
    enabled: runtimeConfig.opikEnabled,
    apiKey: runtimeConfig.opikApiKey,
    workspace: runtimeConfig.opikWorkspace,
    host: runtimeConfig.opikHost,
    projectName: runtimeConfig.opikProjectName,
    redactEnabled: runtimeConfig.opikRedactEnabled,
  };
}

export function createOpikTracer(
  config: OpikConfig,
  options: CreateOpikTracerOptions = {}
): OpikTracer {
  if (!config.enabled) return new NoopOpikTracer();
  if (!config.redactEnabled) {
    console.warn("Opik tracing disabled because redaction is required");
    return new NoopOpikTracer();
  }
  return new RealOpikTracer(config, options.client);
}

let globalOpikTracer: OpikTracer | undefined;

export function getOpikTracer(): OpikTracer {
  globalOpikTracer ??= createOpikTracer(configFromRuntime());
  return globalOpikTracer;
}

export function setOpikTracerForTests(tracer: OpikTracer | undefined): void {
  globalOpikTracer = tracer;
}

export function createNoopOpikTracer(): OpikTracer {
  return new NoopOpikTracer();
}

export const opikTracerTestInternals = {
  createNoopOpikClient,
};
