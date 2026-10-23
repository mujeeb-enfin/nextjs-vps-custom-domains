/**
 * Short-lived cache for "Test my DNS" results so repeated clicks do not
 * re-query public resolvers. Keyed by hostname + token + routing target so a
 * token or config change never serves a stale answer. Verify never reads it.
 */
import { createHash } from "node:crypto";
import { redis, KEYS } from "@/lib/redis";
import type { DnsCheckResult } from "./dns-verifier";

export const DNS_CHECK_CACHE_TTL_MS = 15_000;

function key(hostname: string, token: string, routingTarget: string, requireCaa: boolean): string {
  return KEYS.dnsCheck(createHash("sha256").update(`${hostname}|${token}|${routingTarget}|${requireCaa}`).digest("hex").slice(0, 32));
}

export async function getCachedDnsCheck(hostname: string, token: string, routingTarget: string, requireCaa: boolean): Promise<DnsCheckResult | null> {
  const raw = await redis().get(key(hostname, token, routingTarget, requireCaa));
  return raw ? (JSON.parse(raw) as DnsCheckResult) : null;
}

export async function cacheDnsCheck(
  hostname: string, token: string, routingTarget: string, requireCaa: boolean, result: DnsCheckResult,
): Promise<void> {
  // Transient resolver failures must not stick: the next click should retry.
  if (result.records.some((r) => r.status === "error")) return;
  await redis().set(key(hostname, token, routingTarget, requireCaa), JSON.stringify(result), "PX", DNS_CHECK_CACHE_TTL_MS);
}
