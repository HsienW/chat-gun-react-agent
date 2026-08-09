import { z } from "zod";
import { describe, expect, it } from "vitest";

import { classifyProviderError } from "./provider-error-category.js";

describe("classifyProviderError", () => {
  it.each([
    [{ statusCode: 502 }, "provider_unavailable"],
    [{ statusCode: 429 }, "provider_rate_limited"],
    [{ name: "AbortError" }, "provider_timeout"],
    [{ name: "ProviderResponseParseError" }, "provider_response_invalid"],
    [{ code: "content_filter_refusal" }, "content_filter_refusal"],
  ] as const)("classifies structured provider errors", (error, category) => {
    expect(classifyProviderError(error)).toBe(category);
  });

  it("classifies Zod validation errors", () => {
    const result = z.object({ answer: z.string() }).safeParse({ answer: 42 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(classifyProviderError(result.error)).toBe(
        "structured_output_invalid"
      );
    }
  });

  it("uses unknown_error for unstructured failures", () => {
    expect(classifyProviderError(new Error("opaque failure"))).toBe(
      "unknown_error"
    );
  });
});
