/**
 * Server-side guard for requests on a tenant custom domain.
 *
 * The proxy limits WHICH paths a custom host can reach; this decides WHETHER
 * the resource belongs to the tenant that owns the host. Without it, tenant
 * A's domain could render tenant B's pages, which is a phishing vector.
 *
 * Use it in every public page or API that renders tenant data on a custom host.
 */
import { resolveHost } from "./host-resolver";
import { isPlatformHost } from "./hostname";

export type HostOwnership =
  | { allowed: true; customDomain: string | null; ownerId: string | null }
  | { allowed: false; reason: "UNKNOWN_HOST" | "NOT_SERVING" | "WRONG_OWNER" };

/**
 * resourceOwnerId = null means "whoever owns this host" (e.g. the tenant
 * landing page); otherwise the host must belong to that owner.
 */
export async function checkHostOwnership(rawHost: string | null | undefined, resourceOwnerId: string | null): Promise<HostOwnership> {
  // Platform hosts never touch Redis or the DB here.
  if (isPlatformHost(rawHost ?? "")) return { allowed: true, customDomain: null, ownerId: null };
  const resolved = await resolveHost(rawHost ?? "");
  if (resolved.kind === "platform") return { allowed: true, customDomain: null, ownerId: null };
  if (!resolved.ownerId) return { allowed: false, reason: "UNKNOWN_HOST" };
  if (!resolved.serving) return { allowed: false, reason: "NOT_SERVING" };
  if (resourceOwnerId && resolved.ownerId !== resourceOwnerId) return { allowed: false, reason: "WRONG_OWNER" };
  return { allowed: true, customDomain: resolved.hostname, ownerId: resolved.ownerId };
}

/**
 * For public API routes: a 404 response when the request arrived on a custom
 * domain that does not own the resource, or null to continue. 404 rather than
 * 403, so a foreign domain cannot probe which resource ids exist.
 */
export async function foreignHostResponse(request: Request, resourceOwnerId: string): Promise<Response | null> {
  const ownership = await checkHostOwnership(request.headers.get("host"), resourceOwnerId);
  if (ownership.allowed) return null;
  return Response.json({ data: null, error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });
}
