/** Browser error reports, written to the server log (and the error log file). */
import { NextResponse } from "next/server";
import { clientIp } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

export async function POST(request: Request): Promise<NextResponse> {
  const limit = await checkRateLimit("client-logs", clientIp(request), { windowMs: 60_000, max: 60 });
  if (!limit.allowed) return NextResponse.json({ accepted: false }, { status: 429 });
  let body: { severity?: unknown; message?: unknown; attributes?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ accepted: false }, { status: 400 });
  }
  const severity = body.severity === "WARN" ? "WARN" : "ERROR";
  const message = typeof body.message === "string" ? body.message.slice(0, 500) : "client error";
  const attributes = body.attributes && typeof body.attributes === "object" ? (body.attributes as Record<string, unknown>) : {};
  logger.client(severity, message, { ...attributes, "client.ip": clientIp(request), "http.host": request.headers.get("host") });
  return NextResponse.json({ accepted: true }, { status: 202 });
}
