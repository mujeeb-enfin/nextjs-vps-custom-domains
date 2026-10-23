/** Client-side shapes mirroring the /api/v1/custom-domains responses. */

export type DomainStatus =
  | "pending_dns" | "verified" | "ssl_pending" | "active" | "active_external_ssl"
  | "ssl_failed" | "dns_lost" | "removing";

export interface RequiredRecord {
  id: "cname" | "txt";
  type: "CNAME" | "TXT";
  name: string;
  host: string;
  value: string;
  purpose: string;
}

export interface CustomDomain {
  id: string;
  hostname: string;
  status: DomainStatus;
  autoSsl: boolean;
  isApex: boolean;
  verifiedAt: string | null;
  sslIssuedAt: string | null;
  sslExpiresAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
  records: RequiredRecord[];
}

export type RecordCheckStatus = "ok" | "missing" | "mismatch" | "error";

export interface RecordCheck {
  kind: "cname" | "txt" | "aaaa" | "caa";
  name: string;
  expected: string;
  found: string[];
  status: RecordCheckStatus;
  blocking: boolean;
  message: string;
}

export interface DnsCheckResult {
  hostname: string;
  checkedAt: string;
  resolvers: string[];
  passed: boolean;
  records: RecordCheck[];
}

export interface StatusEvent {
  type: "custom_domain.status";
  domainId: string;
  hostname: string;
  status: DomainStatus;
  lastError: string | null;
  at: string;
}

type Tone = "neutral" | "progress" | "success" | "danger";

export const STATUS_META: Record<DomainStatus, { label: string; tone: Tone; description: string }> = {
  pending_dns: { label: "Waiting for DNS", tone: "neutral", description: "Add the DNS records below, then verify." },
  verified: { label: "Connecting", tone: "progress", description: "Ownership confirmed. Connecting your domain." },
  ssl_pending: { label: "Issuing certificate", tone: "progress", description: "Ownership confirmed. Requesting a Let's Encrypt certificate." },
  active: { label: "Active", tone: "success", description: "Your domain is live with a Let's Encrypt certificate." },
  active_external_ssl: { label: "Active (your SSL)", tone: "success", description: "Your domain is live. HTTPS is handled by your own proxy." },
  ssl_failed: { label: "Certificate failed", tone: "danger", description: "Let's Encrypt could not issue a certificate. See the error and retry." },
  dns_lost: { label: "DNS changed", tone: "danger", description: "Your DNS no longer points here. Fix the records and verify again." },
  removing: { label: "Removing", tone: "progress", description: "Removing the domain and its certificate." },
};

export const TONE_CLASS: Record<Tone, string> = {
  neutral: "border-border bg-neutral-bg text-neutral-fg",
  progress: "border-warning-line bg-warning-bg text-warning-fg",
  success: "border-success-line bg-success-bg text-success-fg",
  danger: "border-danger-line bg-danger-bg text-danger-fg",
};
