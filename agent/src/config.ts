/**
 * Agent configuration from /etc/ncd-agent/agent.env (systemd EnvironmentFile).
 * Every value is required: the agent refuses to start on a partial config.
 */

export interface AgentConfig {
  redisUrl: string;
  /** Upstream the custom vhosts proxy to (the Next.js app), always on loopback. */
  upstream: string;
  /** Directory holding one nginx config per custom domain. */
  vhostDir: string;
  /** ACME HTTP-01 webroot. */
  acmeWebroot: string;
  /** Contact email for the Let's Encrypt account. */
  acmeEmail: string;
  /** Use the Let's Encrypt staging endpoint (non-production environments). */
  acmeStaging: boolean;
  /** Platform routing hostname tenants CNAME to; re-checked before issuance. */
  cnameTarget: string;
  /** The platform's own domains. The agent refuses to touch them. */
  platformDomains: string[];
  /** Public resolvers for the pre-issuance DNS check. */
  resolvers: string[];
  templatesDir: string;
  logFile: string;
}

const HOST_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

function hostnames(name: string): string[] {
  const list = required(name).split(",").map((s) => s.trim().toLowerCase().replace(/\.$/, "")).filter(Boolean);
  if (list.length === 0 || list.some((h) => !HOST_RE.test(h))) throw new Error(`${name} must be a comma-separated list of hostnames`);
  return list;
}

export function loadConfig(): AgentConfig {
  const cnameTarget = hostnames("NCD_AGENT_CNAME_TARGET")[0]!; // hostnames() guarantees one entry
  const upstream = required("NCD_AGENT_UPSTREAM");
  if (!/^127\.0\.0\.1:\d{2,5}$/.test(upstream)) throw new Error("NCD_AGENT_UPSTREAM must be 127.0.0.1:<port>");
  const email = required("NCD_AGENT_ACME_EMAIL");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("NCD_AGENT_ACME_EMAIL is not a valid email");
  const staging = required("NCD_AGENT_ACME_STAGING");
  if (staging !== "true" && staging !== "false") throw new Error("NCD_AGENT_ACME_STAGING must be true or false");
  const resolvers = required("NCD_AGENT_RESOLVERS").split(",").map((s) => s.trim()).filter(Boolean);
  if (resolvers.length === 0 || resolvers.some((r) => !IPV4_RE.test(r) && !r.includes(":"))) {
    throw new Error("NCD_AGENT_RESOLVERS must be a comma-separated list of resolver IPs");
  }

  return {
    redisUrl: required("NCD_AGENT_REDIS_URL"),
    upstream,
    vhostDir: required("NCD_AGENT_VHOST_DIR"),
    acmeWebroot: required("NCD_AGENT_ACME_WEBROOT"),
    acmeEmail: email,
    acmeStaging: staging === "true",
    cnameTarget,
    platformDomains: hostnames("NCD_AGENT_PLATFORM_DOMAINS"),
    resolvers,
    templatesDir: required("NCD_AGENT_TEMPLATES_DIR"),
    logFile: required("NCD_AGENT_LOG_FILE"),
  };
}
