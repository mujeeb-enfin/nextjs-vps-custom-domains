/**
 * Job handlers. Each returns the result object reported to the app on
 * `ncd:results` (applied there by src/modules/custom-domains/agent-results.ts).
 */
import { installVhost, removeVhost } from "./nginx.js";
import { certbotIssue, certbotDelete, certificateNotAfter, CommandError } from "./exec.js";
import { assertSafeHostname } from "./hostname.js";
import { pointsHere } from "./dns.js";
import { log } from "./log.js";
import type { AgentConfig } from "./config.js";

export type Job =
  | { type: "provision"; domainId: string; ownerId: string; hostname: string; autoSsl: boolean }
  | { type: "teardown"; domainId: string; ownerId: string; hostname: string };

export interface QueuedJob { jobId: string; enqueuedAt: string; job: Job }

export type Result =
  | { jobId: string; type: "provision"; domainId: string; hostname: string; ok: true; autoSsl: boolean; sslExpiresAt: string | null }
  | { jobId: string; type: "provision"; domainId: string; hostname: string; ok: false; autoSsl: boolean; error: string }
  | { jobId: string; type: "teardown"; domainId: string; hostname: string; ok: true }
  | { jobId: string; type: "teardown"; domainId: string; hostname: string; ok: false; error: string };

/** Map certbot/ACME output to something the domain owner can act on; keep the raw text too. */
export function explainAcmeError(stderr: string): string {
  const s = stderr.toLowerCase();
  let hint = "Let's Encrypt could not issue a certificate.";
  if (s.includes("caa")) hint = "Your CAA DNS records do not allow Let's Encrypt. Add a CAA record: 0 issue \"letsencrypt.org\".";
  else if (s.includes("too many") || s.includes("ratelimited") || s.includes("rate limit")) hint = "Let's Encrypt rate limit reached for this domain. Try again later.";
  else if (s.includes("nxdomain") || s.includes("dns problem")) hint = "Let's Encrypt could not resolve your domain. Check the CNAME record.";
  else if (s.includes("connection refused") || s.includes("timeout") || s.includes("unauthorized")) {
    hint = "Let's Encrypt could not reach your domain on port 80. Make sure the CNAME is set and is DNS only (not proxied).";
  }
  return `${hint}\n\nDetails: ${stderr.trim().slice(0, 1200)}`;
}

async function provision(cfg: AgentConfig, q: QueuedJob & { job: Extract<Job, { type: "provision" }> }): Promise<Result> {
  const { job, jobId } = q;
  const hostname = assertSafeHostname(job.hostname, cfg.platformDomains);
  const base = { jobId, type: "provision" as const, domainId: job.domainId, hostname, autoSsl: job.autoSsl };

  if (!job.autoSsl) {
    // The owner's own TLS proxy may sit in front, so DNS need not point here;
    // ownership was already proven by the TXT record at Verify.
    await installVhost(cfg, hostname, "http-external-ssl");
    return { ...base, ok: true, sslExpiresAt: null };
  }

  // HTTP-01 only succeeds if Let's Encrypt reaches THIS server. Check first so a
  // proxied record fails fast with a clear message instead of burning rate limit.
  const dns = await pointsHere(hostname, cfg.cnameTarget, cfg.resolvers);
  if (!dns.ok) {
    return { ...base, ok: false, error: dns.error
      ? `DNS lookup failed before issuing: ${dns.error}`
      : `${hostname} does not route to ${cfg.cnameTarget}. Set a CNAME to ${cfg.cnameTarget} (DNS only, not proxied) and retry.` };
  }

  // A challenge-only vhost for this exact hostname (no catch-all on a shared
  // host), then issue, then swap in the HTTPS vhost.
  const hadCertificate = (await certificateNotAfter(hostname)) !== null;
  if (!hadCertificate) await installVhost(cfg, hostname, "acme");
  try {
    await certbotIssue({ hostname, email: cfg.acmeEmail, staging: cfg.acmeStaging });
  } catch (err) {
    if (!hadCertificate) await removeVhost(cfg, hostname);
    const stderr = err instanceof CommandError ? err.stderr : String(err);
    log.warn("certificate issuance failed", { jobId, hostname, domainId: job.domainId });
    return { ...base, ok: false, error: explainAcmeError(stderr) };
  }
  await installVhost(cfg, hostname, "https");
  return { ...base, ok: true, sslExpiresAt: await certificateNotAfter(hostname) };
}

async function teardown(cfg: AgentConfig, q: QueuedJob & { job: Extract<Job, { type: "teardown" }> }): Promise<Result> {
  const { job, jobId } = q;
  const hostname = assertSafeHostname(job.hostname, cfg.platformDomains);
  const base = { jobId, type: "teardown" as const, domainId: job.domainId, hostname };
  await removeVhost(cfg, hostname);
  try {
    await certbotDelete(hostname);
  } catch (err) {
    // No certificate exists (Auto SSL off, or issuance never succeeded): nothing to delete.
    const stderr = err instanceof CommandError ? err.stderr : String(err);
    if (!/no certificate found|no such file|not found/i.test(stderr)) return { ...base, ok: false, error: stderr.slice(0, 1500) };
  }
  return { ...base, ok: true };
}

export async function handle(cfg: AgentConfig, q: QueuedJob): Promise<Result> {
  if (q.job.type === "provision") return provision(cfg, q as QueuedJob & { job: Extract<Job, { type: "provision" }> });
  return teardown(cfg, q as QueuedJob & { job: Extract<Job, { type: "teardown" }> });
}
