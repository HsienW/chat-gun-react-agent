import { describe, expect, it, vi } from "vitest";

import {
  InMemoryRateLimiterWrapper,
  RedisRateLimiter,
  TOKEN_BUCKET_LUA_SCRIPT,
  type RateLimitDimension,
} from "./redis-rate-limit.js";

type Bucket = {
  tokens: number;
  lastRefillMs: number;
};

class TokenBucketRedisFake {
  readonly calls: Array<{
    script: string;
    key: string;
    maxRequests: number;
    windowMs: number;
    now: number;
  }> = [];
  private readonly buckets = new Map<string, Bucket>();

  async eval(
    script: string,
    numberOfKeys: number,
    ...args: Array<string | number>
  ): Promise<unknown> {
    expect(numberOfKeys).toBe(1);
    const [keyValue, maxRequestsValue, windowMsValue, nowValue] = args;
    const key = String(keyValue);
    const maxRequests = Number(maxRequestsValue);
    const windowMs = Number(windowMsValue);
    const now = Number(nowValue);
    this.calls.push({ script, key, maxRequests, windowMs, now });

    const existing = this.buckets.get(key);
    const elapsed = existing ? Math.max(0, now - existing.lastRefillMs) : 0;
    let tokens = existing
      ? Math.min(maxRequests, existing.tokens + elapsed * (maxRequests / windowMs))
      : maxRequests;
    let allowed = 0;
    let resetAt = 0;

    if (tokens >= 1) {
      tokens -= 1;
      allowed = 1;
    } else {
      resetAt = now + Math.ceil((1 - tokens) / (maxRequests / windowMs));
    }

    this.buckets.set(key, { tokens, lastRefillMs: now });
    return [allowed, Math.floor(tokens), resetAt];
  }
}

function createDimension(
  key: string | undefined,
  options: { name?: string; maxRequests?: number; windowMs?: number } = {}
): RateLimitDimension {
  return {
    name: options.name ?? "user",
    maxRequests: options.maxRequests ?? 4,
    windowMs: options.windowMs ?? 1_000,
    extractKey: () => key,
  };
}

describe("RedisRateLimiter", () => {
  it("allows the first request and returns maxRequests minus one", async () => {
    const redis = new TokenBucketRedisFake();
    const limiter = new RedisRateLimiter(
      redis,
      new InMemoryRateLimiterWrapper()
    );

    const result = await limiter.check(createDimension("alice"), 1_000);

    expect(result).toEqual({ allowed: true, remaining: 3, resetAt: null });
  });

  it("denies a request after the bucket is exhausted", async () => {
    const redis = new TokenBucketRedisFake();
    const limiter = new RedisRateLimiter(
      redis,
      new InMemoryRateLimiterWrapper()
    );
    const dimension = createDimension("alice");

    for (let request = 0; request < 4; request += 1) {
      expect((await limiter.check(dimension, 1_000)).allowed).toBe(true);
    }

    expect(await limiter.check(dimension, 1_000)).toEqual({
      allowed: false,
      remaining: 0,
      resetAt: 1_250,
    });
  });

  it("partially refills tokens after half a window", async () => {
    const redis = new TokenBucketRedisFake();
    const limiter = new RedisRateLimiter(
      redis,
      new InMemoryRateLimiterWrapper()
    );
    const dimension = createDimension("alice");

    for (let request = 0; request < 4; request += 1) {
      await limiter.check(dimension, 1_000);
    }

    expect(await limiter.check(dimension, 1_500)).toEqual({
      allowed: true,
      remaining: 1,
      resetAt: null,
    });
  });

  it("refills the bucket completely after a full window", async () => {
    const redis = new TokenBucketRedisFake();
    const limiter = new RedisRateLimiter(
      redis,
      new InMemoryRateLimiterWrapper()
    );
    const dimension = createDimension("alice");

    for (let request = 0; request < 4; request += 1) {
      await limiter.check(dimension, 1_000);
    }

    expect(await limiter.check(dimension, 2_000)).toEqual({
      allowed: true,
      remaining: 3,
      resetAt: null,
    });
  });

  it("counts different keys independently", async () => {
    const redis = new TokenBucketRedisFake();
    const limiter = new RedisRateLimiter(
      redis,
      new InMemoryRateLimiterWrapper()
    );

    expect((await limiter.check(createDimension("alice"), 1_000)).remaining).toBe(3);
    expect((await limiter.check(createDimension("bob"), 1_000)).remaining).toBe(3);
  });

  it("falls back to independent in-memory dimension keys on Redis errors", async () => {
    const redis = {
      eval: vi.fn(async () => {
        throw new Error("Redis unavailable");
      }),
    };
    const limiter = new RedisRateLimiter(
      redis,
      new InMemoryRateLimiterWrapper()
    );

    const alice = createDimension("alice", { maxRequests: 1 });
    const bob = createDimension("bob", { maxRequests: 1 });

    expect((await limiter.check(alice, 1_000)).allowed).toBe(true);
    expect((await limiter.check(alice, 1_000)).allowed).toBe(false);
    expect((await limiter.check(bob, 1_000)).allowed).toBe(true);
  });

  it("uses each dimension's limits when Redis falls back to memory", async () => {
    const redis = {
      eval: vi.fn(async () => {
        throw new Error("Redis unavailable");
      }),
    };
    const limiter = new RedisRateLimiter(
      redis,
      new InMemoryRateLimiterWrapper()
    );
    const dimension = createDimension("alice", {
      maxRequests: 2,
      windowMs: 1_000,
    });

    expect((await limiter.check(dimension, 1_000)).allowed).toBe(true);
    expect((await limiter.check(dimension, 1_000)).allowed).toBe(true);
    expect((await limiter.check(dimension, 1_000)).allowed).toBe(false);
  });

  it("falls back when Redis returns an invalid response", async () => {
    const redis = { eval: vi.fn(async () => ["invalid"]) };
    const limiter = new RedisRateLimiter(
      redis,
      new InMemoryRateLimiterWrapper()
    );

    const dimension = createDimension("alice", { maxRequests: 1 });

    expect((await limiter.check(dimension, 1_000)).allowed).toBe(true);
    expect((await limiter.check(dimension, 1_000)).allowed).toBe(false);
  });

  it("uses a TTL of twice the window in the atomic Lua script", async () => {
    const redis = new TokenBucketRedisFake();
    const limiter = new RedisRateLimiter(
      redis,
      new InMemoryRateLimiterWrapper()
    );

    await limiter.check(createDimension("alice", { windowMs: 2_000 }), 1_000);

    expect(redis.calls[0]?.script).toBe(TOKEN_BUCKET_LUA_SCRIPT);
    expect(TOKEN_BUCKET_LUA_SCRIPT).toContain("'PX', windowMs * 2");
  });

  it("skips dimensions without a key", async () => {
    const redis = new TokenBucketRedisFake();
    const limiter = new RedisRateLimiter(
      redis,
      new InMemoryRateLimiterWrapper()
    );

    expect(await limiter.check(createDimension(undefined), 1_000)).toEqual({
      allowed: true,
      remaining: 4,
      resetAt: null,
    });
    expect(redis.calls).toHaveLength(0);
  });
});
