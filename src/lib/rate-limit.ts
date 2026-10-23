/** Fixed-window rate limiter in Redis (multi-instance safe, no timers). */
import { redis, KEYS } from "./redis";

export interface Limit {
  windowMs: number;
  max: number;
}

export interface LimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

export async function checkRateLimit(bucket: string, key: string, limit: Limit): Promise<LimitResult> {
  const now = Date.now();
  const window = Math.floor(now / limit.windowMs);
  const k = KEYS.rateLimit(bucket, key, window);
  const [[incrErr, count], [expErr]] = (await redis().multi().incr(k).pexpire(k, limit.windowMs).exec()) ?? [];
  if (incrErr) throw incrErr;
  if (expErr) throw expErr;
  return { allowed: Number(count) <= limit.max, retryAfterMs: (window + 1) * limit.windowMs - now };
}
