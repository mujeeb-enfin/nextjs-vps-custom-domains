/**
 * DNS verification for tenant custom domains.
 *
 * Queries PUBLIC resolvers (NCD_RESOLVERS) rather than the host's
 * resolver, so results match what Let's Encrypt and the tenant's visitors
 * see. Used by both "Test my DNS" (read-only) and "Verify" — the same code
 * path guarantees a green test means Verify passes for the same DNS state.
 *
 * Lookup failures (SERVFAIL, timeout) are reported as `error`, never as
 * `missing` — we do not guess.
 */
import { Resolver } from "node:dns/promises";
import { isIP } from "node:net";
import type { NormalizedHostname } from "./hostname";

export type RecordCheckStatus = "ok" | "missing" | "mismatch" | "error";
export type RecordKind = "cname" | "txt" | "aaaa" | "caa";

export interface RecordCheck {
  kind: RecordKind;
  /** Fully-qualified record name that was queried. */
  name: string;
  /** Value the tenant must set (empty for advisory checks). */
  expected: string;
  /** Raw values the resolver returned. */
  found: string[];
  status: RecordCheckStatus;
  /** Blocking checks gate verification; advisory checks only warn. */
  blocking: boolean;
  message: string;
}

export interface DnsCheckResult {
  hostname: string;
  checkedAt: string;
  resolvers: string[];
  /** True when every blocking check is ok. */
  passed: boolean;
  records: RecordCheck[];
}

export interface DnsCheckInput {
  domain: NormalizedHostname;
  verificationToken: string;
  cnameTarget: string;
  resolvers: string[];
}

const NOT_FOUND_CODES = new Set(["ENODATA", "ENOTFOUND", "NXDOMAIN"]);
// c-ares timeout per try; 2 tries per server × 2 servers bounds one lookup to
// ~12 s worst case. All checks run concurrently, so a request stays well under
// a typical 60-120 s reverse-proxy read timeout.
const LOOKUP_TIMEOUT_MS = 3000;

/** Cloudflare's published IPv4 ranges — used only to explain a likely "proxied record" mistake. */
const CLOUDFLARE_V4_RANGES = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18",
  "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17",
  "162.158.0.0/15", "104.16.0.0/13", "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
];

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
}

export function isCloudflareIp(ip: string): boolean {
  if (isIP(ip) !== 4) return false;
  const n = ipv4ToInt(ip);
  return CLOUDFLARE_V4_RANGES.some((cidr) => {
    const [base, bits] = cidr.split("/");
    const mask = bits === "0" ? 0 : (~0 << (32 - Number(bits))) >>> 0;
    return (n & mask) === (ipv4ToInt(base) & mask);
  });
}

export function expectedTxtValue(token: string): string {
  return `verify=${token}`;
}

type Lookup<T> = { found: T[]; notFound: boolean; error: string | null };

async function lookup<T>(fn: () => Promise<T[]>): Promise<Lookup<T>> {
  try {
    return { found: await fn(), notFound: false, error: null };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? "";
    if (NOT_FOUND_CODES.has(code)) return { found: [], notFound: true, error: null };
    return { found: [], notFound: false, error: `${code || "DNS_ERROR"}: ${(err as Error).message}` };
  }
}

function createResolver(servers: string[]): Resolver {
  const r = new Resolver({ timeout: LOOKUP_TIMEOUT_MS, tries: 2 });
  r.setServers(servers);
  return r;
}

function sameSet(a: string[], b: string[]): boolean {
  const x = new Set(a), y = new Set(b);
  return x.size === y.size && [...x].every((v) => y.has(v));
}

/**
 * The tenant's hostname must route to the platform through the CNAME target.
 * Passes when it is a CNAME to the target, or (apex / CNAME-flattening
 * providers such as Cloudflare) when it resolves to exactly the target's
 * addresses. Messages never include server IPs — only hostnames.
 */
