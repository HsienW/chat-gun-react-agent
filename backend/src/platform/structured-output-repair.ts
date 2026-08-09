import { z } from "zod";
import { BaseMessage } from "@langchain/core/messages";

import { recordMetric } from "./observability.js";
import type { RepairStrategy } from "./llm-fallback.js";
import { getSpanManager } from "./tracing/span-manager.js";

export type RepairStatus =
  | "success"
  | "repaired"
  | "partial"
  | "refusal"
  | "exhausted";

export interface RepairResult<TOutput extends Record<string, unknown>> {
  output: TOutput | null;
  partial: Partial<TOutput> | null;
  status: RepairStatus;
  attempts: number;
  lastError?: string;
}

export interface RepairObserver {
  recordMetric(name: string, payload: Record<string, unknown>): Promise<void> | void;
}

export class StructuredOutputRefusalError extends Error {
  readonly code = "content_filter_refusal";

  constructor() {
    super("The model refused the structured output request.");
    this.name = "StructuredOutputRefusalError";
  }
}

export class StructuredOutputExhaustedError extends Error {
  readonly code = "provider_response_invalid";

  constructor(lastError?: string) {
    super(lastError ? `Structured output repair exhausted: ${lastError}` : "Structured output repair exhausted.");
    this.name = "ProviderResponseParseError";
  }
}

type RepairInput<TShape extends z.ZodRawShape> = {
  invoke(hint?: string): Promise<unknown>;
  schema: z.ZodObject<TShape>;
  strategy: RepairStrategy;
  observer?: RepairObserver;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isRefusal(value: unknown): boolean {
  const record = asRecord(value);
  if (!record) return false;
  const code = typeof record.code === "string" ? record.code.toLowerCase() : "";
  if (record.refusal === true || typeof record.refusal === "string") return true;
  if (["content_filter", "content_filter_refusal", "refusal"].includes(code)) {
    return true;
  }

  const metadata = asRecord(record.response_metadata);
  return metadata?.finish_reason === "content_filter";
}

function parseCandidate(value: unknown):
  | { ok: true; data: unknown }
  | { ok: false; error: string } {
  const normalizedValue = value instanceof BaseMessage
    ? typeof value.content === "string"
      ? value.content
      : value.content
          .flatMap((part) =>
            typeof part === "string"
              ? [part]
              : part && typeof part === "object" && "text" in part &&
                  typeof part.text === "string"
                ? [part.text]
                : []
          )
          .join("\n")
    : value;
  if (typeof normalizedValue !== "string") {
    return { ok: true, data: normalizedValue };
  }
  try {
    const parsed: unknown = JSON.parse(normalizedValue);
    return { ok: true, data: parsed };
  } catch {
    return { ok: false, error: "JSON parse failed" };
  }
}

function formatValidationError(error: z.ZodError): string {
  return JSON.stringify(
    error.issues.map(({ code, path, message }) => ({ code, path, message }))
  );
}

export function extractPartial<TShape extends z.ZodRawShape>(
  rawData: unknown,
  schema: z.ZodObject<TShape>
): {
  partial: Partial<z.infer<z.ZodObject<TShape>>> | null;
  failedKeys: string[];
} {
  const record = asRecord(rawData);
  const result = schema.safeParse(rawData);
  if (!record || result.success) {
    return { partial: result.success ? result.data : null, failedKeys: [] };
  }

  const failedKeys = Array.from(
    new Set(
      result.error.issues.flatMap(({ path }) =>
        typeof path[0] === "string" ? [path[0]] : []
      )
    )
  );
  const partial: Record<string, unknown> = {};

  for (const [key, fieldSchema] of Object.entries(schema.shape)) {
    if (failedKeys.includes(key) || !(key in record)) continue;
    const fieldResult = fieldSchema.safeParse(record[key]);
    if (fieldResult.success) partial[key] = fieldResult.data;
  }

  return {
    partial: Object.keys(partial).length
      ? (partial as Partial<z.infer<z.ZodObject<TShape>>>)
      : null,
    failedKeys,
  };
}

async function safeMetric(
  observer: RepairObserver,
  name: string,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    await observer.recordMetric(name, payload);
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "structured_output_metric_failed",
        metricName: name,
        errorName: error instanceof Error ? error.name : "UnknownError",
      })
    );
  }
}

function recordRepairSpan<TOutput extends Record<string, unknown>>(
  result: RepairResult<TOutput>
): RepairResult<TOutput> {
  try {
    const manager = getSpanManager();
    const span = manager.getActiveSpan();
    if (span) {
      manager.setAttributes(span, {
        "repair.attempts": result.attempts,
        "repair.status": result.status,
      });
    }
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "structured_output_trace_failed",
        errorName: error instanceof Error ? error.name : "UnknownError",
      })
    );
  }
  return result;
}

export async function repairStructuredOutput<TShape extends z.ZodRawShape>(
  input: RepairInput<TShape>
): Promise<RepairResult<z.infer<z.ZodObject<TShape>>>> {
  type Output = z.infer<z.ZodObject<TShape>>;

  const observer = input.observer ?? { recordMetric };
  const maxAttempts = input.strategy === "none" ? 1 : 2;
  let lastError: string | undefined;
  let bestPartial: Partial<Output> | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1) {
      await safeMetric(observer, "structured_output.repair.attempt", {
        attempt,
        strategy: input.strategy,
      });
    }

    const raw = await input.invoke(
      attempt > 1 && input.strategy === "retry_with_hint" ? lastError : undefined
    );
    if (isRefusal(raw)) {
      return recordRepairSpan<Output>({
        output: null,
        partial: null,
        status: "refusal",
        attempts: attempt,
      });
    }

    const candidate = parseCandidate(raw);
    if (!candidate.ok) {
      lastError = candidate.error;
      continue;
    }

    const validation = input.schema.safeParse(candidate.data);
    if (validation.success) {
      if (attempt > 1) {
        await safeMetric(observer, "structured_output.repair.success", {
          attempt,
          strategy: input.strategy,
        });
      }
      return recordRepairSpan<Output>({
        output: validation.data,
        partial: null,
        status: attempt === 1 ? "success" : "repaired",
        attempts: attempt,
      });
    }

    lastError = formatValidationError(validation.error);
    const { partial } = extractPartial(candidate.data, input.schema);
    if (partial) bestPartial = partial;
  }

  return recordRepairSpan<Output>({
    output: null,
    partial: bestPartial,
    status: bestPartial ? "partial" : "exhausted",
    attempts: maxAttempts,
    ...(lastError ? { lastError } : {}),
  });
}
