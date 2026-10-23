import { describe, it, expect } from "vitest";
import { INITIAL_STATE, panelReducer } from "./state";
import type { CustomDomain } from "./types";

const domain = (id: string, status: CustomDomain["status"] = "pending_dns"): CustomDomain => ({
  id, hostname: `${id}.acmestore.com`, status, autoSsl: true, isApex: false, verifiedAt: null, sslIssuedAt: null,
  sslExpiresAt: null, lastCheckedAt: null, lastError: null, createdAt: "2026-01-01T00:00:00Z", records: [],
});

describe("panelReducer", () => {
  it("upserts, applies status events and deletes", () => {
    let s = panelReducer(INITIAL_STATE, { type: "LOADED", domains: [domain("a")] });
    s = panelReducer(s, { type: "UPSERT", domain: domain("b") });
    expect(s.domains.map((d) => d.id)).toEqual(["a", "b"]);

    s = panelReducer(s, { type: "STATUS", event: { type: "custom_domain.status", domainId: "a", hostname: "a.acmestore.com", status: "active", lastError: null, at: "" } });
    expect(s.domains[0].status).toBe("active");

    s = panelReducer(s, { type: "CHECK", id: "b", check: { hostname: "b", checkedAt: "", resolvers: [], passed: false, records: [] } });
    s = panelReducer(s, { type: "DELETE", id: "b" });
    expect(s.domains.map((d) => d.id)).toEqual(["a"]);
    expect(s.checks.b).toBeUndefined();
  });

  it("does not touch other domains on a status event", () => {
    const loaded = panelReducer(INITIAL_STATE, { type: "LOADED", domains: [domain("a"), domain("b")] });
    const s = panelReducer(loaded,
      { type: "STATUS", event: { type: "custom_domain.status", domainId: "a", hostname: "", status: "ssl_failed", lastError: "x", at: "" } });
    // Same object reference, so the memoised card for "b" does not re-render.
    expect(s.domains[1]).toBe(loaded.domains[1]);
    expect(s.domains[0].lastError).toBe("x");
  });
});
