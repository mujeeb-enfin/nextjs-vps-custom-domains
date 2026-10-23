/**
 * Domain status push channel.
 *
 * Every state change is PUBLISHed on `ncd:events`. Each app instance holds ONE
 * Redis subscriber and fans messages out to its open SSE streams, so the
 * dashboard updates live on every instance behind a load balancer.
 */
import { EventEmitter } from "node:events";
import { redis, dedicatedRedis, KEYS } from "@/lib/redis";
import { logger } from "@/lib/logger";
import type { CustomDomainStatus } from "./types";

export interface DomainStatusEvent {
  type: "custom_domain.status";
  domainId: string;
  ownerId: string;
  hostname: string;
  status: CustomDomainStatus;
  lastError: string | null;
  at: string;
}

declare global {
  var __ncd_events: { emitter: EventEmitter; subscribed: Promise<void> | null } | undefined;
}

function state() {
  if (!globalThis.__ncd_events) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(0);
    globalThis.__ncd_events = { emitter, subscribed: null };
  }
  return globalThis.__ncd_events;
}

function isDomainStatusEvent(v: unknown): v is DomainStatusEvent {
  const e = v as Partial<DomainStatusEvent> | null;
  return !!e && e.type === "custom_domain.status" && typeof e.ownerId === "string"
    && typeof e.domainId === "string" && typeof e.status === "string";
}

/** Start the per-process subscriber once. SUBSCRIBE needs a dedicated connection. */
async function ensureSubscribed(): Promise<void> {
  const s = state();
  if (s.subscribed) return s.subscribed;
  s.subscribed = (async () => {
    const sub = dedicatedRedis("status-subscriber");
    sub.on("message", (_channel: string, raw: string) => {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (isDomainStatusEvent(parsed)) s.emitter.emit(parsed.ownerId, parsed);
        else logger.warn("ignored malformed status event", { raw: raw.slice(0, 200) });
      } catch (err) {
        logger.error("status event parse failed", { raw: raw.slice(0, 200) }, err);
      }
    });
    await sub.subscribe(KEYS.events);
  })().catch((err: unknown) => {
    s.subscribed = null; // the next stream retries the subscription
    throw err;
  });
  return s.subscribed;
}

export async function subscribeToDomainStatus(ownerId: string, onEvent: (e: DomainStatusEvent) => void): Promise<() => void> {
  await ensureSubscribed();
  const { emitter } = state();
  emitter.on(ownerId, onEvent);
  return () => { emitter.off(ownerId, onEvent); };
}

export async function publishDomainStatus(event: Omit<DomainStatusEvent, "type" | "at">): Promise<void> {
  const payload: DomainStatusEvent = { type: "custom_domain.status", at: new Date().toISOString(), ...event };
  await redis().publish(KEYS.events, JSON.stringify(payload));
}
