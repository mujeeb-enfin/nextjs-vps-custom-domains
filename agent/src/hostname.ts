/**
 * Defence in depth: the agent never trusts hostnames from the queue. Even
 * though the app validates them, anything reaching nginx configs or certbot
 * arguments must be a plain lowercase ASCII DNS name that is not one of the
 * platform's own domains.
 */
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/** Prefix of every certificate name and vhost file the agent manages. */
export const CERT_PREFIX = "ncd-";

export function assertSafeHostname(hostname: unknown, platformDomains: readonly string[]): string {
  if (typeof hostname !== "string") throw new Error("hostname must be a string");
  const h = hostname.trim();
  if (h !== hostname || h.length > 253 || h !== h.toLowerCase()) throw new Error(`unsafe hostname: ${JSON.stringify(hostname)}`);
  const labels = h.split(".");
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) throw new Error(`unsafe hostname: ${JSON.stringify(hostname)}`);
  if (/^[0-9.]+$/.test(h)) throw new Error("IP addresses are not allowed");
  if ([...platformDomains, "localhost"].some((s) => h === s || h.endsWith(`.${s}`))) throw new Error(`platform hostname not allowed: ${h}`);
  return h;
}

/** certbot cert-name / vhost filename: always prefixed, so the agent only ever touches its own files. */
export function certName(hostname: string, platformDomains: readonly string[]): string {
  return `${CERT_PREFIX}${assertSafeHostname(hostname, platformDomains)}`;
}
