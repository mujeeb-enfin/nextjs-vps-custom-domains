/**
 * Job queue to the host agent (agent/).
 *
 * Reliable-queue pattern: the app LPUSHes JSON jobs onto `ncd:jobs`; the agent
 * blocks on BLMOVE into `ncd:processing`, so a crashed agent recovers in-flight
 * jobs on restart. No polling on either side.
 */
import { randomUUID } from "node:crypto";
import { redis, KEYS } from "@/lib/redis";
import { logger } from "@/lib/logger";
import type { DomainJob, QueuedDomainJob } from "./types";

export async function enqueueDomainJob(job: DomainJob): Promise<string> {
  const queued: QueuedDomainJob = { jobId: randomUUID(), enqueuedAt: new Date().toISOString(), job };
  await redis().lpush(KEYS.jobs, JSON.stringify(queued));
  logger.info("custom domain job queued", { jobId: queued.jobId, type: job.type, domainId: job.domainId, hostname: job.hostname });
  return queued.jobId;
}
