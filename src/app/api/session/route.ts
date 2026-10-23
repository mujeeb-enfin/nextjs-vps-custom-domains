/**
 * POST /api/session   { apiKey }  signs the dashboard in (httpOnly cookie).
 * DELETE /api/session             signs out.
 * The key is checked against the DB before the cookie is set.
 */
import { NextResponse } from "next/server";
import { authenticate, isAuthFailure, clientIp, SESSION_COOKIE } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { json, readJson, internalError } from "../v1/custom-domains/_shared";

const MAX_AGE_S = 8 * 3600;

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const limit = await checkRateLimit("session", clientIp(request), { windowMs: 15 * 60_000, max: 10 });
    if (!limit.allowed) return json(429, null, { code: "RATE_LIMITED", message: "Too many sign-in attempts. Try again later." });

    const body = await readJson(request);
    if (body instanceof NextResponse) return body;
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    const probe = new Request(request.url, { headers: { authorization: `Bearer ${apiKey}` } });
    const actor = await authenticate(probe, { write: false });
    if (isAuthFailure(actor)) return json(401, null, { code: "UNAUTHENTICATED", message: "That API key is not valid." });

    const res = json(200, { ownerId: actor.ownerId });
    res.cookies.set(SESSION_COOKIE, apiKey, {
      httpOnly: true, sameSite: "strict", path: "/", maxAge: MAX_AGE_S,
      secure: new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https",
    });
    return res;
  } catch (err) {
    return internalError("POST /api/session", err);
  }
}

export async function DELETE(): Promise<NextResponse> {
  const res = json(200, { signedOut: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "strict", path: "/", maxAge: 0 });
  return res;
}
