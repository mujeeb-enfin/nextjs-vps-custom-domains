/**
 * E2E helpers. Owners and API keys are created in the real database the app
 * uses (DATABASE_URL) and removed afterwards (cascade deletes their domains).
 * Plain `pg` here: Playwright loads specs as CommonJS, and the generated
 * Prisma client is ESM-only.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { Redis } from "ioredis";
import { generateApiKey } from "../src/lib/api-key";

export interface TestOwner {
  id: string;
  apiKey: string;
}

let client: pg.Client | null = null;

async function sql(): Promise<pg.Client> {
  if (client) return client;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for the E2E suite");
  client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}

export async function createOwner(name: string, maxDomains = 10): Promise<TestOwner> {
  const c = await sql();
  const { key, prefix, hash } = generateApiKey();
  const id = `e2e_${randomUUID()}`;
  await c.query('INSERT INTO "Owner" (id, name, "maxDomains") VALUES ($1, $2, $3)', [id, name, maxDomains]);
  await c.query('INSERT INTO "ApiKey" (id, "ownerId", prefix, hash) VALUES ($1, $2, $3, $4)', [randomUUID(), id, prefix, hash]);
  return { id, apiKey: key };
}

export async function deleteOwner(id: string): Promise<void> {
  const c = await sql();
  await c.query('DELETE FROM "DomainAuditLog" WHERE "ownerId" = $1', [id]);
  await c.query('DELETE FROM "Owner" WHERE id = $1', [id]);
}

/**
 * Clears this suite's own rate-limit counters so repeated local runs start from
 * a known state. Point REDIS_URL at a database used only for E2E.
 */
export async function resetRateLimits(): Promise<void> {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is required for the E2E suite");
  const r = new Redis(url, { maxRetriesPerRequest: 3 });
  try {
    const keys = await r.keys("ncd:rl:*");
    if (keys.length) await r.del(...keys);
  } finally {
    r.disconnect();
  }
}

export async function disconnect(): Promise<void> {
  await client?.end();
  client = null;
}
