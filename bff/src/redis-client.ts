import { Redis } from "ioredis";

const REDIS_URI_ENV = "BFF_RATE_LIMIT_REDIS_URI";
const REDIS_KEY_PREFIX_ENV = "REDIS_KEY_PREFIX";
const REDIS_CONNECT_TIMEOUT_MS = 3_000;
const REDIS_MAX_RETRIES_PER_REQUEST = 2;

let redisClient: Redis | null | undefined;

export function getRedis(): Redis | null {
  if (redisClient !== undefined) {
    return redisClient;
  }

  const redisUri = process.env[REDIS_URI_ENV]?.trim();
  if (!redisUri) {
    redisClient = null;
    return redisClient;
  }

  redisClient = new Redis(redisUri, {
    connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
    lazyConnect: true,
    maxRetriesPerRequest: REDIS_MAX_RETRIES_PER_REQUEST,
  });
  return redisClient;
}

export function isRedisAvailable(): boolean {
  return getRedis() !== null;
}

export function buildRateLimitKey(dimension: string, value: string): string {
  const redisKeyPrefix = process.env[REDIS_KEY_PREFIX_ENV]?.trim() ?? "";
  return `${redisKeyPrefix}rate_limit:${dimension}:${value}`;
}

export async function closeRedis(): Promise<void> {
  const clientToClose = redisClient;
  redisClient = null;

  if (clientToClose) {
    await clientToClose.quit();
  }
}
