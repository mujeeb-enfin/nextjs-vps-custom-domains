/** Liveness + dependency check for load balancers and the Docker healthcheck. */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { redis } from "@/lib/redis";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    await Promise.all([db().$queryRaw`SELECT 1`, redis().ping()]);
    return NextResponse.json({ status: "ok" });
  } catch (err) {
    logger.error("health check failed", {}, err);
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  }
}
