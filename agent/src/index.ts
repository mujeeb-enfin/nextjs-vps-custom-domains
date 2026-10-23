/**
 * ncd-agent — consumes provisioning jobs from Redis and reports results.
 *
 *   app ── LPUSH ncd:jobs ──▶ agent (BLMOVE → ncd:processing) ──▶ nginx / certbot
 *   agent ── LPUSH ncd:results ──▶ app applies the transition in the DB
 *
 * Blocking reads only (no polling). One job at a time, so nginx reloads are
 * serialised. Jobs left in `processing` by a crash are re-queued on start.
 */
import { Redis } from "ioredis";
import { loadConfig } from "./config.js";
import { initLog, log } from "./log.js";
import { handle, type QueuedJob, type Result } from "./handlers.js";

const JOBS = "ncd:jobs";
const PROCESSING = "ncd:processing";
const RESULTS = "ncd:results";

function parseJob(raw: string): QueuedJob | null {
  try {
    const q = JSON.parse(raw) as QueuedJob;
    const j = q?.job;
    if (typeof q.jobId !== "string" || !j || typeof j.domainId !== "string" || typeof j.hostname !== "string") return null;
    if (j.type === "provision" && typeof j.autoSsl === "boolean") return q;
    if (j.type === "teardown") return q;
    return null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  initLog(cfg.logFile);
  const redis = new Redis(cfg.redisUrl, { maxRetriesPerRequest: null, enableOfflineQueue: true });
  redis.on("error", (err) => log.error("redis connection error", {}, err));

  let requeued = 0;
  while (await redis.lmove(PROCESSING, JOBS, "RIGHT", "LEFT")) requeued++;
  log.info("domain agent started", { staging: cfg.acmeStaging, requeued });

  let stopping = false;
  const stop = (signal: string) => {
    stopping = true;
    log.info("domain agent stopping", { signal });
    // The blocking BLMOVE is interrupted by closing the connection; an in-flight
    // job stays in `processing` and is re-queued on next start.
    redis.disconnect();
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));

  while (!stopping) {
    let raw: string | null;
    try {
      raw = await redis.blmove(JOBS, PROCESSING, "RIGHT", "LEFT", 0);
    } catch (err) {
      if (stopping) break;
      throw err;
    }
    if (!raw) continue;

    const job = parseJob(raw);
    if (!job) {
      log.error("malformed job dropped", { raw: raw.slice(0, 300) });
      await redis.lrem(PROCESSING, 1, raw);
      continue;
    }

    const started = Date.now();
    let result: Result;
    try {
      result = await handle(cfg, job);
    } catch (err) {
      // Unexpected failure (nginx -t, reload, filesystem). Report it — never hide it.
      log.error("job failed", { jobId: job.jobId, type: job.job.type, hostname: job.job.hostname }, err);
      const error = err instanceof Error ? err.message : String(err);
      result = job.job.type === "provision"
        ? { jobId: job.jobId, type: "provision", domainId: job.job.domainId, hostname: job.job.hostname, ok: false, autoSsl: job.job.autoSsl, error }
        : { jobId: job.jobId, type: "teardown", domainId: job.job.domainId, hostname: job.job.hostname, ok: false, error };
    }

    // Report first, then acknowledge — a crash in between re-runs an idempotent job.
    await redis.lpush(RESULTS, JSON.stringify(result));
    await redis.lrem(PROCESSING, 1, raw);
    log.info("job completed", { jobId: job.jobId, type: job.job.type, hostname: job.job.hostname, ok: result.ok, ms: Date.now() - started });
  }
}

main().catch((err) => {
  log.error("domain agent crashed", {}, err);
  process.exit(1);
});
