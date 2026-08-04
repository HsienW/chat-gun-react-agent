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

const originalRedisUri = process.env.REDIS_URI;
const originalRedisKeyPrefix = process.env.REDIS_KEY_PREFIX;

function restoreEnvironmentVariable(
  name: "REDIS_URI" | "REDIS_KEY_PREFIX",
  originalValue: string | undefined
): void {
  if (originalValue === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = originalValue;
}

afterEach(() => {
  restoreEnvironmentVariable("REDIS_URI", originalRedisUri);
  restoreEnvironmentVariable("REDIS_KEY_PREFIX", originalRedisKeyPrefix);
  redisTestState.instances.length = 0;
  vi.resetModules();
});

describe("Redis client lifecycle", () => {
  it("returns null when REDIS_URI is not configured", async () => {
    process.env.REDIS_URI = "";
    const { getRedis, isRedisAvailable } = await import("./redis-client.js");

    expect(getRedis()).toBeNull();
    expect(isRedisAvailable()).toBe(false);
    expect(redisTestState.instances).toHaveLength(0);
  });

  it("creates one lazy Redis client when REDIS_URI is configured", async () => {
    process.env.REDIS_URI = "redis://localhost:6379";
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
    process.env.REDIS_URI = "redis://localhost:6379";
    const { closeRedis, getRedis, isRedisAvailable } = await import(
      "./redis-client.js"
    );
    const client = getRedis();

    await closeRedis();
    await closeRedis();

    expect(client?.quit).toHaveBeenCalledOnce();
    expect(isRedisAvailable()).toBe(false);
  });

  it("creates an unprefixed step lock key by default", async () => {
    process.env.REDIS_KEY_PREFIX = "";
    const { createStepLockKey } = await import("./redis-client.js");

    expect(createStepLockKey("step-1")).toBe("step_lock:step-1");
  });

  it("includes REDIS_KEY_PREFIX in step lock keys", async () => {
    process.env.REDIS_KEY_PREFIX = "staging:";
    const { createStepLockKey } = await import("./redis-client.js");

    expect(createStepLockKey("step-1")).toBe("staging:step_lock:step-1");
  });
});
