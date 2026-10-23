/**
 * Request rules for traffic arriving on a tenant's custom domain, applied by
 * src/proxy.ts BEFORE any tenant lookup. On a custom host only the public,
 * tenant-facing surfaces are reachable; the dashboard and private APIs never
 * are. Whether the resource belongs to the domain's owner is enforced later,
 * server-side (ownership.ts).
 *
 * No Node-only imports, so this also works if the proxy runs on the Edge runtime.
 */

function platformDomainsFromEnv(): string[] {
  const raw = process.env.NCD_PLATFORM_DOMAINS ?? "";
  const list = raw.split(",").map((s) => s.trim().toLowerCase().replace(/\.$/, "")).filter(Boolean);
  if (list.length === 0) throw new Error("NCD_PLATFORM_DOMAINS is required");
  return list;
}

/** True for hosts served by the platform itself (not a tenant domain). */
export function isPlatformHostEdge(rawHost: string): boolean {
  const h = rawHost.split(":")[0].toLowerCase().replace(/\.$/, "");
  if (!h || h === "localhost" || /^(\d{1,3}\.){3}\d{1,3}$/.test(h) || rawHost.startsWith("[")) return true;
  return platformDomainsFromEnv().some((p) => h === p || h.endsWith(`.${p}`));
}

/** The path a custom-domain request is rewritten to. "/" shows the tenant's hosted page. */
export const HOSTED_ROOT = "/hosted";

const PAGE_PATTERNS: RegExp[] = [
  /^\/$/,                       // tenant landing page (rewritten to /hosted)
  /^\/hosted(\/[a-z0-9-]+)?$/,  // hosted pages
];

const API_PATTERNS: RegExp[] = [
  /^\/api\/health$/,
  /^\/api\/client-logs$/,       // browser error reporting from hosted pages
];

export function isAllowedOnCustomHost(pathname: string): boolean {
  return PAGE_PATTERNS.some((re) => re.test(pathname)) || API_PATTERNS.some((re) => re.test(pathname));
}
