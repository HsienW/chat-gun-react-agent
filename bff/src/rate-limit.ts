type Bucket = {
  count: number;
  resetAt: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
};

export class InMemoryRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly windowMs: number,
    private readonly maxRequests: number
  ) {}

  check(key: string, now = Date.now()): RateLimitResult {
    const existing = this.buckets.get(key);
    const bucket =
      existing && existing.resetAt > now
        ? existing
        : { count: 0, resetAt: now + this.windowMs };

    bucket.count += 1;
    this.buckets.set(key, bucket);

    if (this.buckets.size > 10_000) {
      this.cleanup(now);
    }

    const remaining = Math.max(this.maxRequests - bucket.count, 0);
    return {
      allowed: bucket.count <= this.maxRequests,
      remaining,
      resetAt: bucket.resetAt,
    };
  }

  private cleanup(now: number): void {
    for (const [key, bucket] of this.buckets.entries()) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
      }
    }
  }
}
