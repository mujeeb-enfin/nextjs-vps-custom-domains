/**
 * GET /api/v1/custom-domains/events: Server-Sent Events stream of the owner's
 * custom-domain status changes (agent results, verify, removal). Driven by
 * Redis pub/sub; the dashboard opens one EventSource.
 */
import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { subscribeToDomainStatus } from "@/modules/custom-domains/events";
import { authorize, internalError } from "../_shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const actor = await authorize(request, { write: false });
    if (actor instanceof NextResponse) return actor;
    const { ownerId } = actor;
    const encoder = new TextEncoder();

    let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
    let closed = false;
    const send = (event: string, data: unknown) => {
      if (closed || !controllerRef) return;
      try {
        controllerRef.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      } catch (err) {
        closed = true;
        logger.warn("domain event stream send failed", { ownerId, err: String(err) });
      }
    };
    // Subscribe BEFORE opening the stream, so a Redis failure becomes a 503 instead of a hung EventSource.
    const unsubscribe = await subscribeToDomainStatus(ownerId, (e) => send("status", e));
    const release = () => {
      if (closed) return;
      closed = true;
      unsubscribe();
    };

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controllerRef = controller;
        send("ready", { ownerId });
        request.signal.addEventListener("abort", () => {
          release();
          try {
            controller.close();
          } catch (err) {
            // The runtime may already have closed it (ERR_INVALID_STATE); anything else is real.
            if ((err as { code?: string }).code !== "ERR_INVALID_STATE") logger.error("domain event stream close failed", { ownerId }, err);
          }
        }, { once: true });
      },
      cancel() {
        release();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    return internalError("GET /api/v1/custom-domains/events", err);
  }
}
