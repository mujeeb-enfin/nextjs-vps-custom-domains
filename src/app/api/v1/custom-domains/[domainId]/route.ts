import { NextResponse } from "next/server";
import { getDomain, setAutoSsl, removeDomain } from "@/modules/custom-domains/service";
import { authorize, json, fromServiceError, rateLimited, internalError, readJson } from "../_shared";

type Params = { params: Promise<{ domainId: string }> };

export async function GET(request: Request, { params }: Params): Promise<NextResponse> {
  try {
    const actor = await authorize(request, { write: false });
    if (actor instanceof NextResponse) return actor;
    const result = await getDomain((await params).domainId, actor.ownerId);
    return result.ok ? json(200, result.value) : fromServiceError(result.error);
  } catch (err) {
    return internalError("GET /api/v1/custom-domains/[domainId]", err);
  }
}

export async function PATCH(request: Request, { params }: Params): Promise<NextResponse> {
  try {
    const actor = await authorize(request, { write: true });
    if (actor instanceof NextResponse) return actor;
    const limited = await rateLimited("mutate", actor.ownerId);
    if (limited) return limited;

    const body = await readJson(request);
    if (body instanceof NextResponse) return body;
    if (typeof body.autoSsl !== "boolean") {
      return json(400, null, { code: "VALIDATION_ERROR", message: "autoSsl (boolean) is the only updatable field" });
    }
    const result = await setAutoSsl(actor, (await params).domainId, body.autoSsl);
    return result.ok ? json(200, result.value) : fromServiceError(result.error);
  } catch (err) {
    return internalError("PATCH /api/v1/custom-domains/[domainId]", err);
  }
}

export async function DELETE(request: Request, { params }: Params): Promise<NextResponse> {
  try {
    const actor = await authorize(request, { write: true });
    if (actor instanceof NextResponse) return actor;
    const limited = await rateLimited("mutate", actor.ownerId);
    if (limited) return limited;

    const result = await removeDomain(actor, (await params).domainId);
    if (!result.ok) return fromServiceError(result.error);
    return json(result.value.status === "deleted" ? 200 : 202, result.value);
  } catch (err) {
    return internalError("DELETE /api/v1/custom-domains/[domainId]", err);
  }
}
