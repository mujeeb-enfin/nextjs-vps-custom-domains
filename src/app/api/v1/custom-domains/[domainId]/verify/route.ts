/**
 * POST /api/v1/custom-domains/{id}/verify: a live DNS check that, on success,
 * moves the domain forward and queues provisioning. Answers 422 with
 * per-record results when the records are not ready.
 */
import { NextResponse } from "next/server";
import { verifyDomain } from "@/modules/custom-domains/service";
import { authorize, json, fromServiceError, rateLimited, internalError } from "../../_shared";

export async function POST(request: Request, { params }: { params: Promise<{ domainId: string }> }): Promise<NextResponse> {
  try {
    const actor = await authorize(request, { write: true });
    if (actor instanceof NextResponse) return actor;
    const limited = await rateLimited("verify", actor.ownerId);
    if (limited) return limited;

    const result = await verifyDomain(actor, (await params).domainId);
    return result.ok ? json(200, result.value) : fromServiceError(result.error);
  } catch (err) {
    return internalError("POST /api/v1/custom-domains/[domainId]/verify", err);
  }
}
