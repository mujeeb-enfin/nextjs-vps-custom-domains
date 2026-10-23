import { NextResponse } from "next/server";
import { retrySsl } from "@/modules/custom-domains/service";
import { authorize, json, fromServiceError, rateLimited, internalError } from "../../../_shared";

export async function POST(request: Request, { params }: { params: Promise<{ domainId: string }> }): Promise<NextResponse> {
  try {
    const actor = await authorize(request, { write: true });
    if (actor instanceof NextResponse) return actor;
    const limited = await rateLimited("verify", actor.ownerId);
    if (limited) return limited;

    const result = await retrySsl(actor, (await params).domainId);
    return result.ok ? json(202, result.value) : fromServiceError(result.error);
  } catch (err) {
    return internalError("POST /api/v1/custom-domains/[domainId]/ssl/retry", err);
  }
}
