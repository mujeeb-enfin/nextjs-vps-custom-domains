import { beforeAll, describe, it, expect } from "vitest";
import { generateVerificationToken, buildRequiredRecords } from "./records";
import { resetPlatformConfigForTests } from "@/lib/env";

beforeAll(() => {
  process.env.NCD_RESOLVERS = "1.1.1.1";
  process.env.NCD_TXT_LABEL = "_acmepay-verify";
  process.env.REDIS_URL = "redis://unused";
  resetPlatformConfigForTests();
});

describe("generateVerificationToken", () => {
  it("is 32 lowercase base32 characters and unique", () => {
    const a = generateVerificationToken();
    expect(a).toMatch(/^[a-z2-7]{32}$/);
    expect(generateVerificationToken()).not.toBe(a);
  });
});

describe("buildRequiredRecords", () => {
  it("asks for a CNAME to the routing target and an ownership TXT, never an IP", () => {
    const [cname, txt] = buildRequiredRecords("checkout.acmestore.com", "tok", "domains.acmepay.io");
    expect(cname).toMatchObject({ id: "cname", type: "CNAME", host: "checkout", value: "domains.acmepay.io" });
    expect(cname.purpose).toContain("AcmePay");
    expect(txt).toMatchObject({ id: "txt", type: "TXT", host: "_acmepay-verify.checkout", value: "verify=tok" });
    expect(JSON.stringify([cname, txt])).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });

  it("uses @ for an apex domain", () => {
    expect(buildRequiredRecords("acmestore.com", "tok", "domains.acmepay.io")[0].host).toBe("@");
  });

  it("refuses a corrupted stored hostname", () => {
    expect(() => buildRequiredRecords("not a host", "tok", "domains.acmepay.io")).toThrow();
  });
});
