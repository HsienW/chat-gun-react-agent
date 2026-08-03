import { afterEach, describe, expect, it, vi } from "vitest";

const redisTestState = vi.hoisted(() => {
  class RedisMock {
    readonly quit = vi.fn(async () => "OK");

    constructor(
      readonly uri: string,
      readonly options: Record<string, unknown>
    ) {
      redisTestState.instances.push(this);
    }
  }

  return {
    instances: [] as RedisMock[],
    RedisMock,
  };
});

vi.mock("ioredis", () => ({
  default: redisTestState.RedisMock,
  Redis: redisTestState.RedisMock,
}));

const originalRedisUri = process.env.BFF_RATE_LIMIT_REDIS_URI;
const originalRedisKeyPrefix = process.env.REDIS_KEY_PREFIX;

function restoreEnvironmentVariable(
  name: "BFF_RATE_LIMIT_REDIS_URI" | "REDIS_KEY_PREFIX",
  originalValue: string | undefined
): void {
  if (originalValue === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = originalValue;
}

afterEach(() => {
  restoreEnvironmentVariable("BFF_RATE_LIMIT_REDIS_URI", originalRedisUri);
  restoreEnvironmentVariable("REDIS_KEY_PREFIX", originalRedisKeyPrefix);
  redisTestState.instances.length = 0;
  vi.resetModules();
});

describe("BFF Redis client lifecycle", () => {
  it("returns null when BFF_RATE_LIMIT_REDIS_URI is not configured", async () => {
    process.env.BFF_RATE_LIMIT_REDIS_URI = "";
    const { getRedis, isRedisAvailable } = await import("./redis-client.js");

    expect(getRedis()).toBeNull();
    expect(isRedisAvailable()).toBe(false);
    expect(redisTestState.instances).toHaveLength(0);
  });

  it("creates one lazy Redis client when the URI is configured", async () => {
    process.env.BFF_RATE_LIMIT_REDIS_URI = "redis://localhost:6379";
    const { getRedis, isRedisAvailable } = await import("./redis-client.js");

    const firstClient = getRedis();
    const secondClient = getRedis();

    expect(firstClient).toBe(secondClient);
    expect(isRedisAvailable()).toBe(true);
    expect(redisTestState.instances).toHaveLength(1);
    expect(redisTestState.instances[0]).toMatchObject({
      uri: "redis://localhost:6379",
      options: {
        connectTimeout: 3_000,
        lazyConnect: true,
        maxRetriesPerRequest: 2,
      },
    });
  });

  it("closes the initialized Redis client once", async () => {
    process.env.BFF_RATE_LIMIT_REDIS_URI = "redis://localhost:6379";
    const { closeRedis, getRedis, isRedisAvailable } = await import(
      "./redis-client.js"
    );
    const client = getRedis();

    await closeRedis();
    await closeRedis();

    expect(client?.quit).toHaveBeenCalledOnce();
    expect(isRedisAvailable()).toBe(false);
  });

  it("builds an unprefixed rate limit key by default", async () => {
    process.env.REDIS_KEY_PREFIX = "";
    const { buildRateLimitKey } = await import("./redis-client.js");

    expect(buildRateLimitKey("user", "alice")).toBe("rate_limit:user:alice");
  });

  it("includes REDIS_KEY_PREFIX in rate limit keys", async () => {
    process.env.REDIS_KEY_PREFIX = "staging:";
    const { buildRateLimitKey } = await import("./redis-client.js");

    expect(buildRateLimitKey("ip", "203.0.113.5")).toBe(
      "staging:rate_limit:ip:203.0.113.5"
    );
  });
});
