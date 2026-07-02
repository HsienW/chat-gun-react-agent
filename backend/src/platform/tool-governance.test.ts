import type { RunnableConfig } from "@langchain/core/runnables";
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
    vi.useRealTimers();
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

  it("aborts the underlying operation and marks governance timeouts with a stable prefix", async () => {
    vi.useFakeTimers();
    vi.stubEnv("TOOL_AUDIT_ENABLED", "false");
    vi.stubEnv("TOOL_CONTRACT_WAIT_TIMEOUT_MS", "1000");
    let receivedAbort = false;
    const waitingTool = tool(
      async (_input: { value: string }, config?: RunnableConfig) => {
        const configurable = config?.configurable as
          | { abortSignal?: AbortSignal }
          | undefined;
        const signal = configurable?.abortSignal ?? config?.signal;

        return await new Promise<string>((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => {
              receivedAbort = true;
              reject(signal.reason);
            },
            { once: true }
          );
        });
      },
      {
        name: "contract_wait",
        description: "Waits until the governed deadline aborts the operation.",
        schema: z.object({ value: z.string() }),
      }
    ) as StructuredToolInterface;

    const [governedTool] = applyToolGovernance([waitingTool]);
    const resultPromise = governedTool.invoke({ value: "valid" });
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await resultPromise;

    expect(receivedAbort).toBe(true);
    expect(result).toContain("[governance_timeout]");
  });
});
