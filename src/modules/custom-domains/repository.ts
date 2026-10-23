/**
 * Custom-domain persistence. Every query is tenant-scoped by ownerId except
 * the hostname lookups used by request routing.
 */
import { db } from "@/lib/db";
import type { CustomDomainRecord, CustomDomainStatus } from "./types";

type Row = Omit<CustomDomainRecord, "status"> & { status: string };

function toRecord(row: Row): CustomDomainRecord {
  return { ...row, status: row.status as CustomDomainStatus };
}

export async function listCustomDomains(ownerId: string): Promise<CustomDomainRecord[]> {
  const rows = await db().customDomain.findMany({ where: { ownerId }, orderBy: { createdAt: "asc" } });
  return rows.map(toRecord);
}

export async function countCustomDomains(ownerId: string): Promise<number> {
  return db().customDomain.count({ where: { ownerId } });
}

export async function getAllowance(ownerId: string): Promise<number> {
  const owner = await db().owner.findUnique({ where: { id: ownerId }, select: { maxDomains: true } });
  if (!owner) throw new Error(`Owner ${ownerId} not found`);
  return owner.maxDomains;
}

/** Returns null for missing rows AND rows owned by someone else (callers answer 404 either way). */
export async function getCustomDomainForOwner(id: string, ownerId: string): Promise<CustomDomainRecord | null> {
  const row = await db().customDomain.findFirst({ where: { id, ownerId } });
  return row ? toRecord(row) : null;
}

export async function getCustomDomainByHostname(hostname: string): Promise<CustomDomainRecord | null> {
  const row = await db().customDomain.findUnique({ where: { hostname } });
  return row ? toRecord(row) : null;
}

export async function createCustomDomain(data: {
  ownerId: string;
  hostname: string;
  verificationToken: string;
  autoSsl: boolean;
  isApex: boolean;
}): Promise<CustomDomainRecord> {
  return toRecord(await db().customDomain.create({ data: { ...data, status: "pending_dns" } }));
}

export type CustomDomainUpdate = Partial<Pick<CustomDomainRecord,
  "status" | "autoSsl" | "verifiedAt" | "sslIssuedAt" | "sslExpiresAt" | "lastCheckedAt" | "lastError">>;

/**
 * Conditional update: only applies while the row is still in one of
 * `fromStatuses`. Returns null when the precondition failed (a concurrent
 * transition), so callers answer 409 instead of overwriting newer state.
 */
export async function transitionCustomDomain(
  id: string,
  ownerId: string | null,
  fromStatuses: readonly CustomDomainStatus[],
  data: CustomDomainUpdate,
): Promise<CustomDomainRecord | null> {
  const where = { id, status: { in: [...fromStatuses] }, ...(ownerId ? { ownerId } : {}) };
  const { count } = await db().customDomain.updateMany({ where, data });
  if (count === 0) return null;
  const row = await db().customDomain.findUnique({ where: { id } });
  return row ? toRecord(row) : null;
}

/** Deletes only a domain that was never verified (nothing installed on the host). */
export async function deleteNeverVerified(id: string, ownerId: string): Promise<number> {
  const { count } = await db().customDomain.deleteMany({ where: { id, ownerId, status: "pending_dns", verifiedAt: null } });
  return count;
}

/** Final delete after the agent removed the vhost and certificate. */
export async function deleteRemoving(id: string): Promise<CustomDomainRecord | null> {
  const row = await db().customDomain.findUnique({ where: { id } });
  if (!row) return null;
  const { count } = await db().customDomain.deleteMany({ where: { id, status: "removing" } });
  return count === 1 ? toRecord(row) : null;
}
