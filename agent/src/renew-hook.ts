/**
 * certbot --deploy-hook. Runs as root, from certbot's renewal timer, after a
 * certificate for one of our domains is issued or renewed:
 *   1. re-check DNS still points here; if not, report dns_lost (domain-takeover guard)
 *   2. reload nginx so the new certificate is served
 *   3. report the new expiry to the app
 * certbot sets RENEWED_LINEAGE=/etc/letsencrypt/live/<cert-name>.
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { X509Certificate, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { Redis } from "ioredis";
import { loadConfig } from "./config.js";
import { initLog, log } from "./log.js";
import { pointsHere } from "./dns.js";
import { CERT_PREFIX } from "./hostname.js";

const RESULTS = "ncd:results";

async function main(): Promise<void> {
  const cfg = loadConfig();
  initLog(cfg.logFile);
  const lineage = process.env.RENEWED_LINEAGE;
  if (!lineage) throw new Error("RENEWED_LINEAGE not set: this must be run by certbot as a deploy hook");
  const name = basename(lineage);
  if (!name.startsWith(CERT_PREFIX)) return; // not a custom-domain certificate (e.g. the platform's own)

  const hostname = name.slice(CERT_PREFIX.length);
  const expiry = new Date(new X509Certificate(readFileSync(`${lineage}/cert.pem`, "utf8")).validTo).toISOString();
  const redis = new Redis(cfg.redisUrl, { maxRetriesPerRequest: 3 });
  try {
    // The app resolves domainId from the hostname for hook-originated results.
    const domainId = `hostname:${hostname}`;
    const dns = await pointsHere(hostname, cfg.cnameTarget, cfg.resolvers);
    if (!dns.ok && !dns.error) {
      await redis.lpush(RESULTS, JSON.stringify({ jobId: randomUUID(), type: "dns_lost", domainId, hostname, ok: true }));
      log.warn("renewed certificate but DNS no longer points here", { hostname });
      return;
    }
    execFileSync("/usr/bin/systemctl", ["reload", "nginx"], { stdio: "pipe" });
    await redis.lpush(RESULTS, JSON.stringify({ jobId: randomUUID(), type: "renewed", domainId, hostname, ok: true, sslExpiresAt: expiry }));
    log.info("certificate renewed", { hostname, expiry });
  } finally {
    redis.disconnect();
  }
}

main().catch((err) => {
  log.error("renew hook failed", { lineage: process.env.RENEWED_LINEAGE }, err);
  process.exit(1);
});
