/**
 * Audit trail for custom-domain state changes. Domain ownership decides which
 * hostnames serve a tenant's pages, so every transition is recorded. Failures
 * propagate: an unaudited state change is not acceptable.
 */
import { db } from "@/lib/db";

export type CustomDomainAuditAction =
  | "custom_domain.created"
  | "custom_domain.verified"
  | "custom_domain.verify_failed"
  | "custom_domain.auto_ssl_changed"
  | "custom_domain.ssl_requested"
  | "custom_domain.removal_requested"
  | "custom_domain.removed"
  | `custom_domain.agent_${string}`;

export async function auditCustomDomain(params: {
  action: CustomDomainAuditAction;
  domainId: string;
  ownerId: string;
  actor: string;
  ipAddress: string;
  details: Record<string, unknown>;
}): Promise<void> {
  await db().domainAuditLog.create({
    data: {
      domainId: params.domainId,
      ownerId: params.ownerId,
      actor: params.actor,
      action: params.action,
      details: params.details as object,
      ipAddress: params.ipAddress,
    },
  });
}
