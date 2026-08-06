import { afterEach, describe, expect, it, vi } from "vitest";

import { loadConfig } from "./config.js";

const RATE_LIMIT_ENV_NAMES = [
  "BFF_RATE_LIMIT_REDIS_URI",
  "BFF_RATE_LIMIT_USER_MAX_REQUESTS",
  "BFF_RATE_LIMIT_USER_WINDOW_MS",
  "BFF_RATE_LIMIT_IP_MAX_REQUESTS",
  "BFF_RATE_LIMIT_IP_WINDOW_MS",
] as const;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Redis rate limit configuration", () => {
  it("loads the Redis URI and independent user/IP limits", () => {
    vi.stubEnv("BFF_RATE_LIMIT_REDIS_URI", "redis://localhost:6379");
    vi.stubEnv("BFF_RATE_LIMIT_USER_MAX_REQUESTS", "30");
    vi.stubEnv("BFF_RATE_LIMIT_USER_WINDOW_MS", "60000");
    vi.stubEnv("BFF_RATE_LIMIT_IP_MAX_REQUESTS", "20");
    vi.stubEnv("BFF_RATE_LIMIT_IP_WINDOW_MS", "45000");

    expect(loadConfig()).toMatchObject({
      redisRateLimitUri: "redis://localhost:6379",
      rateLimitUserMaxRequests: 30,
      rateLimitUserWindowMs: 60_000,
      rateLimitIpMaxRequests: 20,
      rateLimitIpWindowMs: 45_000,
    });
  });

  it("uses safe defaults when optional values are absent or invalid", () => {
    for (const name of RATE_LIMIT_ENV_NAMES) {
      vi.stubEnv(name, "");
    }
    vi.stubEnv("BFF_RATE_LIMIT_USER_MAX_REQUESTS", "invalid");
    vi.stubEnv("BFF_RATE_LIMIT_IP_WINDOW_MS", "-1");

    expect(loadConfig()).toMatchObject({
      redisRateLimitUri: undefined,
      rateLimitUserMaxRequests: 30,
      rateLimitUserWindowMs: 60_000,
      rateLimitIpMaxRequests: 20,
      rateLimitIpWindowMs: 60_000,
    });
  });
});