async function checkCname(r: Resolver, hostname: string, cnameTarget: string): Promise<RecordCheck> {
  const [cname, own, target] = await Promise.all([
    lookup(() => r.resolveCname(hostname)),
    lookup(() => r.resolve4(hostname)),
    lookup(() => r.resolve4(cnameTarget)),
  ]);
  const found = cname.found.map((v) => v.toLowerCase().replace(/\.$/, ""));
  const base = { kind: "cname" as const, name: hostname, expected: cnameTarget, found, blocking: true };

  if (target.error || target.notFound || target.found.length === 0) {
    // Our own routing hostname must always resolve; this is a platform problem, not the tenant's.
    return { ...base, status: "error", message: "Platform routing is temporarily unavailable. Try again in a few minutes." };
  }
  if (cname.error) return { ...base, status: "error", message: `DNS lookup failed (${cname.error}). Try again shortly.` };

  if (found.includes(cnameTarget)) {
    return { ...base, status: "ok", message: `CNAME found: ${hostname} points to ${cnameTarget}.` };
  }
  if (found.length > 0) {
    return { ...base, status: "mismatch", message: `${hostname} is a CNAME to ${found.join(", ")}. Change it to ${cnameTarget}.` };
  }
  // No CNAME visible: a flattened apex CNAME resolves straight to the target's addresses.
  if (!own.error && own.found.length > 0 && sameSet(own.found, target.found)) {
    return { ...base, status: "ok", message: `${hostname} routes to ${cnameTarget} (flattened CNAME).` };
  }
  if (!own.error && own.found.some(isCloudflareIp)) {
    return { ...base, status: "mismatch", message:
      `${hostname} is proxied through Cloudflare (orange cloud). Set the CNAME to ${cnameTarget} and switch it to "DNS only" (grey cloud).` };
  }
  if (!own.error && own.found.length > 0) {
    return { ...base, status: "mismatch", message:
      `${hostname} points somewhere else. Replace its existing A/AAAA records with a CNAME to ${cnameTarget}.` };
  }
  return { ...base, status: "missing", message: `No CNAME found for ${hostname}. Add a CNAME record pointing to ${cnameTarget}.` };
}

async function checkTxt(r: Resolver, name: string, expected: string): Promise<RecordCheck> {
  const res = await lookup(() => r.resolveTxt(name));
  const values = res.found.map((chunks) => chunks.join(""));
  const base = { kind: "txt" as const, name, expected, found: values, blocking: true };
  if (res.error) return { ...base, status: "error", message: `DNS lookup failed (${res.error}). Try again shortly.` };
  if (res.notFound || values.length === 0) {
    return { ...base, status: "missing", message: `No TXT record found at ${name}. Add it with the value shown.` };
  }
  if (values.some((v) => v.trim() === expected)) {
    return { ...base, status: "ok", message: "Ownership TXT record found and matches." };
  }
  return { ...base, status: "mismatch", message:
    `A TXT record exists at ${name} but its value does not match. Replace it with ${expected}.` };
}

/** IPv6 must route the same way as IPv4: no AAAA, or exactly the routing target's own AAAA. */
async function checkAaaa(r: Resolver, hostname: string, cnameTarget: string): Promise<RecordCheck> {
  const [res, target] = await Promise.all([lookup(() => r.resolve6(hostname)), lookup(() => r.resolve6(cnameTarget))]);
  const base = { kind: "aaaa" as const, name: hostname, expected: "", found: res.found, blocking: true };
  if (res.error) return { ...base, status: "error", message: `IPv6 lookup failed (${res.error}). Try again shortly.` };
  if (res.found.length === 0) return { ...base, status: "ok", message: "No conflicting IPv6 (AAAA) records." };
  if (!target.error && sameSet(res.found, target.found)) {
    return { ...base, status: "ok", message: `IPv6 routes to ${cnameTarget}.` };
  }
  return { ...base, status: "mismatch", message:
    `${hostname} has its own AAAA (IPv6) records. Remove them so IPv6 visitors and certificate ` +
    `validation also reach ${cnameTarget}.` };
}

