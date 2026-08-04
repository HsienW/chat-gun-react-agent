import { Redis } from "ioredis";

import { getEnv } from "../../platform/env.js";

const REDIS_URI_ENV = "REDIS_URI";
const REDIS_KEY_PREFIX_ENV = "REDIS_KEY_PREFIX";
const REDIS_CONNECT_TIMEOUT_MS = 3_000;
const REDIS_MAX_RETRIES_PER_REQUEST = 2;

let redisClient: Redis | null | undefined;

export function getRedis(): Redis | null {
  if (redisClient !== undefined) {
    return redisClient;
  }

  const redisUri = getEnv(REDIS_URI_ENV);
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

export function createStepLockKey(stepId: string): string {
  const redisKeyPrefix = getEnv(REDIS_KEY_PREFIX_ENV);
  return `${redisKeyPrefix}step_lock:${stepId}`;
}

export async function closeRedis(): Promise<void> {
  const clientToClose = redisClient;
  redisClient = null;

  if (clientToClose) {
    await clientToClose.quit();
  }
}
