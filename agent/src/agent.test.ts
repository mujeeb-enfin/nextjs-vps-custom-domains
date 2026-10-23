/** Agent unit tests (run from the repo root with vitest; no host side effects). */
import { describe, it, expect } from "vitest";
import { mkdtempSync, copyFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertSafeHostname, certName } from "./hostname";
import { renderVhost } from "./nginx";
import { explainAcmeError } from "./handlers";
import type { AgentConfig } from "./config";

const PLATFORM = ["acmepay.io"];

describe("assertSafeHostname", () => {
  it("accepts plain tenant hostnames", () => {
    expect(assertSafeHostname("checkout.acmestore.com", PLATFORM)).toBe("checkout.acmestore.com");
    expect(certName("checkout.acmestore.com", PLATFORM)).toBe("ncd-checkout.acmestore.com");
  });

  it.each([
    "Checkout.AcmeStore.com", " checkout.acmestore.com", "checkout.acmestore.com;rm -rf /",
    "a.b.c/../../etc", "checkout.acmestore.com\nserver_name evil", "192.0.2.10", "pay.acmepay.io", "acmepay.io",
    "localhost", "*.acmestore.com", "x".repeat(254),
  ])("rejects %j", (bad) => {
    expect(() => assertSafeHostname(bad, PLATFORM)).toThrow();
  });

  it("rejects non-strings", () => {
    expect(() => assertSafeHostname(42, PLATFORM)).toThrow();
    expect(() => assertSafeHostname(undefined, PLATFORM)).toThrow();
  });
});

describe("renderVhost", () => {
  const dir = mkdtempSync(join(tmpdir(), "ncd-tpl-"));
  const src = join(__dirname, "..", "templates");
  for (const f of readdirSync(src)) copyFileSync(join(src, f), join(dir, f));
  const cfg: AgentConfig = {
    redisUrl: "redis://unused", upstream: "127.0.0.1:3000", vhostDir: "/unused", acmeWebroot: "/var/www/ncd-acme",
    acmeEmail: "ops@acmepay.io", acmeStaging: true, cnameTarget: "domains.acmepay.io", platformDomains: PLATFORM,
    resolvers: ["1.1.1.1"], templatesDir: dir, logFile: "/unused",
  };

  it("renders an HTTPS vhost bound only to the tenant hostname", () => {
    const conf = renderVhost(cfg, "checkout.acmestore.com", "https");
    expect(conf).toContain("server_name checkout.acmestore.com;");
    expect(conf).toContain("/etc/letsencrypt/live/ncd-checkout.acmestore.com/fullchain.pem");
    expect(conf).toContain("proxy_pass         http://127.0.0.1:3000;");
    expect(conf).not.toMatch(/\{\{\w+\}\}/);
    expect(conf).not.toContain("default_server");
  });

  it("renders the ACME-only and external-SSL variants without placeholders or TLS listeners", () => {
    for (const mode of ["acme", "http-external-ssl"] as const) {
      const conf = renderVhost(cfg, "checkout.acmestore.com", mode);
      expect(conf).toContain("server_name checkout.acmestore.com;");
      expect(conf).not.toMatch(/\{\{\w+\}\}/);
      expect(conf).not.toContain("listen 443");
    }
  });

  it("refuses unsafe and platform hostnames before touching templates", () => {
    expect(() => renderVhost(cfg, "evil.com;\n}", "https")).toThrow();
    expect(() => renderVhost(cfg, "api.acmepay.io", "https")).toThrow();
  });
});

describe("explainAcmeError", () => {
  it.each([
    ["CAA record for acmestore.com prevents issuance", "CAA"],
    ["too many certificates already issued", "rate limit"],
    ["DNS problem: NXDOMAIN looking up A", "resolve your domain"],
    ["Connection refused", "port 80"],
  ])("maps %j", (stderr, hint) => {
    const msg = explainAcmeError(stderr);
    expect(msg).toContain(hint);
    expect(msg).toContain(stderr);
  });
});
