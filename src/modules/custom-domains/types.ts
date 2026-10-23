/** Custom-domain lifecycle. See docs/architecture.md for the state diagram. */
export const CUSTOM_DOMAIN_STATUSES = [
  "pending_dns",
  "verified",
  "ssl_pending",
  "active",
  "active_external_ssl",
  "ssl_failed",
  "dns_lost",
  "removing",
] as const;

export type CustomDomainStatus = (typeof CUSTOM_DOMAIN_STATUSES)[number];

/** Statuses in which the custom hostname serves traffic. */
export const SERVING_STATUSES: ReadonlySet<CustomDomainStatus> = new Set(["active", "active_external_ssl"]);

/** Statuses from which the owner may run Verify. */
export const VERIFIABLE_STATUSES: ReadonlySet<CustomDomainStatus> = new Set(["pending_dns", "dns_lost"]);

export interface CustomDomainRecord {
  id: string;
  ownerId: string;
  hostname: string;
  status: CustomDomainStatus;
  verificationToken: string;
  autoSsl: boolean;
  isApex: boolean;
  verifiedAt: Date | null;
  sslIssuedAt: Date | null;
  sslExpiresAt: Date | null;
  lastCheckedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A DNS record the owner must create at their DNS provider. */
export interface RequiredDnsRecord {
  id: "cname" | "txt";
  type: "CNAME" | "TXT";
  /** Fully-qualified name. */
  name: string;
  /** Name as most DNS provider UIs expect it (relative to the registrable domain; "@" for apex). */
  host: string;
  value: string;
  purpose: string;
}

/** Jobs sent to the host agent (agent/). The agent has its own copy of these shapes. */
export type DomainJob =
  | { type: "provision"; domainId: string; ownerId: string; hostname: string; autoSsl: boolean }
  | { type: "teardown"; domainId: string; ownerId: string; hostname: string };

export interface QueuedDomainJob {
  jobId: string;
  enqueuedAt: string;
  job: DomainJob;
}

/** Results reported by the host agent and its certbot deploy hook. */
export type AgentResult =
  | { jobId: string; type: "provision"; domainId: string; hostname: string; ok: true; autoSsl: boolean; sslExpiresAt: string | null }
  | { jobId: string; type: "provision"; domainId: string; hostname: string; ok: false; autoSsl: boolean; error: string }
  | { jobId: string; type: "teardown"; domainId: string; hostname: string; ok: true }
  | { jobId: string; type: "teardown"; domainId: string; hostname: string; ok: false; error: string }
  | { jobId: string; type: "renewed"; domainId: string; hostname: string; ok: true; sslExpiresAt: string }
  | { jobId: string; type: "dns_lost"; domainId: string; hostname: string; ok: true };
