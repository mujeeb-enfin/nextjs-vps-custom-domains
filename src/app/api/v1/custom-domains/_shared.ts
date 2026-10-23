/**
 * Shared plumbing for /api/v1/custom-domains: auth, rate limits, the JSON
 * envelope and ServiceError to HTTP mapping.
 */
import { NextResponse } from "next/server";
import { authenticate, isAuthFailure, type Actor } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { ConfigError } from "@/lib/env";
import { logger } from "@/lib/logger";
import type { ServiceError } from "@/modules/custom-domains/service";

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export function json<T>(status: number, data: T | null, error: ApiError | null = null): NextResponse {
  return NextResponse.json({ data, error }, { status });
}

export async function authorize(request: Request, opts: { write: boolean }): Promise<Actor | NextResponse> {
  const auth = await authenticate(request, opts);
  if (isAuthFailure(auth)) return json(auth.status, null, { code: auth.code, message: auth.message });
  return auth;
}

export function fromServiceError(err: ServiceError): NextResponse {
  const details = err.code === "DNS_NOT_READY" ? { dnsCheck: err.dnsCheck } : undefined;
  return json(err.status, null, { code: err.code, message: err.message, ...(details ? { details } : {}) });
}

/** Separate budgets so Test-my-DNS never consumes Verify's allowance. */
export const LIMITS = {
  verify: { windowMs: 60_000, max: 10 },
  dnsCheck: { windowMs: 60_000, max: 30 },
  mutate: { windowMs: 60_000, max: 20 },
} as const;

export async function rateLimited(bucket: keyof typeof LIMITS, key: string): Promise<NextResponse | null> {
  const res = await checkRateLimit(`custom-domains:${bucket}`, key, LIMITS[bucket]);
  if (res.allowed) return null;
  const response = json(429, null, { code: "RATE_LIMITED", message: "Too many requests. Please wait a minute and try again." });
  response.headers.set("Retry-After", String(Math.ceil(res.retryAfterMs / 1000)));
  return response;
}

export function internalError(route: string, err: unknown): NextResponse {
  if (err instanceof ConfigError) {
    logger.error(`${route} misconfigured`, {}, err);
    return json(503, null, { code: err.code, message: "Custom domains are not configured on this server" });
  }
  logger.error(`${route} failed`, {}, err);
  return json(500, null, { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." });
}

export async function readJson(request: Request): Promise<Record<string, unknown> | NextResponse> {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("not an object");
    return body as Record<string, unknown>;
  } catch {
    return json(400, null, { code: "VALIDATION_ERROR", message: "Request body must be a JSON object" });
  }
}
