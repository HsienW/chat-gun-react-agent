import type { StructuredToolInterface } from "@langchain/core/tools";

import { auditLogger, recordMetric } from "./observability.js";

export interface ToolPolicy {
  enabled: boolean;
  audit: boolean;
  timeoutMs: number;
  maxInputChars: number;
  maxOutputChars: number;
  rateLimitKey?: string;
  grayReleaseKey?: string;
  circuitBreakerKey?: string;
}

export interface GovernedTool {
  tool: StructuredToolInterface;
  policy: ToolPolicy;
}

const DEFAULT_TOOL_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_INPUT_CHARS = 8_000;
const DEFAULT_MAX_OUTPUT_CHARS = 24_000;
const governedTools = new WeakSet<object>();

function toolEnvName(toolName: string): string {
  return toolName.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

function parseCsvEnv(name: string): Set<string> {
  return new Set(
    (process.env[name] ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

function getIntEnv(name: string, fallback: number, min: number, max: number): number {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue.trim().length === 0) {
    return fallback;
  }

  const value = Number(rawValue);
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(min, Math.min(Math.trunc(value), max));
}

function getBooleanEnv(name: string, fallback: boolean): boolean {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue.trim().length === 0) {
    return fallback;
  }

  return rawValue.toLowerCase() === "true";
}

function serializeForLimit(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncateOutput(toolName: string, output: unknown, maxOutputChars: number): unknown {
  const text = typeof output === "string" ? output : serializeForLimit(output);
  if (text.length <= maxOutputChars) {
    return output;
  }

  return `${text.slice(0, maxOutputChars)}\n\n[Tool output truncated by governance: ${toolName}, ${maxOutputChars} characters]`;
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number, toolName: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`tool execution timed out after ${timeoutMs}ms: ${toolName}`));
    }, timeoutMs);
  });

  return Promise.race([operation, timeoutPromise]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
}

function resolveToolPolicy(toolName: string): ToolPolicy {
  const envName = toolEnvName(toolName);
  const allowlist = parseCsvEnv("TOOL_ALLOWLIST");
  const denylist = parseCsvEnv("TOOL_DENYLIST");
  const explicitlyEnabled = getBooleanEnv(`TOOL_${envName}_ENABLED`, true);
  const allowedByList = allowlist.size === 0 || allowlist.has(toolName);
  const deniedByList = denylist.has(toolName);

  return {
    enabled: explicitlyEnabled && allowedByList && !deniedByList,
    audit: getBooleanEnv("TOOL_AUDIT_ENABLED", true),
    timeoutMs: getIntEnv(
      `TOOL_${envName}_TIMEOUT_MS`,
      getIntEnv("TOOL_TIMEOUT_MS", DEFAULT_TOOL_TIMEOUT_MS, 1_000, 120_000),
      1_000,
      120_000
    ),
    maxInputChars: getIntEnv(
      `TOOL_${envName}_MAX_INPUT_CHARS`,
      getIntEnv("TOOL_MAX_INPUT_CHARS", DEFAULT_MAX_INPUT_CHARS, 1_000, 200_000),
      1_000,
      200_000
    ),
    maxOutputChars: getIntEnv(
      `TOOL_${envName}_MAX_OUTPUT_CHARS`,
      getIntEnv("TOOL_MAX_OUTPUT_CHARS", DEFAULT_MAX_OUTPUT_CHARS, 1_000, 200_000),
      1_000,
      200_000
    ),
  };
}

export function defaultToolPolicy(toolName = "tool"): ToolPolicy {
  return resolveToolPolicy(toolName);
}

async function auditToolEvent(
  eventName: string,
  policy: ToolPolicy,
  payload: Record<string, unknown>
): Promise<void> {
  if (!policy.audit) {
    return;
  }

  await auditLogger.record(eventName, payload);
}

function wrapToolWithGovernance(
  sourceTool: StructuredToolInterface,
  policy: ToolPolicy
): StructuredToolInterface {
  if (governedTools.has(sourceTool as object)) {
    return sourceTool;
  }

  const wrappedTool = Object.assign(
    Object.create(Object.getPrototypeOf(sourceTool)) as StructuredToolInterface,
    sourceTool
  );
  const governedInvoke = async (input: unknown, config?: unknown): Promise<unknown> => {
    const startedAt = Date.now();
    const inputChars = serializeForLimit(input).length;
    const commonAuditPayload = {
      toolName: sourceTool.name,
      inputChars,
      timeoutMs: policy.timeoutMs,
      maxOutputChars: policy.maxOutputChars,
    };

    if (inputChars > policy.maxInputChars) {
      await auditToolEvent("tool.blocked", policy, {
        ...commonAuditPayload,
        reason: "input_too_large",
        maxInputChars: policy.maxInputChars,
      });
      return `Error: ${sourceTool.name} blocked by tool governance - input exceeds ${policy.maxInputChars} characters.`;
    }

    await auditToolEvent("tool.invoke.start", policy, commonAuditPayload);

    try {
      const result = await withTimeout(
        sourceTool.invoke(input as never, config as never),
        policy.timeoutMs,
        sourceTool.name
      );
      const governedResult = truncateOutput(
        sourceTool.name,
        result,
        policy.maxOutputChars
      );
      const outputChars = serializeForLimit(governedResult).length;
      const durationMs = Date.now() - startedAt;

      await auditToolEvent("tool.invoke.success", policy, {
        ...commonAuditPayload,
        outputChars,
        durationMs,
      });
      await recordMetric("tool.invoke.duration_ms", {
        toolName: sourceTool.name,
        durationMs,
      });

      return governedResult;
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const errorMessage = error instanceof Error ? error.message : String(error);

      await auditToolEvent("tool.invoke.failure", policy, {
        ...commonAuditPayload,
        durationMs,
        error: errorMessage,
      });
      await recordMetric("tool.invoke.failure.count", {
        toolName: sourceTool.name,
        count: 1,
      });

      return `Error: ${sourceTool.name} failed by tool governance - ${errorMessage}`;
    }
  };

  wrappedTool.invoke = governedInvoke as StructuredToolInterface["invoke"];
  wrappedTool.call = governedInvoke as StructuredToolInterface["call"];

  governedTools.add(wrappedTool as object);
  return wrappedTool;
}

export function applyToolGovernance(
  tools: StructuredToolInterface[]
): StructuredToolInterface[] {
  return tools
    .map((tool) => ({ tool, policy: defaultToolPolicy(tool.name) }))
    .filter((entry) => entry.policy.enabled)
    .map((entry) => wrapToolWithGovernance(entry.tool, entry.policy));
}

export async function auditToolLoad(
  source: string,
  tools: StructuredToolInterface[]
): Promise<void> {
  await auditLogger.record("tool.load", {
    source,
    toolNames: tools.map((tool) => tool.name),
  });
  await recordMetric("tool.load.count", {
    source,
    count: tools.length,
  });
}
