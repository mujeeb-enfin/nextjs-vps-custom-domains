/**
 * Applies results reported by the host agent.
 *
 * The agent has no database access. It reports each job outcome on a Redis
 * list (`ncd:results`, reliable queue). This module runs inside the app,
 * checks each result against the current DB state and performs the
 * transition, audit and status push. Results that no longer match the domain's
 * state (e.g. it was removed meanwhile) are logged and dropped.
 */
import { db } from "@/lib/db";
import { dedicatedRedis, KEYS } from "@/lib/redis";
import { logger } from "@/lib/logger";
import { getPlatformConfig } from "@/lib/env";
import { invalidateHost } from "./host-resolver";
import { publishDomainStatus } from "./events";
import { auditCustomDomain } from "./audit";
import * as repo from "./repository";
import type { AgentResult, CustomDomainRecord, CustomDomainStatus } from "./types";

/** Results that failed to apply this many times go to `ncd:results:dead` for inspection. */
const MAX_APPLY_ATTEMPTS = 5;
const AGENT_ACTOR = { actor: "system:domain-agent", ipAddress: "agent" };

export function parseAgentResult(raw: string): AgentResult | null {
  try {
    const r = JSON.parse(raw) as Record<string, unknown>;
    if (typeof r.jobId !== "string" || typeof r.domainId !== "string" || typeof r.hostname !== "string") return null;
    if (!["provision", "teardown", "renewed", "dns_lost"].includes(String(r.type)) || typeof r.ok !== "boolean") return null;
    if (r.ok === false && typeof r.error !== "string") return null;
    if (r.type === "provision" && typeof r.autoSsl !== "boolean") return null;
    if (r.type === "renewed" && typeof r.sslExpiresAt !== "string") return null;
    return r as unknown as AgentResult;
  } catch {
    return null;
  }
}

export async function applyAgentResult(incoming: AgentResult): Promise<void> {
  // The certbot deploy hook has no DB access and reports `hostname:<host>`.
  let result = incoming;
  if (incoming.domainId.startsWith("hostname:")) {
    const row = await db().customDomain.findUnique({ where: { hostname: incoming.hostname }, select: { id: true } });
    if (!row) {
      logger.warn("agent result for unknown hostname ignored", { jobId: incoming.jobId, hostname: incoming.hostname, type: incoming.type });
      return;
    }
    result = { ...incoming, domainId: row.id };
  }
  const now = new Date();
  let updated: CustomDomainRecord | null = null;

  switch (result.type) {
    case "provision": {
      const from: CustomDomainStatus[] = result.autoSsl ? ["ssl_pending"] : ["verified"];
      updated = result.ok
        ? await repo.transitionCustomDomain(result.domainId, null, from, {
          status: result.autoSsl ? "active" : "active_external_ssl",
          lastError: null,
          ...(result.autoSsl ? { sslIssuedAt: now, sslExpiresAt: result.sslExpiresAt ? new Date(result.sslExpiresAt) : null } : {}),
        })
        : await repo.transitionCustomDomain(result.domainId, null, from, {
          status: result.autoSsl ? "ssl_failed" : "pending_dns",
          lastError: result.error.slice(0, 2000),
        });
      break;
    }
    case "teardown": {
      if (result.ok) {
        // Conditional delete: only a row still in `removing`.
        const removed = await repo.deleteRemoving(result.domainId);
        if (removed) {
          await invalidateHost(removed.hostname);
          await auditCustomDomain({ action: "custom_domain.removed", domainId: removed.id, ownerId: removed.ownerId, ...AGENT_ACTOR,
            details: { hostname: removed.hostname, jobId: result.jobId } });
          await publishDomainStatus({ domainId: removed.id, ownerId: removed.ownerId, hostname: removed.hostname, status: "removing", lastError: null });
          return;
        }
      } else {
        // Keep the row in `removing` with the real error so an operator can retry teardown.
        updated = await repo.transitionCustomDomain(result.domainId, null, ["removing"],
          { lastError: `Teardown failed: ${result.error}`.slice(0, 2000) });
      }
      break;
    }
    case "renewed":
      updated = await repo.transitionCustomDomain(result.domainId, null, ["active"], { sslExpiresAt: new Date(result.sslExpiresAt), lastError: null });
      break;
    case "dns_lost":
      updated = await repo.transitionCustomDomain(result.domainId, null, ["active", "active_external_ssl"], {
        status: "dns_lost",
        lastError: `DNS records no longer point to ${getPlatformConfig().platformName}. Re-add them and verify again.`,
      });
      break;
  }

  if (!updated) {
    logger.warn("agent result did not match current state, ignored", { jobId: result.jobId, type: result.type, domainId: result.domainId, ok: result.ok });
    return;
  }

  await invalidateHost(updated.hostname);
  await auditCustomDomain({
    action: `custom_domain.agent_${result.type}_${result.ok ? "ok" : "failed"}`, domainId: updated.id, ownerId: updated.ownerId, ...AGENT_ACTOR,
    details: { hostname: updated.hostname, jobId: result.jobId, status: updated.status, ...("error" in result ? { error: result.error } : {}) },
  });
  await publishDomainStatus({ domainId: updated.id, ownerId: updated.ownerId, hostname: updated.hostname, status: updated.status, lastError: updated.lastError });
}

declare global {
  var __ncd_results_consumer: Promise<void> | undefined;
}

/**
 * Blocking consumer (BLMOVE, no polling). Started once per app process from
 * instrumentation.ts, on a dedicated connection because BLMOVE blocks.
 */
export function startAgentResultConsumer(): void {
  if (globalThis.__ncd_results_consumer) return;
  globalThis.__ncd_results_consumer = (async () => {
    const conn = dedicatedRedis("agent-results");

    // Re-process anything left in flight by a previous app process.
    while (await conn.lmove(KEYS.resultsProcessing, KEYS.results, "RIGHT", "LEFT"));

    logger.info("agent results consumer started");
    for (;;) {
      const raw = await conn.blmove(KEYS.results, KEYS.resultsProcessing, "RIGHT", "LEFT", 0);
      if (!raw) continue;
      const result = parseAgentResult(raw);
      try {
        if (!result) logger.error("malformed agent result dropped", { raw: raw.slice(0, 300) });
        else await applyAgentResult(result);
        await conn.lrem(KEYS.resultsProcessing, 1, raw);
      } catch (err) {
        const jobId = result?.jobId ?? "unknown";
        const attempts = await conn.incr(KEYS.resultAttempts(jobId));
        await conn.pexpire(KEYS.resultAttempts(jobId), 7 * 24 * 3600_000);
        // Back onto the queue for another try, or to the dead-letter list.
        await conn.lrem(KEYS.resultsProcessing, 1, raw);
        const dead = attempts >= MAX_APPLY_ATTEMPTS;
        await conn.lpush(dead ? KEYS.resultsDead : KEYS.results, raw);
        logger.error("failed to apply agent result", { jobId, domainId: result?.domainId, attempts, deadLettered: dead }, err);
      }
    }
  })().catch((err: unknown) => {
    globalThis.__ncd_results_consumer = undefined;
    logger.error("agent results consumer stopped", {}, err);
  });
}
