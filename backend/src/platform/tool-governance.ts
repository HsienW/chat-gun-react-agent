import { StructuredToolInterface } from "@langchain/core/tools";

import { auditLogger, recordMetric } from "./observability.js";

export interface ToolPolicy {
  enabled: boolean;
  audit: boolean;
  rateLimitKey?: string;
  grayReleaseKey?: string;
  circuitBreakerKey?: string;
}

export interface GovernedTool {
  tool: StructuredToolInterface;
  policy: ToolPolicy;
}

export function defaultToolPolicy(): ToolPolicy {
  return {
    enabled: true,
    audit: true,
  };
}

export function applyToolGovernance(
  tools: StructuredToolInterface[]
): StructuredToolInterface[] {
  return tools
    .map((tool) => ({ tool, policy: defaultToolPolicy() }))
    .filter((entry) => entry.policy.enabled)
    .map((entry) => entry.tool);
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
