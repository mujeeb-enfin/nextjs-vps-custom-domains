/**
 * Custom-domain application service: owns every state transition.
 * API routes only authenticate, parse input and map results to HTTP.
 */
import { getPlatformConfig } from "@/lib/env";
import { logger } from "@/lib/logger";
import type { Actor } from "@/lib/auth";
import { normalizeHostname, type HostnameErrorCode } from "./hostname";
import { checkDomainDns, type DnsCheckResult } from "./dns-verifier";
import { generateVerificationToken, buildRequiredRecords } from "./records";
import { getCachedDnsCheck, cacheDnsCheck } from "./dns-check-cache";
import { auditCustomDomain, type CustomDomainAuditAction } from "./audit";
import { enqueueDomainJob } from "./queue";
import { invalidateHost } from "./host-resolver";
import { publishDomainStatus } from "./events";
import * as repo from "./repository";
import { VERIFIABLE_STATUSES, type CustomDomainRecord, type DomainJob, type RequiredDnsRecord } from "./types";

export type ServiceError =
  | { code: HostnameErrorCode; status: 400; message: string }
  | { code: "LIMIT_REACHED"; status: 403; message: string }
  | { code: "DOMAIN_TAKEN"; status: 409; message: string }
  | { code: "NOT_FOUND"; status: 404; message: string }
  | { code: "INVALID_STATE"; status: 409; message: string }
  | { code: "DNS_NOT_READY"; status: 422; message: string; dnsCheck: DnsCheckResult };

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; error: ServiceError };

