/**
 * DNS verifier against REAL public DNS (no mocks). Uses long-lived public
 * records whose shape is stable:
 *   - www.github.com  CNAME github.com            (a real CNAME)
 *   - cloudflare.com  A in Cloudflare proxy ranges (proxied, no CNAME)
 *   - dns.google      plain A records, no CNAME
 * plus a guaranteed-nonexistent label under example.com for "missing".
 *
 * Set NCD_E2E_HOST / NCD_E2E_TOKEN to also run a full pass against your own
 * domain CNAMEd to NCD_CNAME_TARGET.
 */
import { beforeAll, describe, it, expect } from "vitest";
import { checkDomainDns, isCloudflareIp, expectedTxtValue } from "./dns-verifier";
import { normalizeHostname } from "./hostname";
import { resetPlatformConfigForTests } from "@/lib/env";

const RESOLVERS = ["1.1.1.1", "8.8.8.8"];

beforeAll(() => {
  process.env.NCD_RESOLVERS = RESOLVERS.join(",");
  process.env.NCD_TXT_LABEL = "_acmepay-verify";
  process.env.REDIS_URL = "redis://unused";
  resetPlatformConfigForTests();
});

function domain(h: string) {
  const r = normalizeHostname(h);
  if (!r.ok) throw new Error(r.code);
  return r.value;
}

const routeOf = (res: Awaited<ReturnType<typeof checkDomainDns>>) => res.records.find((r) => r.kind === "cname")!;

describe("isCloudflareIp", () => {
  it("classifies addresses", () => {
    expect(isCloudflareIp("104.21.3.7")).toBe(true);
    expect(isCloudflareIp("172.67.1.1")).toBe(true);
    expect(isCloudflareIp("188.114.112.1")).toBe(false);
    expect(isCloudflareIp("not-an-ip")).toBe(false);
  });
});

describe("checkDomainDns (live DNS)", () => {
  it("passes a CNAME that points at the routing target", async () => {
    const res = await checkDomainDns({ domain: domain("www.github.com"), verificationToken: "x", cnameTarget: "github.com", resolvers: RESOLVERS });
    expect(routeOf(res).status).toBe("ok");
  }, 20000);

  it("rejects a CNAME to a different target, naming only hostnames", async () => {
    const res = await checkDomainDns({ domain: domain("www.github.com"), verificationToken: "x", cnameTarget: "example.com", resolvers: RESOLVERS });
    expect(routeOf(res).status).toBe("mismatch");
    expect(routeOf(res).message).toContain("Change it to example.com");
  }, 20000);

  it("explains a Cloudflare-proxied hostname without exposing any IP", async () => {
    const res = await checkDomainDns({ domain: domain("cloudflare.com"), verificationToken: "x", cnameTarget: "example.com", resolvers: RESOLVERS });
    expect(routeOf(res).status).toBe("mismatch");
    expect(routeOf(res).message).toContain("grey cloud");
    expect(routeOf(res).message).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  }, 20000);

  it("tells a hostname with plain A records to replace them with the CNAME", async () => {
    const res = await checkDomainDns({ domain: domain("dns.google"), verificationToken: "x", cnameTarget: "example.com", resolvers: RESOLVERS });
    expect(routeOf(res).status).toBe("mismatch");
    expect(routeOf(res).message).toContain("CNAME to example.com");
    expect(routeOf(res).message).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  }, 20000);

  it("reports missing CNAME and TXT records and does not pass", async () => {
    const res = await checkDomainDns({
      domain: domain(`ncd-missing-${Date.now()}.example.com`), verificationToken: "tok", cnameTarget: "example.com", resolvers: RESOLVERS,
    });
    expect(res.passed).toBe(false);
    expect(routeOf(res).status).toBe("missing");
    expect(res.records.find((r) => r.kind === "txt")!.status).toBe("missing");
  }, 20000);

  const e2eHost = process.env.NCD_E2E_HOST;
  it.runIf(Boolean(e2eHost))("passes for your configured real domain", async () => {
    const res = await checkDomainDns({
      domain: domain(e2eHost!), verificationToken: process.env.NCD_E2E_TOKEN!,
      cnameTarget: process.env.NCD_CNAME_TARGET!, resolvers: RESOLVERS,
    }, { requireCaa: true });
    expect(res.records.find((r) => r.kind === "txt")!.expected).toBe(expectedTxtValue(process.env.NCD_E2E_TOKEN!));
    expect(res.passed).toBe(true);
  }, 20000);
});
