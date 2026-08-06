import { buildRateLimitKey } from "./redis-client.js";
import { InMemoryRateLimiter } from "./rate-limit.js";

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number | null;
};

export type RateLimitDimension = {
  name: string;
  windowMs: number;
  maxRequests: number;
  extractKey: () => string | undefined;
};

export interface RateLimiter {
  check(dimension: RateLimitDimension, now?: number): Promise<RateLimitResult>;
}

export interface RedisEvalClient {
  eval(
    script: string,
    numberOfKeys: number,
    ...args: Array<string | number>
  ): Promise<unknown>;
}

export const TOKEN_BUCKET_LUA_SCRIPT = `
local bucketRaw = redis.call('GET', KEYS[1])
local maxRequests = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local tokens = maxRequests
local lastRefillMs = now

if bucketRaw then
  local ok, decoded = pcall(cjson.decode, bucketRaw)
  if ok and type(decoded) == 'table' then
    local decodedTokens = tonumber(decoded.tokens)
    local decodedLastRefillMs = tonumber(decoded.lastRefillMs)
    if decodedTokens and decodedLastRefillMs then
      local elapsed = math.max(0, now - decodedLastRefillMs)
      tokens = math.min(maxRequests, decodedTokens + elapsed * (maxRequests / windowMs))
    end
  end
end

local refillRate = maxRequests / windowMs
local allowed = 0
local resetAt = 0

if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
else
  resetAt = now + math.ceil((1 - tokens) / refillRate)
end

redis.call('SET', KEYS[1], cjson.encode({tokens = tokens, lastRefillMs = lastRefillMs}), 'PX', windowMs * 2)
return {allowed, math.floor(tokens), resetAt}
`;

function parseRedisResult(value: unknown): RateLimitResult {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error("Invalid Redis rate limit response");
  }

  const allowedValue = Number(value[0]);
  const remaining = Number(value[1]);
  const resetAtValue = Number(value[2]);
  if (
    (allowedValue !== 0 && allowedValue !== 1) ||
    !Number.isFinite(remaining) ||
    remaining < 0 ||
    !Number.isFinite(resetAtValue) ||
    resetAtValue < 0
  ) {
    throw new Error("Invalid Redis rate limit response");
  }

  const allowed = allowedValue === 1;
  if (!allowed && resetAtValue === 0) {
    throw new Error("Invalid Redis rate limit reset timestamp");
  }

  return {
    allowed,
    remaining: Math.floor(remaining),
    resetAt: allowed ? null : resetAtValue,
  };
}

export class InMemoryRateLimiterWrapper implements RateLimiter {
  private readonly limiters = new Map<string, InMemoryRateLimiter>();

  async check(
    dimension: RateLimitDimension,
    now = Date.now()
  ): Promise<RateLimitResult> {
    const extractedKey = dimension.extractKey()?.trim();
    if (!extractedKey) {
      return {
        allowed: true,
        remaining: dimension.maxRequests,
        resetAt: null,
      };
    }

    const limiterKey = [
      dimension.name,
      dimension.windowMs,
      dimension.maxRequests,
    ].join(":");
    let limiter = this.limiters.get(limiterKey);
    if (!limiter) {
      limiter = new InMemoryRateLimiter(
        dimension.windowMs,
        dimension.maxRequests
      );
      this.limiters.set(limiterKey, limiter);
    }

    const result = limiter.check(extractedKey, now);
    return {
      allowed: result.allowed,
      remaining: result.remaining,
      resetAt: result.allowed ? null : result.resetAt,
    };
  }
}

export class RedisRateLimiter implements RateLimiter {
  constructor(
    private readonly redisClient: RedisEvalClient,
    private readonly fallback: RateLimiter
  ) {}

  async acquire(
    key: string,
    windowMs: number,
    maxRequests: number,
    now = Date.now()
  ): Promise<RateLimitResult> {
    const result = await this.redisClient.eval(
      TOKEN_BUCKET_LUA_SCRIPT,
      1,
      key,
      maxRequests,
      windowMs,
      now
    );
    return parseRedisResult(result);
  }

  async check(
    dimension: RateLimitDimension,
    now = Date.now()
  ): Promise<RateLimitResult> {
    const extractedKey = dimension.extractKey()?.trim();
    if (!extractedKey) {
      return {
        allowed: true,
        remaining: dimension.maxRequests,
        resetAt: null,
      };
    }

    try {
      return await this.acquire(
        buildRateLimitKey(dimension.name, extractedKey),
        dimension.windowMs,
        dimension.maxRequests,
        now
      );
    } catch (error) {
      console.warn(
        JSON.stringify({
          event: "bff_rate_limit_redis_fallback",
          dimension: dimension.name,
          errorName: error instanceof Error ? error.name : "UnknownError",
        })
      );
      return this.fallback.check(dimension, now);
    }
  }
}
