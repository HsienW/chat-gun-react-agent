import { describe, expect, it } from "vitest";

import { classifyError } from "./error-classification.js";
import type { StepError } from "../types.js";

function createError(code: string): StepError {
  return { code, message: `Error: ${code}` };
}

describe("classifyError", () => {
  it.each([
    ["TIMEOUT", "timeout", true],
    ["ETIMEDOUT", "timeout", true],
    ["ABORT_ERR", "timeout", true],
    ["RATE_LIMITED", "rate_limit", true],
    ["UPSTREAM_ERROR", "server_error", true],
    ["SCHEMA_INVALID", "schema_invalid", false],
    ["PERMISSION_DENIED", "permission_denied", false],
    ["BUSINESS_REJECTED", "business_rejected", false],
    ["USER_CANCELLED", "user_cancelled", false],
  ] as const)("classifies %s as %s", (code, category, retryable) => {
    const error = createError(code);

    expect(classifyError(error)).toEqual({
      category,
      code,
      message: error.message,
      retryable,
      originalError: error,
    });
  });

  it.each([
    [403, "permission_denied", false],
    [422, "business_rejected", false],
    [429, "rate_limit", true],
    [500, "server_error", true],
    [503, "server_error", true],
    [400, "schema_invalid", false],
  ] as const)("classifies HTTP %i as %s", (statusCode, category, retryable) => {
    const error = createError("UPSTREAM_HTTP_ERROR");

    expect(classifyError(error, { statusCode })).toMatchObject({
      category,
      retryable,
      originalError: error,
    });
  });

  it("prefers a recognized code over a contradictory status code", () => {
    expect(
      classifyError(createError("PERMISSION_DENIED"), { statusCode: 500 })
    ).toMatchObject({ category: "permission_denied", retryable: false });
  });

  it("parses Retry-After integer seconds for rate limits", () => {
    expect(
      classifyError(createError("RATE_LIMITED"), {
        statusCode: 429,
        retryAfterHeader: "5",
      }).retryAfterMs
    ).toBe(5_000);
  });

  it.each([
    "Wed, 21 Oct 2015 07:28:00 GMT",
    "1.5",
    "-1",
    "invalid",
  ])("does not parse unsupported Retry-After value %s", (retryAfterHeader) => {
    expect(
      classifyError(createError("RATE_LIMITED"), {
        statusCode: 429,
        retryAfterHeader,
      }).retryAfterMs
    ).toBeUndefined();
  });

  it("falls back to unknown without throwing when no rule matches", () => {
    const error = createError("UNRECOGNIZED");

    expect(classifyError(error)).toEqual({
      category: "unknown",
      code: error.code,
      message: error.message,
      retryable: false,
      originalError: error,
    });
  });
});