/**
 * CAA records restrict which CAs may issue. Per RFC 8659 the relevant set is the
 * first one found climbing from the hostname toward the root, so every
 * intermediate label is checked (pay.eu.acmestore.com → eu.acmestore.com →
 * acmestore.com).
 */
function caaCandidates(domain: NormalizedHostname): string[] {
  const names: string[] = [];
  let current = domain.hostname;
  while (true) {
    names.push(current);
    if (current === domain.registrableDomain) break;
    current = current.slice(current.indexOf(".") + 1);
  }
  return names;
}

async function checkCaa(r: Resolver, domain: NormalizedHostname): Promise<RecordCheck> {
  const names = caaCandidates(domain);
  // Query every level in parallel (bounded by label depth), then take the first
  // non-empty set in climb order — keeps worst-case latency to one lookup.
  const results = await Promise.all(names.map((name) => lookup(() => r.resolveCaa(name))));
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const res = results[i];
    if (res.error) {
      // Let's Encrypt refuses to issue when CAA lookup fails, so this is not ok.
      return { kind: "caa", name, expected: "", found: [], blocking: false, status: "error",
        message: `CAA lookup failed (${res.error}). Let's Encrypt cannot issue a certificate until this resolves.` };
    }
    // A CAA record set exists here; per RFC 8659 it is authoritative even if it
    // only contains iodef/issuewild entries (then any CA may issue non-wildcard).
    if (res.found.length === 0) continue;
    const issuers = res.found.filter((c) => c.issue !== undefined).map((c) => String(c.issue));
    if (issuers.length > 0) {
      // `issue ";"` (empty issuer) forbids all CAs; parse the issuer-domain before parameters.
      const allowed = issuers.some((i) => i.split(";")[0].trim().toLowerCase() === "letsencrypt.org");
      return { kind: "caa", name, expected: "letsencrypt.org", found: issuers, blocking: false,
        status: allowed ? "ok" : "mismatch",
        message: allowed
          ? "CAA records allow Let's Encrypt."
          : `CAA records on ${name} do not allow Let's Encrypt. Add: ${name} CAA 0 issue "letsencrypt.org" — required for Auto SSL.` };
    }
    return { kind: "caa", name, expected: "", found: [], blocking: false, status: "ok",
      message: "CAA records do not restrict certificate issuers." };
  }
  return { kind: "caa", name: names[names.length - 1], expected: "", found: [], blocking: false,
    status: "ok", message: "No CAA restrictions." };
}

/**
 * Run all checks concurrently. Pure: no DB writes, no side effects — callers
 * decide whether the result changes domain state.
 */
export async function checkDomainDns(input: DnsCheckInput, opts: { requireCaa?: boolean } = {}): Promise<DnsCheckResult> {
  const resolver = createResolver(input.resolvers);
  const { domain } = input;

  const [route, txt, aaaa, caa] = await Promise.all([
    checkCname(resolver, domain.hostname, input.cnameTarget),
    checkTxt(resolver, domain.verificationRecordName, expectedTxtValue(input.verificationToken)),
    checkAaaa(resolver, domain.hostname, input.cnameTarget),
    checkCaa(resolver, domain),
  ]);
  // CAA only blocks when Auto SSL needs a Let's Encrypt certificate; a lookup
  // error blocks too, because Let's Encrypt treats CAA SERVFAIL as a refusal.
  const caaCheck: RecordCheck = { ...caa, blocking: Boolean(opts.requireCaa) && caa.status !== "ok" };
  const records = [route, txt, aaaa, caaCheck];

  return {
    hostname: domain.hostname,
    checkedAt: new Date().toISOString(),
    resolvers: input.resolvers,
    passed: records.every((rec) => !rec.blocking || rec.status === "ok"),
    records,
  };
}