export interface CustomDomainView {
  id: string;
  hostname: string;
  status: CustomDomainRecord["status"];
  autoSsl: boolean;
  isApex: boolean;
  verifiedAt: string | null;
  sslIssuedAt: string | null;
  sslExpiresAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
  records: RequiredDnsRecord[];
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const notFound: ServiceError = { code: "NOT_FOUND", status: 404, message: "Custom domain not found" };
const changed = (message = "Domain changed. Refresh and try again."): ServiceError => ({ code: "INVALID_STATE", status: 409, message });

export function toView(d: CustomDomainRecord): CustomDomainView {
  return {
    id: d.id, hostname: d.hostname, status: d.status, autoSsl: d.autoSsl, isApex: d.isApex,
    verifiedAt: iso(d.verifiedAt), sslIssuedAt: iso(d.sslIssuedAt), sslExpiresAt: iso(d.sslExpiresAt),
    lastCheckedAt: iso(d.lastCheckedAt), lastError: d.lastError, createdAt: d.createdAt.toISOString(),
    records: buildRequiredRecords(d.hostname, d.verificationToken, getPlatformConfig().cnameTarget),
  };
}

async function audit(actor: Actor, action: CustomDomainAuditAction, domainId: string, details: Record<string, unknown>) {
  await auditCustomDomain({ action, domainId, ownerId: actor.ownerId, actor: actor.actor, ipAddress: actor.ipAddress, details });
}

/** Push the new state to the owner's open dashboards (all app instances). */
async function pushStatus(d: CustomDomainRecord): Promise<void> {
  await publishDomainStatus({ domainId: d.id, ownerId: d.ownerId, hostname: d.hostname, status: d.status, lastError: d.lastError });
}

/**
 * Queue an agent job after a state transition. If queueing fails the domain
 * would be stranded in a pending state with no job behind it, so the
 * transition is reverted (recording the real error) and the error rethrown.
 */
async function enqueueOrRevert(domain: CustomDomainRecord, revertTo: CustomDomainRecord["status"], job: DomainJob): Promise<void> {
  try {
    await enqueueDomainJob(job);
  } catch (err) {
    await repo.transitionCustomDomain(domain.id, domain.ownerId, [domain.status], {
      status: revertTo,
      lastError: `Could not queue ${job.type}: ${err instanceof Error ? err.message : String(err)}`,
    });
    logger.error("custom domain job enqueue failed, status reverted", { domainId: domain.id, hostname: domain.hostname, jobType: job.type, revertTo }, err);
    throw err;
  }
}

export async function listDomains(ownerId: string): Promise<CustomDomainView[]> {
  return (await repo.listCustomDomains(ownerId)).map(toView);
}

export async function getDomain(id: string, ownerId: string): Promise<ServiceResult<CustomDomainView>> {
  const d = await repo.getCustomDomainForOwner(id, ownerId);
  return d ? { ok: true, value: toView(d) } : { ok: false, error: notFound };
}

export async function addDomain(actor: Actor, rawHostname: unknown, autoSsl: boolean): Promise<ServiceResult<CustomDomainView>> {
  const parsed = normalizeHostname(typeof rawHostname === "string" ? rawHostname : "");
  if (!parsed.ok) return { ok: false, error: { code: parsed.code, status: 400, message: parsed.message } };
  const { hostname, isApex } = parsed.value;

  const [allowance, used] = await Promise.all([repo.getAllowance(actor.ownerId), repo.countCustomDomains(actor.ownerId)]);
  if (used >= allowance) {
    return { ok: false, error: { code: "LIMIT_REACHED", status: 403, message: allowance === 0
      ? "Custom domains are not enabled for this account."
      : `This account allows ${allowance} custom domain${allowance === 1 ? "" : "s"}. Remove one to add another.` } };
  }

  const taken: ServiceError = { code: "DOMAIN_TAKEN", status: 409, message: "This domain is already connected to an account." };
  if (await repo.getCustomDomainByHostname(hostname)) return { ok: false, error: taken };

  let created: CustomDomainRecord;
  try {
    created = await repo.createCustomDomain({ ownerId: actor.ownerId, hostname, isApex, autoSsl, verificationToken: generateVerificationToken() });
  } catch (err) {
    // Unique-index race between the lookup above and the insert.
    if ((err as { code?: string }).code === "P2002") return { ok: false, error: taken };
    throw err;
  }

  // Clear any negative host-cache entry left by earlier requests for this hostname.
  await invalidateHost(hostname);
  await audit(actor, "custom_domain.created", created.id, { hostname, autoSsl, isApex });
  logger.info("custom domain added", { domainId: created.id, ownerId: actor.ownerId, hostname });
  return { ok: true, value: toView(created) };
}

/**
 * "Test my DNS": read-only. No state change, no audit, no queue. Shares
 * checkDomainDns with verifyDomain, so a pass here means Verify passes.
 */
export async function testDomainDns(id: string, ownerId: string): Promise<ServiceResult<DnsCheckResult>> {
  const d = await repo.getCustomDomainForOwner(id, ownerId);
  if (!d) return { ok: false, error: notFound };
  const { cnameTarget, resolvers } = getPlatformConfig();
  const requireCaa = d.autoSsl;

  const cached = await getCachedDnsCheck(d.hostname, d.verificationToken, cnameTarget, requireCaa);
  if (cached) return { ok: true, value: cached };

  const parsed = normalizeHostname(d.hostname);
  if (!parsed.ok) throw new Error(`Stored hostname failed validation: ${d.hostname}`);
  const result = await checkDomainDns({ domain: parsed.value, verificationToken: d.verificationToken, cnameTarget, resolvers }, { requireCaa });
  await cacheDnsCheck(d.hostname, d.verificationToken, cnameTarget, requireCaa, result);
  return { ok: true, value: result };
}

export async function verifyDomain(actor: Actor, id: string): Promise<ServiceResult<{ domain: CustomDomainView; dnsCheck: DnsCheckResult }>> {
  const d = await repo.getCustomDomainForOwner(id, actor.ownerId);
  if (!d) return { ok: false, error: notFound };
  if (!VERIFIABLE_STATUSES.has(d.status)) return { ok: false, error: changed(`Domain is already ${d.status.replace(/_/g, " ")}.`) };

  const { cnameTarget, resolvers } = getPlatformConfig();
  const parsed = normalizeHostname(d.hostname);
  if (!parsed.ok) throw new Error(`Stored hostname failed validation: ${d.hostname}`);
  // Verify always queries live DNS, never the Test-my-DNS cache.
  const dnsCheck = await checkDomainDns(
    { domain: parsed.value, verificationToken: d.verificationToken, cnameTarget, resolvers }, { requireCaa: d.autoSsl });
  const now = new Date();

  if (!dnsCheck.passed) {
    const failing = dnsCheck.records.filter((r) => r.blocking && r.status !== "ok");
    const failed = await repo.transitionCustomDomain(d.id, actor.ownerId, [d.status],
      { lastCheckedAt: now, lastError: failing.map((r) => r.message).join(" ").slice(0, 2000) });
    if (failed) await pushStatus(failed);
    await audit(actor, "custom_domain.verify_failed", d.id,
      { hostname: d.hostname, failing: failing.map((r) => ({ kind: r.kind, status: r.status, found: r.found })) });
    return { ok: false, error: { code: "DNS_NOT_READY", status: 422, message: "DNS records are not set up correctly yet.", dnsCheck } };
  }

  // Both modes need an nginx vhost (HTTPS with a Let's Encrypt certificate, or
  // HTTP-only behind the owner's own TLS proxy), so the agent provisions either way.
  const next = d.autoSsl ? "ssl_pending" : "verified";
  const updated = await repo.transitionCustomDomain(d.id, actor.ownerId, [d.status],
    { status: next, verifiedAt: now, lastCheckedAt: now, lastError: null });
  if (!updated) return { ok: false, error: changed("Domain changed while verifying. Refresh and try again.") };

  await enqueueOrRevert(updated, d.status,
    { type: "provision", domainId: updated.id, ownerId: updated.ownerId, hostname: updated.hostname, autoSsl: updated.autoSsl });
  await invalidateHost(updated.hostname);
  await audit(actor, "custom_domain.verified", d.id, { hostname: d.hostname, nextStatus: next });
  if (updated.autoSsl) await audit(actor, "custom_domain.ssl_requested", d.id, { hostname: d.hostname });
  await pushStatus(updated);
  return { ok: true, value: { domain: toView(updated), dnsCheck } };
}

export async function setAutoSsl(actor: Actor, id: string, autoSsl: boolean): Promise<ServiceResult<CustomDomainView>> {
  const d = await repo.getCustomDomainForOwner(id, actor.ownerId);
  if (!d) return { ok: false, error: notFound };
  // Changing it after verification would need re-provisioning; allowed only before the first Verify.
  if (d.status !== "pending_dns" || d.verifiedAt) {
    return { ok: false, error: changed("Auto SSL can only be changed before the domain is verified. Remove and re-add the domain to change it.") };
  }
  if (d.autoSsl === autoSsl) return { ok: true, value: toView(d) };
  const updated = await repo.transitionCustomDomain(d.id, actor.ownerId, [d.status], { autoSsl });
  if (!updated) return { ok: false, error: changed() };
  await audit(actor, "custom_domain.auto_ssl_changed", d.id, { hostname: d.hostname, autoSsl });
  return { ok: true, value: toView(updated) };
}

export async function retrySsl(actor: Actor, id: string): Promise<ServiceResult<CustomDomainView>> {
  const d = await repo.getCustomDomainForOwner(id, actor.ownerId);
  if (!d) return { ok: false, error: notFound };
  const updated = await repo.transitionCustomDomain(d.id, actor.ownerId, ["ssl_failed"], { status: "ssl_pending", lastError: null });
  if (!updated) return { ok: false, error: changed("SSL can only be retried after a failed issuance.") };
  await enqueueOrRevert(updated, "ssl_failed", { type: "provision", domainId: d.id, ownerId: d.ownerId, hostname: d.hostname, autoSsl: true });
  await audit(actor, "custom_domain.ssl_requested", d.id, { hostname: d.hostname, retry: true });
  await pushStatus(updated);
  return { ok: true, value: toView(updated) };
}

export async function removeDomain(actor: Actor, id: string): Promise<ServiceResult<{ id: string; status: "removing" | "deleted" }>> {
  const d = await repo.getCustomDomainForOwner(id, actor.ownerId);
  if (!d) return { ok: false, error: notFound };

  // Only a never-verified domain has nothing on the host (provisioning starts at
  // Verify). Every other state goes through the agent, so the vhost and any
  // certificate are removed before the row is deleted.
  if (d.status === "pending_dns" && !d.verifiedAt) {
    // Conditional on status: a racing Verify may already have queued provisioning.
    if ((await repo.deleteNeverVerified(d.id, actor.ownerId)) === 0) return { ok: false, error: changed() };
    await invalidateHost(d.hostname);
    await audit(actor, "custom_domain.removal_requested", d.id, { hostname: d.hostname, direct: true });
    return { ok: true, value: { id: d.id, status: "deleted" } };
  }

  const updated = await repo.transitionCustomDomain(d.id, actor.ownerId,
    ["pending_dns", "verified", "ssl_pending", "active", "active_external_ssl", "ssl_failed", "dns_lost"], { status: "removing" });
  if (!updated) return { ok: false, error: changed("Domain is already being removed.") };
  await enqueueOrRevert(updated, d.status, { type: "teardown", domainId: d.id, ownerId: d.ownerId, hostname: d.hostname });
  await invalidateHost(d.hostname);
  await audit(actor, "custom_domain.removal_requested", d.id, { hostname: d.hostname });
  await pushStatus(updated);
  return { ok: true, value: { id: d.id, status: "removing" } };
}
