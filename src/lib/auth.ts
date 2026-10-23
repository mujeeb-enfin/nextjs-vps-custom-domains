/**
 * API-key authentication.
 *
 * Keys look like `ncd_<40 base32 chars>`; only their SHA-256 hash is stored.
 * Requests authenticate with `Authorization: Bearer <key>` (API clients) or the
 * httpOnly `ncd_session` cookie set by /api/session (dashboard). Cookie-auth
 * writes additionally require a same-origin `Origin` header (CSRF guard).
 *
 * Replace this module with your own auth when integrating into an existing app:
 * the rest of the code only needs an `Actor`.
 */
import { timingSafeEqual } from "node:crypto";
import { db } from "./db";
import { hashKey, KEY_RE } from "./api-key";

export const SESSION_COOKIE = "ncd_session";

export interface Actor {
  ownerId: string;
  /** Who acted, for the audit log (key prefix, never the key). */
  actor: string;
  ipAddress: string;
}

export function clientIp(request: Request): string {
  return request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export type AuthFailure = { status: 401 | 403; code: "UNAUTHENTICATED" | "CSRF_REJECTED"; message: string };

/** Resolves the API key's owner, or a failure the route maps to 401/403. */
export async function authenticate(request: Request, opts: { write: boolean }): Promise<Actor | AuthFailure> {
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? null;
  const cookie = bearer ? null : readCookie(request, SESSION_COOKIE);
  const key = bearer ?? cookie;
  if (!key || !KEY_RE.test(key)) return { status: 401, code: "UNAUTHENTICATED", message: "A valid API key is required" };
  if (cookie && opts.write && !sameOrigin(request)) {
    return { status: 403, code: "CSRF_REJECTED", message: "Cross-origin request rejected" };
  }

  const hash = hashKey(key);
  const row = await db().apiKey.findUnique({ where: { hash }, select: { ownerId: true, prefix: true, hash: true, revokedAt: true } });
  if (!row || row.revokedAt || !timingSafeEqual(Buffer.from(row.hash), Buffer.from(hash))) {
    return { status: 401, code: "UNAUTHENTICATED", message: "A valid API key is required" };
  }
  return { ownerId: row.ownerId, actor: `api_key:${row.prefix}`, ipAddress: clientIp(request) };
}

export function isAuthFailure(v: Actor | AuthFailure): v is AuthFailure {
  return "code" in v;
}
