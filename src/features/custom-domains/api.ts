/**
 * Typed client for /api/v1/custom-domains. Keeps the server's error envelope
 * (code, message, details) so the UI shows the real validation message and the
 * per-record DNS results of a 422. Auth is the httpOnly session cookie.
 */
import { clientLog } from "@/lib/client-log";
import type { CustomDomain, DnsCheckResult } from "./types";

export interface ApiFailure {
  ok: false;
  status: number;
  code: string;
  message: string;
  dnsCheck?: DnsCheckResult;
}
export type ApiResult<T> = { ok: true; data: T } | ApiFailure;

type Envelope<T> = { data: T | null; error: { code: string; message: string; details?: { dnsCheck?: DnsCheckResult } } | null };

async function call<T>(method: string, url: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      credentials: "same-origin",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json()) as Envelope<T>;
    if (!res.ok || json.error) {
      const failure: ApiFailure = {
        ok: false, status: res.status,
        code: json.error?.code ?? `HTTP_${res.status}`,
        message: json.error?.message ?? `Request failed (${res.status})`,
        dnsCheck: json.error?.details?.dnsCheck,
      };
      // 4xx are expected business outcomes (validation, DNS not ready); 5xx are real errors.
      if (res.status >= 500) clientLog.error(`${method} ${url} failed`, { status: res.status, code: failure.code });
      return failure;
    }
    return { ok: true, data: json.data as T };
  } catch (err) {
    clientLog.error(`${method} ${url} network error`, { err: String(err) });
    return { ok: false, status: 0, code: "NETWORK_ERROR", message: "Could not reach the server. Check your connection and try again." };
  }
}

export const customDomainsApi = {
  signIn: (apiKey: string) => call<{ ownerId: string }>("POST", "/api/session", { apiKey }),
  signOut: () => call<{ signedOut: true }>("DELETE", "/api/session"),
  list: () => call<CustomDomain[]>("GET", "/api/v1/custom-domains"),
  get: (id: string) => call<CustomDomain>("GET", `/api/v1/custom-domains/${id}`),
  add: (hostname: string, autoSsl: boolean) => call<CustomDomain>("POST", "/api/v1/custom-domains", { hostname, autoSsl }),
  testDns: (id: string) => call<DnsCheckResult>("POST", `/api/v1/custom-domains/${id}/dns-check`),
  verify: (id: string) => call<{ domain: CustomDomain; dnsCheck: DnsCheckResult }>("POST", `/api/v1/custom-domains/${id}/verify`),
  retrySsl: (id: string) => call<CustomDomain>("POST", `/api/v1/custom-domains/${id}/ssl/retry`),
  remove: (id: string) => call<{ id: string; status: "removing" | "deleted" }>("DELETE", `/api/v1/custom-domains/${id}`),
};
