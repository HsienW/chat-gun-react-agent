import {
  context,
  createContextKey,
  INVALID_SPAN_CONTEXT,
  SpanStatusCode,
  trace,
  type Context,
  type Span,
  type SpanKind,
  type Tracer,
} from "@opentelemetry/api";

import { getAgentRuntimeConfig } from "../runtime-config.js";
import { initTracing } from "./otel-setup.js";

export type TraceAttributeValue = string | number | boolean;
export type TraceAttributes = Record<string, TraceAttributeValue>;

export interface SpanOptions {
  kind?: SpanKind;
  attributes?: TraceAttributes;
  parentContext?: Context;
}

export interface SpanManager {
  startSpan(name: string, options?: SpanOptions): Span;
  endSpan(span: Span): void;
  recordException(span: Span, error: Error): void;
  setAttributes(span: Span, attributes: TraceAttributes): void;
  getActiveSpan(): Span | undefined;
  withSpan<T>(
    name: string,
    options: SpanOptions,
    operation: () => Promise<T> | T
  ): Promise<T>;
}

const traceAttributesKey = createContextKey("chat-gun.trace-attributes");

function warnSpanOperation(operation: string, error: unknown): void {
  console.warn(
    JSON.stringify({
      event: "otel_span_operation_failed",
      operation,
      errorName: error instanceof Error ? error.name : "UnknownError",
    })
  );
}

function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(
      /(authorization|api[-_]?key|token|password|secret|credential)(\s*[:=]\s*)[^\s,;]+/gi,
      "$1$2[redacted]"
    )
    .slice(0, 512);
}

function getInheritedAttributes(parentContext: Context): TraceAttributes {
  const value = parentContext.getValue(traceAttributesKey);
  if (value === null || typeof value !== "object") return {};

  const attributes: TraceAttributes = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      typeof entry === "string" ||
      typeof entry === "number" ||
      typeof entry === "boolean"
    ) {
      attributes[key] = entry;
    }
  }
  return attributes;
}

function noopSpan(): Span {
  return trace.wrapSpanContext(INVALID_SPAN_CONTEXT);
}

class NoopSpanManager implements SpanManager {
  startSpan(): Span {
    return noopSpan();
  }
  endSpan(): void {}
  recordException(): void {}
  setAttributes(): void {}
  getActiveSpan(): Span | undefined {
    return undefined;
  }
  async withSpan<T>(
    _name: string,
    _options: SpanOptions,
    operation: () => Promise<T> | T
  ): Promise<T> {
    return operation();
  }
}

class OtelSpanManager implements SpanManager {
  constructor(
    private readonly tracer: Tracer,
    private readonly serviceName: string
  ) {}

  private attributesFor(options: SpanOptions, parentContext: Context): TraceAttributes {
    return {
      ...getInheritedAttributes(parentContext),
      "service.name": this.serviceName,
      ...options.attributes,
    };
  }

  startSpan(name: string, options: SpanOptions = {}): Span {
    try {
      const parentContext = options.parentContext ?? context.active();
      return this.tracer.startSpan(
        name,
        {
          kind: options.kind,
          attributes: this.attributesFor(options, parentContext),
        },
        parentContext
      );
    } catch (error) {
      warnSpanOperation("startSpan", error);
      return noopSpan();
    }
  }

  endSpan(span: Span): void {
    try {
      span.end();
    } catch (error) {
      warnSpanOperation("endSpan", error);
    }
  }

  recordException(span: Span, error: Error): void {
    try {
      const safeMessage = sanitizeErrorMessage(error.message);
      const safeError = new Error(safeMessage);
      safeError.name = error.name;
      span.recordException(safeError);
      span.setAttributes({
        "error.type": error.name,
        "error.message": safeMessage,
      });
      span.setStatus({ code: SpanStatusCode.ERROR, message: safeMessage });
    } catch (spanError) {
      warnSpanOperation("recordException", spanError);
    }
  }

  setAttributes(span: Span, attributes: TraceAttributes): void {
    try {
      span.setAttributes(attributes);
    } catch (error) {
      warnSpanOperation("setAttributes", error);
    }
  }

  getActiveSpan(): Span | undefined {
    try {
      return trace.getSpan(context.active());
    } catch (error) {
      warnSpanOperation("getActiveSpan", error);
      return undefined;
    }
  }

  async withSpan<T>(
    name: string,
    options: SpanOptions,
    operation: () => Promise<T> | T
  ): Promise<T> {
    const parentContext = options.parentContext ?? context.active();
    const attributes = this.attributesFor(options, parentContext);
    const span = this.startSpan(name, options);
    const activeContext = trace
      .setSpan(parentContext, span)
      .setValue(traceAttributesKey, attributes);

    try {
      return await context.with(activeContext, operation);
    } catch (error) {
      this.recordException(
        span,
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    } finally {
      this.endSpan(span);
    }
  }
}

export function createNoopSpanManager(): SpanManager {
  return new NoopSpanManager();
}

export function createSpanManager(options: {
  tracer: Tracer;
  serviceName: string;
}): SpanManager {
  return new OtelSpanManager(options.tracer, options.serviceName);
}

let globalSpanManager: SpanManager | undefined;

export function getSpanManager(): SpanManager {
  if (globalSpanManager) return globalSpanManager;

  const runtimeConfig = getAgentRuntimeConfig();
  const tracing = initTracing({
    enabled: runtimeConfig.otelEnabled,
    serviceName: runtimeConfig.otelServiceName,
    exporterEndpoint: runtimeConfig.otelExporterEndpoint,
    exporterProtocol: runtimeConfig.otelExporterProtocol,
    sampleRate: runtimeConfig.otelSampleRate,
  });
  globalSpanManager = tracing.enabled
    ? createSpanManager({
        tracer: trace.getTracer(runtimeConfig.otelServiceName),
        serviceName: runtimeConfig.otelServiceName,
      })
    : createNoopSpanManager();
  return globalSpanManager;
}

export function setSpanManagerForTests(manager: SpanManager | undefined): void {
  globalSpanManager = manager;
}
