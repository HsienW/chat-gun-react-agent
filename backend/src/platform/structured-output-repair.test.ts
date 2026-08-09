import { z } from "zod";
import { AIMessage } from "@langchain/core/messages";
import { describe, expect, it, vi } from "vitest";

import { repairStructuredOutput } from "./structured-output-repair.js";

const schema = z.object({
  name: z.string(),
  count: z.number(),
});

const observer = { recordMetric: vi.fn(async () => undefined) };

describe("repairStructuredOutput", () => {
  it("parses structured JSON from a LangChain message", async () => {
    const result = await repairStructuredOutput({
      invoke: async () => new AIMessage('{"name":"direct","count":1}'),
      schema,
      strategy: "none",
      observer,
    });

    expect(result).toMatchObject({
      output: { name: "direct", count: 1 },
      status: "success",
      attempts: 1,
    });
  });

  it("repairs a parse failure with the original error as a hint", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce('{"name":')
      .mockResolvedValueOnce('{"name":"fixed","count":2}');

    const result = await repairStructuredOutput({
      invoke,
      schema,
      strategy: "retry_with_hint",
      observer,
    });

    expect(result).toMatchObject({
      output: { name: "fixed", count: 2 },
      partial: null,
      status: "repaired",
      attempts: 2,
    });
    expect(invoke.mock.calls[1][0]).toMatch(/parse/i);
  });

  it("returns validated top-level fields when validation repair is exhausted", async () => {
    const invoke = vi.fn(async () => ({ name: "valid", count: "invalid" }));

    const result = await repairStructuredOutput({
      invoke,
      schema,
      strategy: "retry_with_hint",
      observer,
    });

    expect(result).toMatchObject({
      output: null,
      partial: { name: "valid" },
      status: "partial",
      attempts: 2,
    });
    expect(result.lastError).toContain("count");
  });

  it("returns refusal without retrying", async () => {
    const invoke = vi.fn(async () => ({
      refusal: true,
      code: "content_filter_refusal",
    }));

    const result = await repairStructuredOutput({
      invoke,
      schema,
      strategy: "retry_with_hint",
      observer,
    });

    expect(result).toEqual({
      output: null,
      partial: null,
      status: "refusal",
      attempts: 1,
    });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("does not retry when the repair strategy is none", async () => {
    const invoke = vi.fn(async () => "not-json");

    const result = await repairStructuredOutput({
      invoke,
      schema,
      strategy: "none",
      observer,
    });

    expect(result).toMatchObject({
      output: null,
      partial: null,
      status: "exhausted",
      attempts: 1,
    });
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
