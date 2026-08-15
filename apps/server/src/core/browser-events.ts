import { EventEmitter } from "node:events";
import { and, desc, eq, gt } from "drizzle-orm";
import type { AppDatabase } from "../database/connect.js";
import { browserEvents } from "../database/schema.js";
import { generateOpaqueId } from "./ids.js";
import { isSessionActive, type CheckoutSessionRow } from "./checkout-sessions-repository.js";

export type BrowserEventRow = typeof browserEvents.$inferSelect;

/** In-process pub/sub so the SSE route can wake immediately when a new event is inserted (spec 10.4 step 4). */
export const browserEventBus = new EventEmitter();
browserEventBus.setMaxListeners(0);

export interface CreateBrowserEventParams {
  transactionId?: string | undefined;
  type: string;
  payload: Record<string, unknown>;
  scenarioActionId?: string | undefined;
}

const NAVIGATION_EVENT_TYPES = new Set(["browser.redirect"]);

function nextEventSeq(db: AppDatabase, checkoutSessionId: string): number {
  const rows = db
    .select()
    .from(browserEvents)
    .where(eq(browserEvents.checkoutSessionId, checkoutSessionId))
    .orderBy(desc(browserEvents.eventSeq))
    .limit(1)
    .all();
  return (rows[0]?.eventSeq ?? 0) + 1;
}

/**
 * Materializes a browser action into a persisted, publishable event. If no
 * checkout session ever existed for this transaction (headless completion),
 * there is nothing to publish and this is a no-op. A due navigation event
 * with no currently active session is recorded as
 * `missed_no_active_browser` rather than pretending a redirect occurred
 * (spec 10.4 step 5).
 */
export function createBrowserEvent(
  db: AppDatabase,
  session: CheckoutSessionRow | undefined,
  params: CreateBrowserEventParams,
  now: Date,
): BrowserEventRow | undefined {
  if (!session) return undefined;

  const active = isSessionActive(session, now);
  const isNavigation = NAVIGATION_EVENT_TYPES.has(params.type);
  const status = isNavigation && !active ? "missed_no_active_browser" : "delivered";

  const id = generateOpaqueId("bevt");
  const eventSeq = nextEventSeq(db, session.id);
  db.insert(browserEvents)
    .values({
      id,
      checkoutSessionId: session.id,
      transactionId: params.transactionId ?? null,
      eventSeq,
      type: params.type,
      payloadJson: params.payload,
      dueAt: now.toISOString(),
      status,
      scenarioActionId: params.scenarioActionId ?? null,
      createdAt: now.toISOString(),
      deliveredAt: status === "delivered" ? now.toISOString() : null,
    })
    .run();

  const row = db.select().from(browserEvents).where(eq(browserEvents.id, id)).get();
  if (!row) throw new Error("failed to read back created browser event");

  browserEventBus.emit(session.id, row);
  return row;
}

export function listBrowserEventsAfter(db: AppDatabase, sessionId: string, afterSeq: number): BrowserEventRow[] {
  return db
    .select()
    .from(browserEvents)
    .where(and(eq(browserEvents.checkoutSessionId, sessionId), gt(browserEvents.eventSeq, afterSeq)))
    .orderBy(browserEvents.eventSeq)
    .all();
}

export function acknowledgeBrowserEvent(db: AppDatabase, sessionId: string, eventSeq: number, now: Date): void {
  db.update(browserEvents)
    .set({ ackedAt: now.toISOString() })
    .where(and(eq(browserEvents.checkoutSessionId, sessionId), eq(browserEvents.eventSeq, eventSeq)))
    .run();
}
