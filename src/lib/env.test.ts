import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { getPlatformConfig, resetPlatformConfigForTests, ConfigError } from "./env";

const KEYS = ["NCD_PLATFORM_NAME", "NCD_PLATFORM_DOMAINS", "NCD_CNAME_TARGET", "NCD_RESOLVERS", "NCD_TXT_LABEL", "REDIS_URL"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  Object.assign(process.env, {
    NCD_PLATFORM_NAME: "AcmePay", NCD_PLATFORM_DOMAINS: "acmepay.io, acmepay.com", NCD_CNAME_TARGET: "Domains.AcmePay.io.",
    NCD_RESOLVERS: "1.1.1.1,8.8.8.8", NCD_TXT_LABEL: "_acmepay-verify", REDIS_URL: "redis://localhost:6379",
  });
  resetPlatformConfigForTests();
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetPlatformConfigForTests();
});

describe("getPlatformConfig", () => {
  it("normalises hostnames", () => {
    const c = getPlatformConfig();
    expect(c.platformDomains).toEqual(["acmepay.io", "acmepay.com"]);
    expect(c.cnameTarget).toBe("domains.acmepay.io");
  });

  it.each(KEYS)("fails hard when %s is missing", (key) => {
    delete process.env[key];
    expect(() => getPlatformConfig()).toThrow(ConfigError);
  });

  it("refuses an IP address as the CNAME target", () => {
    process.env.NCD_CNAME_TARGET = "192.0.2.10";
    expect(() => getPlatformConfig()).toThrow(/hostnames only/);
  });

  it("refuses hostnames as resolvers and a malformed TXT label", () => {
    process.env.NCD_RESOLVERS = "dns.google";
    expect(() => getPlatformConfig()).toThrow(/resolver IP/);
    resetPlatformConfigForTests();
    process.env.NCD_RESOLVERS = "1.1.1.1";
    process.env.NCD_TXT_LABEL = "verify";
    expect(() => getPlatformConfig()).toThrow(/NCD_TXT_LABEL/);
  });
});
