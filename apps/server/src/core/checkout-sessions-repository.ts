import { eq } from "drizzle-orm";
import type { AppDatabase } from "../database/connect.js";
import { checkoutSessions } from "../database/schema.js";
import { generateChannelNonce, generateOpaqueId } from "./ids.js";
import { hashOpaqueSecret } from "./secret-hash.js";

export type CheckoutSessionRow = typeof checkoutSessions.$inferSelect;

const HEARTBEAT_ACTIVE_WINDOW_MS = 20_000;

export interface CreateCheckoutSessionParams {
  kind: "modern" | "legacy" | "embed";
  intentionId?: string;
  paymentTokenId?: string;
  expiresAt: Date;
}

export interface CreatedCheckoutSession {
  id: string;
  ticket: string;
  row: CheckoutSessionRow;
}

/** Renders a checkout session: random session id + bearer ticket, only the ticket's hash is stored (spec 10.4). */
export function createCheckoutSession(
  db: AppDatabase,
  params: CreateCheckoutSessionParams,
  now: Date,
): CreatedCheckoutSession {
  const id = generateOpaqueId("sess");
  const ticket = generateChannelNonce();
  db.insert(checkoutSessions)
    .values({
      id,
      ticketHash: hashOpaqueSecret(ticket),
      kind: params.kind,
      intentionId: params.intentionId ?? null,
      paymentTokenId: params.paymentTokenId ?? null,
      lastEventCursor: 0,
      lastHeartbeatAt: now.toISOString(),
      createdAt: now.toISOString(),
      expiresAt: params.expiresAt.toISOString(),
    })
    .run();
  const row = db.select().from(checkoutSessions).where(eq(checkoutSessions.id, id)).get();
  if (!row) throw new Error("failed to read back created checkout session");
  return { id, ticket, row };
}

export function getCheckoutSession(db: AppDatabase, id: string): CheckoutSessionRow | undefined {
  return db.select().from(checkoutSessions).where(eq(checkoutSessions.id, id)).get();
}

/** Most recently created checkout session for an intention, if any browser ever opened one. */
export function findLatestCheckoutSessionForIntention(
  db: AppDatabase,
  intentionId: string,
): CheckoutSessionRow | undefined {
  const rows = db.select().from(checkoutSessions).where(eq(checkoutSessions.intentionId, intentionId)).all();
  rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return rows[0];
}

export function touchHeartbeat(db: AppDatabase, sessionId: string, now: Date): void {
  db.update(checkoutSessions)
    .set({ lastHeartbeatAt: now.toISOString() })
    .where(eq(checkoutSessions.id, sessionId))
    .run();
}

export function isSessionActive(session: CheckoutSessionRow, now: Date): boolean {
  const last = session.lastHeartbeatAt ?? session.createdAt;
  return now.getTime() - new Date(last).getTime() <= HEARTBEAT_ACTIVE_WINDOW_MS;
}

export function verifyTicket(session: CheckoutSessionRow, ticket: string): boolean {
  return session.ticketHash === hashOpaqueSecret(ticket);
}
