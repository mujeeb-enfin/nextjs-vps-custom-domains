import { beforeAll, describe, it, expect } from "vitest";
import { normalizeHostname, isPlatformHost } from "./hostname";
import { resetPlatformConfigForTests } from "@/lib/env";

beforeAll(() => {
  process.env.NCD_RESOLVERS = "1.1.1.1,8.8.8.8";
  process.env.NCD_TXT_LABEL = "_acmepay-verify";
  process.env.REDIS_URL = "redis://unused";
  resetPlatformConfigForTests();
});

function ok(input: string) {
  const r = normalizeHostname(input);
  if (!r.ok) throw new Error(`expected ok for ${input}, got ${r.code}`);
  return r.value;
}

const code = (input: string | null | undefined) => {
  const r = normalizeHostname(input);
  return r.ok ? "OK" : r.code;
};

describe("normalizeHostname", () => {
  it("normalises a tenant subdomain", () => {
    expect(ok("checkout.acmestore.com")).toEqual({
      hostname: "checkout.acmestore.com",
      registrableDomain: "acmestore.com",
      isApex: false,
      verificationRecordName: "_acmepay-verify.checkout.acmestore.com",
    });
  });

  it("strips scheme, path, port, case and trailing dot from pasted URLs", () => {
    expect(ok("https://Checkout.AcmeStore.com:443/pay/abc?x=1").hostname).toBe("checkout.acmestore.com");
    expect(ok("checkout.acmestore.com.").hostname).toBe("checkout.acmestore.com");
  });

  it("detects apex domains and multi-label public suffixes", () => {
    expect(ok("acmestore.com").isApex).toBe(true);
    const v = ok("pay.shop.co.uk");
    expect(v.registrableDomain).toBe("shop.co.uk");
    expect(v.isApex).toBe(false);
  });

  it("converts IDN to punycode", () => {
    expect(ok("pay.bücher.de").hostname).toBe("pay.xn--bcher-kva.de");
  });

  it("rejects empty input, IPs and wildcards", () => {
    expect(code("")).toBe("HOSTNAME_REQUIRED");
    expect(code(undefined)).toBe("HOSTNAME_REQUIRED");
    expect(code("192.0.2.10")).toBe("HOSTNAME_IS_IP");
    expect(code("[2001:db8::1]")).toBe("HOSTNAME_IS_IP");
    expect(code("*.acmestore.com")).toBe("HOSTNAME_WILDCARD");
  });

  it("rejects platform domains, their subdomains and Unicode look-alikes", () => {
    expect(code("acmepay.io")).toBe("HOSTNAME_PLATFORM");
    expect(code("checkout.acmepay.io")).toBe("HOSTNAME_PLATFORM");
    expect(code("AcmePay.io.")).toBe("HOSTNAME_PLATFORM");
    expect(code("аcmepay.com")).toBe("HOSTNAME_PLATFORM"); // Cyrillic a
    expect(code("notacmepay.io")).toBe("OK");
  });

  it("normalises full-width characters", () => {
    expect(ok("ｃｈｅｃｋｏｕｔ.acmestore.com").hostname).toBe("checkout.acmestore.com");
  });

  it("rejects userinfo, spaces, reserved names, public suffixes and unknown TLDs", () => {
    expect(code("user:pass@checkout.acmestore.com")).toBe("HOSTNAME_INVALID");
    expect(code("check out.acmestore.com")).toBe("HOSTNAME_INVALID");
    expect(code("localhost")).not.toBe("OK");
    expect(code("shop.local")).toBe("HOSTNAME_RESERVED");
    expect(code("co.uk")).toBe("HOSTNAME_PUBLIC_SUFFIX");
    expect(code("shop.notarealtld")).toBe("HOSTNAME_UNKNOWN_TLD");
  });

  it("rejects malformed labels and over-long names", () => {
    expect(code("-bad.acmestore.com")).toBe("HOSTNAME_INVALID");
    expect(code("a..acmestore.com")).toBe("HOSTNAME_INVALID");
    expect(code("under_score.acmestore.com")).toBe("HOSTNAME_INVALID");
    expect(code(`${"a".repeat(64)}.acmestore.com`)).toBe("HOSTNAME_INVALID");
    expect(code(`${Array(60).fill("abcd").join(".")}.com`)).toBe("HOSTNAME_TOO_LONG");
  });
});

describe("isPlatformHost", () => {
  it("recognises platform hosts and treats tenant domains as custom", () => {
    for (const h of ["acmepay.io", "app.acmepay.io:443", "localhost:3000", "127.0.0.1"]) expect(isPlatformHost(h)).toBe(true);
    expect(isPlatformHost("checkout.acmestore.com")).toBe(false);
    expect(isPlatformHost("acmepay.io.evil.com")).toBe(false);
  });
});
