import { NextResponse } from "next/server";
import { listDomains, addDomain } from "@/modules/custom-domains/service";
import { authorize, json, fromServiceError, rateLimited, internalError, readJson } from "./_shared";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const actor = await authorize(request, { write: false });
    if (actor instanceof NextResponse) return actor;
    return json(200, await listDomains(actor.ownerId));
  } catch (err) {
    return internalError("GET /api/v1/custom-domains", err);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const actor = await authorize(request, { write: true });
    if (actor instanceof NextResponse) return actor;
    const limited = await rateLimited("mutate", actor.ownerId);
    if (limited) return limited;

    const body = await readJson(request);
    if (body instanceof NextResponse) return body;
    if (body.autoSsl !== undefined && typeof body.autoSsl !== "boolean") {
      return json(400, null, { code: "VALIDATION_ERROR", message: "autoSsl must be a boolean" });
    }

    const result = await addDomain(actor, body.hostname, body.autoSsl !== false);
    return result.ok ? json(201, result.value) : fromServiceError(result.error);
  } catch (err) {
    return internalError("POST /api/v1/custom-domains", err);
  }
}
