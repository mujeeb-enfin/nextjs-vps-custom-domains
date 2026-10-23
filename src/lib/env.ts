/**
 * Platform configuration, read once per process from the environment.
 *
 * Every value is required: a missing or invalid setting throws at first use
 * (instrumentation.ts calls getPlatformConfig() at boot, so a misconfigured
 * deploy fails on start instead of on the first domain verification).
 */
import { isIP } from "node:net";

export interface PlatformConfig {
  /** Product name shown in tenant-facing copy, e.g. "AcmePay". */
  platformName: string;
  /** Domains the platform itself serves. They and their subdomains can never be claimed. */
  platformDomains: string[];
  /** Hostname tenants CNAME their domain to. A DNS-only record pointing at your edge. */
  cnameTarget: string;
  /** Public resolvers used for verification, so results match what the internet sees. */
  resolvers: string[];
  /** Label of the ownership TXT record, e.g. "_acmepay-verify". */
  txtLabel: string;
  redisUrl: string;
}

export class ConfigError extends Error {
  readonly code = "PLATFORM_NOT_CONFIGURED";
}

export const HOSTNAME_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new ConfigError(`${name} is required`);
  return v;
}

function hostnameList(name: string): string[] {
  const list = required(name).split(",").map((s) => s.trim().toLowerCase().replace(/\.$/, "")).filter(Boolean);
  for (const h of list) {
    if (!HOSTNAME_RE.test(h) || isIP(h) !== 0) throw new ConfigError(`${name} must contain hostnames only (got "${h}")`);
  }
  return list;
}

let cached: PlatformConfig | null = null;

export function getPlatformConfig(): PlatformConfig {
  if (cached) return cached;

  const platformDomains = hostnameList("NCD_PLATFORM_DOMAINS");
  const [cnameTarget] = hostnameList("NCD_CNAME_TARGET");
  const resolvers = required("NCD_RESOLVERS").split(",").map((r) => r.trim()).filter(Boolean);
  if (resolvers.length === 0 || resolvers.some((r) => isIP(r) === 0)) {
    throw new ConfigError("NCD_RESOLVERS must be a comma-separated list of resolver IP addresses");
  }
  const txtLabel = required("NCD_TXT_LABEL");
  if (!/^_[a-z0-9-]{1,62}$/.test(txtLabel)) throw new ConfigError("NCD_TXT_LABEL must look like _yourbrand-verify");

  cached = {
    platformName: required("NCD_PLATFORM_NAME"),
    platformDomains,
    cnameTarget,
    resolvers,
    txtLabel,
    redisUrl: required("REDIS_URL"),
  };
  return cached;
}

/** Test hook: config is otherwise read once per process. */
export function resetPlatformConfigForTests(): void {
  cached = null;
}
