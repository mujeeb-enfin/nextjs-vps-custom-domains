/**
 * Resolve an incoming request Host to the tenant that owns it.
 *
 * Redis fast path (5 min TTL), then the DB. Every status change calls
 * invalidateHost(), so the TTL only bounds staleness if an invalidation is
 * ever missed. Node runtime only (Prisma).
 */
import { redis, KEYS } from "@/lib/redis";
import { getCustomDomainByHostname } from "./repository";
import { isPlatformHost, normalizeHostname } from "./hostname";
import { SERVING_STATUSES, type CustomDomainStatus } from "./types";

const TTL_MS = 5 * 60_000;
// Negative entries expire fast: an unknown Host header is attacker-controlled,
// and a newly added domain must not stay "missing" for the full positive TTL.
const MISSING_TTL_MS = 30_000;

export interface ResolvedHost {
  kind: "platform" | "custom";
  hostname: string;
  ownerId: string | null;
  status: CustomDomainStatus | null;
  serving: boolean;
}

type Cached = { ownerId: string; status: CustomDomainStatus } | { missing: true };

export async function resolveHost(rawHost: string): Promise<ResolvedHost> {
  const bare = rawHost.split(":")[0].toLowerCase().replace(/\.$/, "");
  if (isPlatformHost(bare)) return { kind: "platform", hostname: bare, ownerId: null, status: null, serving: true };

  const parsed = normalizeHostname(bare);
  if (!parsed.ok) return { kind: "custom", hostname: bare, ownerId: null, status: null, serving: false };
  const hostname = parsed.value.hostname;

  const raw = await redis().get(KEYS.host(hostname));
  let entry: Cached;
  if (raw) {
    entry = JSON.parse(raw) as Cached;
  } else {
    const row = await getCustomDomainByHostname(hostname);
    entry = row ? { ownerId: row.ownerId, status: row.status } : { missing: true };
    await redis().set(KEYS.host(hostname), JSON.stringify(entry), "PX", "missing" in entry ? MISSING_TTL_MS : TTL_MS);
  }

  if ("missing" in entry) return { kind: "custom", hostname, ownerId: null, status: null, serving: false };
  return { kind: "custom", hostname, ownerId: entry.ownerId, status: entry.status, serving: SERVING_STATUSES.has(entry.status) };
}

export async function invalidateHost(hostname: string): Promise<void> {
  await redis().del(KEYS.host(hostname));
}
