/**
 * POST /api/v1/custom-domains/{id}/dns-check ("Test my DNS").
 * Read-only: reports what public resolvers see now. No state change.
 * Has its own per-domain rate-limit budget, independent of Verify.
 */
import { NextResponse } from "next/server";
import { testDomainDns } from "@/modules/custom-domains/service";
import { authorize, json, fromServiceError, rateLimited, internalError } from "../../_shared";

export async function POST(request: Request, { params }: { params: Promise<{ domainId: string }> }): Promise<NextResponse> {
  try {
    const actor = await authorize(request, { write: true });
    if (actor instanceof NextResponse) return actor;
    const { domainId } = await params;
    const limited = await rateLimited("dnsCheck", `${actor.ownerId}:${domainId}`);
    if (limited) return limited;

    const result = await testDomainDns(domainId, actor.ownerId);
    return result.ok ? json(200, result.value) : fromServiceError(result.error);
  } catch (err) {
    return internalError("POST /api/v1/custom-domains/[domainId]/dns-check", err);
  }
}
