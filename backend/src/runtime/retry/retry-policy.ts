import type { BackoffStrategy } from "./backoff.js";
import type { ErrorCategory } from "./error-classification.js";

export interface RetryPolicy {
  maxAttempts: number;
  maxElapsedMs: number;
  retryableCategories: ErrorCategory[];
  backoffStrategy: BackoffStrategy;
  jitter: boolean;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  maxElapsedMs: 60_000,
  retryableCategories: ["timeout", "rate_limit", "server_error"],
  backoffStrategy: "exponential",
  jitter: true,
};
