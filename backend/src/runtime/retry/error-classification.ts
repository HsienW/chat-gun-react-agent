import type { StepError } from "../types.js";

export type ErrorCategory =
  | "timeout"
  | "rate_limit"
  | "server_error"
  | "schema_invalid"
  | "permission_denied"
  | "business_rejected"
  | "user_cancelled"
  | "unknown";

export interface ClassifiedError {
  category: ErrorCategory;
  code: string;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
  originalError: StepError;
}

export interface ErrorClassificationContext {
  statusCode?: number;
  retryAfterHeader?: string;
}

interface Classification {
  category: ErrorCategory;
  retryable: boolean;
}

function classifyByCode(code: string): Classification | undefined {
  switch (code) {
    case "USER_CANCELLED":
      return { category: "user_cancelled", retryable: false };
    case "PERMISSION_DENIED":
      return { category: "permission_denied", retryable: false };
    case "BUSINESS_REJECTED":
      return { category: "business_rejected", retryable: false };
    case "RATE_LIMITED":
      return { category: "rate_limit", retryable: true };
    case "TIMEOUT":
    case "ETIMEDOUT":
    case "ABORT_ERR":
      return { category: "timeout", retryable: true };
    case "UPSTREAM_ERROR":
      return { category: "server_error", retryable: true };
    case "SCHEMA_INVALID":
      return { category: "schema_invalid", retryable: false };
    default:
      return undefined;
  }
}

function classifyByStatusCode(statusCode: number | undefined): Classification | undefined {
  if (statusCode === 403) {
    return { category: "permission_denied", retryable: false };
  }
  if (statusCode === 422) {
    return { category: "business_rejected", retryable: false };
  }
  if (statusCode === 429) {
    return { category: "rate_limit", retryable: true };
  }
  if (statusCode !== undefined && statusCode >= 500 && statusCode <= 599) {
    return { category: "server_error", retryable: true };
  }
  if (statusCode === 400) {
    return { category: "schema_invalid", retryable: false };
  }
  return undefined;
}

function parseRetryAfterMs(retryAfterHeader: string | undefined): number | undefined {
  if (retryAfterHeader === undefined || !/^\d+$/.test(retryAfterHeader)) {
    return undefined;
  }

  const seconds = Number(retryAfterHeader);
  const milliseconds = seconds * 1_000;
  return Number.isSafeInteger(milliseconds) ? milliseconds : undefined;
}

export function classifyError(
  error: StepError,
  context: ErrorClassificationContext = {}
): ClassifiedError {
  const classification = classifyByCode(error.code) ??
    classifyByStatusCode(context.statusCode) ?? {
      category: "unknown" as const,
      retryable: false,
    };
  const retryAfterMs =
    classification.category === "rate_limit"
      ? parseRetryAfterMs(context.retryAfterHeader)
      : undefined;

  return {
    ...classification,
    code: error.code,
    message: error.message,
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    originalError: error,
  };
}
