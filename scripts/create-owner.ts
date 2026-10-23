/**
 * Creates an owner (tenant) and prints a new API key once.
 *
 *   npm run owner:create -- "Acme Store" [maxDomains]
 *
 * Only the key's SHA-256 hash is stored; the printed key cannot be recovered.
 */
import "dotenv/config";
import { db } from "../src/lib/db";
import { generateApiKey } from "../src/lib/api-key";

async function main(): Promise<void> {
  const [name, maxArg] = process.argv.slice(2);
  if (!name?.trim()) throw new Error('usage: npm run owner:create -- "<owner name>" [maxDomains]');
  const maxDomains = maxArg === undefined ? 10 : Number(maxArg);
  if (!Number.isInteger(maxDomains) || maxDomains < 0) throw new Error("maxDomains must be a non-negative integer");

  const { key, prefix, hash } = generateApiKey();
  const owner = await db().owner.create({ data: { name: name.trim(), maxDomains, apiKeys: { create: { prefix, hash } } } });
  process.stdout.write(`Owner ${owner.id} created (${owner.name}, up to ${maxDomains} domains).\nAPI key (shown once): ${key}\n`);
  await db().$disconnect();
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
