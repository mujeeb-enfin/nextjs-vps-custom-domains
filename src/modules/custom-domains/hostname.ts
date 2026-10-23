/**
 * Custom-domain hostname validation and normalisation.
 *
 * Turns raw user input into a canonical ASCII hostname and rejects anything the
 * platform must never serve or request a certificate for: IPs, localhost,
 * platform hosts (and Unicode look-alikes of them), bare public suffixes,
 * reserved TLDs and wildcards.
 */
import { domainToASCII } from "node:url";
import { parse } from "tldts";
import { getPlatformConfig } from "@/lib/env";

export type HostnameErrorCode =
  | "HOSTNAME_REQUIRED"
  | "HOSTNAME_INVALID"
  | "HOSTNAME_TOO_LONG"
  | "HOSTNAME_IS_IP"
  | "HOSTNAME_WILDCARD"
  | "HOSTNAME_RESERVED"
  | "HOSTNAME_PLATFORM"
  | "HOSTNAME_PUBLIC_SUFFIX"
  | "HOSTNAME_UNKNOWN_TLD";

export interface NormalizedHostname {
  /** Canonical lowercase ASCII (punycode) hostname, no trailing dot. */
  hostname: string;
  /** Registrable domain, e.g. acmestore.com for checkout.acmestore.com. */
  registrableDomain: string;
  /** True when hostname === registrableDomain (root/apex domain). */
  isApex: boolean;
  /** DNS name of the ownership TXT record. */
  verificationRecordName: string;
}

export type HostnameResult =
  | { ok: true; value: NormalizedHostname }
  | { ok: false; code: HostnameErrorCode; message: string };

/** RFC 2606 / RFC 6761 / RFC 6762 special-use names, plus common internal TLDs. */
const RESERVED_TLDS = new Set(["localhost", "local", "test", "example", "invalid", "internal", "lan", "home", "corp", "onion"]);

const LABEL_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

export const MAX_HOSTNAME_LENGTH = 253;

/**
 * Common Cyrillic/Greek look-alikes of Latin letters. Not a full Unicode
 * confusables table: it covers the letters typically used to spoof a brand.
 */
const LOOKALIKES: Record<string, string> = {
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x",
  "к": "k", "м": "m", "т": "t", "н": "h", "ѕ": "s", "і": "i", "ј": "j",
  "ԁ": "d", "ɡ": "g", "ո": "n", "ս": "u",
  "α": "a", "ο": "o", "ρ": "p", "τ": "t", "κ": "k", "υ": "u", "ν": "v",
};

function platformDomains(): string[] {
  return getPlatformConfig().platformDomains;
}

/** True when a non-ASCII hostname folds to a platform brand label (e.g. Cyrillic "аcmepay"). */
function impersonatesPlatform(unicodeHost: string): boolean {
  const lower = unicodeHost.normalize("NFKC").toLowerCase();
  if (/^[\x00-\x7f]*$/.test(lower)) return false;
  const folded = [...lower].map((ch) => LOOKALIKES[ch] ?? ch).join("").replace(/[^a-z0-9.-]/g, "");
  return platformDomains().some((p) => folded.includes(p.split(".")[0]));
}

function fail(code: HostnameErrorCode, message: string): HostnameResult {
  return { ok: false, code, message };
}

/** Strip scheme, path, port and trailing dot from pasted input like "https://Checkout.AcmeStore.com/". */
function stripInput(raw: string): string {
  let s = raw.trim();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  s = s.split(/[/?#]/)[0] ?? "";
  s = s.replace(/:\d+$/, "");
  return s.replace(/\.$/, "");
}

export function normalizeHostname(raw: string | null | undefined): HostnameResult {
  if (typeof raw !== "string" || raw.trim() === "") {
    return fail("HOSTNAME_REQUIRED", "Enter the domain you want to use, for example shop.yourcompany.com.");
  }

  const stripped = stripInput(raw);
  if (stripped.includes("*")) {
    return fail("HOSTNAME_WILDCARD", "Wildcard domains are not supported. Enter one exact hostname.");
  }
  if (/^\[?[0-9a-f:.]+\]?$/i.test(stripped) && (stripped.includes(":") || /^\d+(\.\d+){3}$/.test(stripped))) {
    return fail("HOSTNAME_IS_IP", "Enter a domain name, not an IP address.");
  }
  if (stripped.includes("@") || /\s/.test(stripped)) {
    return fail("HOSTNAME_INVALID", "This is not a valid domain name.");
  }

  const ascii = domainToASCII(stripped.toLowerCase());
  if (!ascii) return fail("HOSTNAME_INVALID", "This is not a valid domain name.");
  if (ascii.length > MAX_HOSTNAME_LENGTH) {
    return fail("HOSTNAME_TOO_LONG", `Domain names can be at most ${MAX_HOSTNAME_LENGTH} characters.`);
  }

  const labels = ascii.split(".");
  if (labels.length < 2 || !labels.every((l) => LABEL_RE.test(l))) {
    return fail("HOSTNAME_INVALID", "This is not a valid domain name.");
  }

  if (RESERVED_TLDS.has(labels[labels.length - 1])) {
    return fail("HOSTNAME_RESERVED", "Reserved or internal domain names cannot be used.");
  }

  const { platformName, txtLabel } = getPlatformConfig();
  if (platformDomains().some((p) => ascii === p || ascii.endsWith(`.${p}`))) {
    return fail("HOSTNAME_PLATFORM", `${platformName} domains cannot be used as a custom domain. Use a domain you own.`);
  }
  if (impersonatesPlatform(stripped)) {
    return fail("HOSTNAME_PLATFORM", `Domains that imitate ${platformName} cannot be used as a custom domain.`);
  }

  const parsed = parse(ascii, { allowPrivateDomains: true });
  if (!parsed.isIcann && !parsed.isPrivate) {
    return fail("HOSTNAME_UNKNOWN_TLD", "This domain does not use a recognised top-level domain.");
  }
  if (!parsed.domain) {
    return fail("HOSTNAME_PUBLIC_SUFFIX", "Enter a domain you own, not a public suffix such as co.uk.");
  }

  return {
    ok: true,
    value: {
      hostname: ascii,
      registrableDomain: parsed.domain,
      isApex: ascii === parsed.domain,
      verificationRecordName: `${txtLabel}.${ascii}`,
    },
  };
}

/** True for hosts served by the platform itself (never looked up as a custom domain). */
export function isPlatformHost(host: string): boolean {
  // Must agree with isPlatformHostEdge (edge-allowlist.ts): IP-literal and
  // bracketed IPv6 hosts are platform hosts, since tenants can only claim DNS names.
  const raw = host.trim().toLowerCase();
  if (!raw || raw.startsWith("[")) return true;
  const h = raw.split(":")[0].replace(/\.$/, "");
  if (!h || h === "localhost" || /^(\d{1,3}\.){3}\d{1,3}$/.test(h)) return true;
  return platformDomains().some((p) => h === p || h.endsWith(`.${p}`));
}
