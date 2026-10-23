import { describe, it, expect } from "vitest";
import { isPlatformHostEdge, isAllowedOnCustomHost } from "./edge-allowlist";

describe("isPlatformHostEdge", () => {
  it("treats platform domains, localhost and IP literals as the platform", () => {
    for (const h of ["acmepay.io", "app.acmepay.io", "localhost:3000", "127.0.0.1:3000", "[::1]:3000"]) {
      expect(isPlatformHostEdge(h)).toBe(true);
    }
  });
  it("treats everything else as a tenant domain", () => {
    expect(isPlatformHostEdge("checkout.acmestore.com")).toBe(false);
    expect(isPlatformHostEdge("acmepay.io.evil.com")).toBe(false);
  });
});

describe("isAllowedOnCustomHost", () => {
  it.each(["/", "/hosted", "/api/health", "/api/client-logs"])("allows %s", (p) => expect(isAllowedOnCustomHost(p)).toBe(true));
  it.each(["/api/v1/custom-domains", "/api/session", "/api/v1/custom-domains/events", "/admin", "/hosted/../api"])(
    "blocks %s", (p) => expect(isAllowedOnCustomHost(p)).toBe(false),
  );
});
