/** Verification token generation and the DNS records shown to the tenant. */
import { randomBytes } from "node:crypto";
import { getPlatformConfig } from "@/lib/env";
import { normalizeHostname } from "./hostname";
import { expectedTxtValue } from "./dns-verifier";
import type { RequiredDnsRecord } from "./types";

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/** 160-bit random token, lowercase base32 (DNS-safe, case-insensitive). */
export function generateVerificationToken(): string {
  const bytes = randomBytes(20);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/** "checkout.acmestore.com" relative to "acmestore.com" is "checkout"; the apex is "@". */
function relativeHost(fqdn: string, registrableDomain: string): string {
  if (fqdn === registrableDomain) return "@";
  return fqdn.slice(0, -(registrableDomain.length + 1));
}

export function buildRequiredRecords(hostname: string, verificationToken: string, cnameTarget: string): RequiredDnsRecord[] {
  const parsed = normalizeHostname(hostname);
  if (!parsed.ok) {
    // Stored hostnames are validated on write; reaching this means corrupted data.
    throw new Error(`Stored custom domain hostname is invalid: ${hostname} (${parsed.code})`);
  }
  const { registrableDomain, verificationRecordName } = parsed.value;
  const { platformName } = getPlatformConfig();
  return [
    {
      id: "cname",
      type: "CNAME",
      name: hostname,
      host: relativeHost(hostname, registrableDomain),
      value: cnameTarget,
      purpose: `Sends traffic for ${hostname} to ${platformName}`,
    },
    {
      id: "txt",
      type: "TXT",
      name: verificationRecordName,
      host: relativeHost(verificationRecordName, registrableDomain),
      value: expectedTxtValue(verificationToken),
      purpose: `Proves you own ${hostname}`,
    },
  ];
}
