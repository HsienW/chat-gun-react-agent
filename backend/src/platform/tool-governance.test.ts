import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { applyToolGovernance } from "./tool-governance.js";

function createEchoTool(output: string): StructuredToolInterface {
  return tool(
    async ({ value }: { value: string }) => `${value}:${output}`,
    {
      name: "contract_echo",
      description: "Echoes a validated string input.",
      schema: z.object({
        value: z.string(),
      }),
    }
  ) as StructuredToolInterface;
}

describe("applyToolGovernance", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns a safe governed error when tool input fails runtime schema validation", async () => {
    vi.stubEnv("TOOL_AUDIT_ENABLED", "false");

    const [governedTool] = applyToolGovernance([createEchoTool("ok")]);
    const result = await governedTool.invoke({ value: 123 });

    expect(result).toContain("Error: contract_echo failed by tool governance");
    expect(result).toContain("Received tool input did not match expected schema");
  });

  it("truncates oversized tool output at the governed boundary", async () => {
    vi.stubEnv("TOOL_AUDIT_ENABLED", "false");
    vi.stubEnv("TOOL_CONTRACT_ECHO_MAX_OUTPUT_CHARS", "1000");

    const [governedTool] = applyToolGovernance([createEchoTool("x".repeat(1200))]);
    const result = await governedTool.invoke({ value: "valid" });

    expect(result).toContain("[Tool output truncated by governance: contract_echo, 1000 characters]");
    expect(String(result).length).toBeLessThan(1200);
  });
});
