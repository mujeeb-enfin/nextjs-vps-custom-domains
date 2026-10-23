/**
 * Shared Redis connection. Redis is required: the agent job queue, results
 * queue, status pub/sub, host cache and rate limits all live there, and there is
 * deliberately no in-memory substitute (it would break with several instances).
 */
import { Redis } from "ioredis";
import { getPlatformConfig } from "./env";
import { logger } from "./logger";

declare global {
  var __ncd_redis: Redis | undefined;
}

export function redis(): Redis {
  if (globalThis.__ncd_redis) return globalThis.__ncd_redis;
  const client = new Redis(getPlatformConfig().redisUrl, { maxRetriesPerRequest: 3 });
  client.on("error", (err) => logger.error("redis connection error", {}, err));
  globalThis.__ncd_redis = client;
  return client;
}

/** A dedicated connection for blocking commands (BLMOVE) and SUBSCRIBE. */
export function dedicatedRedis(purpose: string): Redis {
  const client = new Redis(getPlatformConfig().redisUrl, { maxRetriesPerRequest: null });
  client.on("error", (err) => logger.error("redis connection error", { purpose }, err));
  return client;
}

/** All keys this project writes share one prefix. */
export const KEYS = {
  jobs: "ncd:jobs",
  processing: "ncd:processing",
  results: "ncd:results",
  resultsProcessing: "ncd:results:processing",
  resultsDead: "ncd:results:dead",
  resultAttempts: (jobId: string) => `ncd:results:attempts:${jobId}`,
  events: "ncd:events",
  host: (hostname: string) => `ncd:host:${hostname}`,
  dnsCheck: (digest: string) => `ncd:dnscheck:${digest}`,
  rateLimit: (bucket: string, key: string, window: number) => `ncd:rl:${bucket}:${key}:${window}`,
} as const;
