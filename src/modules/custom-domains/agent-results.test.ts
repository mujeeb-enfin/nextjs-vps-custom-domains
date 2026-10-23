import { describe, it, expect } from "vitest";
import { parseAgentResult } from "./agent-results";

const base = { jobId: "j1", domainId: "d1", hostname: "checkout.acmestore.com" };

describe("parseAgentResult", () => {
  it("accepts every result shape the agent sends", () => {
    expect(parseAgentResult(JSON.stringify({ ...base, type: "provision", ok: true, autoSsl: true, sslExpiresAt: null }))).not.toBeNull();
    expect(parseAgentResult(JSON.stringify({ ...base, type: "provision", ok: false, autoSsl: true, error: "x" }))).not.toBeNull();
    expect(parseAgentResult(JSON.stringify({ ...base, type: "teardown", ok: true }))).not.toBeNull();
    expect(parseAgentResult(JSON.stringify({ ...base, type: "renewed", ok: true, sslExpiresAt: "2030-01-01T00:00:00Z" }))).not.toBeNull();
    expect(parseAgentResult(JSON.stringify({ ...base, type: "dns_lost", ok: true }))).not.toBeNull();
  });

  it.each([
    "not json",
    JSON.stringify({ ...base, type: "unknown", ok: true }),
    JSON.stringify({ ...base, type: "provision", ok: false, autoSsl: true }),
    JSON.stringify({ ...base, type: "provision", ok: true }),
    JSON.stringify({ ...base, type: "renewed", ok: true }),
    JSON.stringify({ type: "teardown", ok: true }),
  ])("rejects malformed %s", (raw) => {
    expect(parseAgentResult(raw)).toBeNull();
  });
});
