import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";

describe("LangChain tool cancellation compatibility", () => {
  it("resolves a pre-aborted invocation with the wrapped structured cancellation result", async () => {
    const cancelledResult = {
      status: "error",
      code: "weather_cancelled",
    } as const;
    const wrappedFunction = vi.fn(async (_input: Record<string, never>, config?: {
      signal?: AbortSignal;
    }) => {
      expect(config?.signal?.aborted).toBe(true);
      return cancelledResult;
    });
    const cancellableTool = tool(wrappedFunction, {
      name: "pre_aborted_cancellation_regression",
      description: "Verifies transparent handling of an already-aborted signal.",
      schema: z.object({}),
    });
    const controller = new AbortController();
    controller.abort(new Error("cancelled before invocation"));

    await expect(cancellableTool.invoke({}, { signal: controller.signal })).resolves.toEqual(
      cancelledResult,
    );
    expect(wrappedFunction).toHaveBeenCalledOnce();
  });
});
