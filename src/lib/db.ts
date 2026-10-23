/** Prisma client (pg driver adapter). DATABASE_URL is required. */
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

declare global {
  var __ncd_prisma: PrismaClient | undefined;
}

export function db(): PrismaClient {
  if (globalThis.__ncd_prisma) return globalThis.__ncd_prisma;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  globalThis.__ncd_prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  return globalThis.__ncd_prisma;
}
