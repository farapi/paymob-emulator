import { z } from "zod";
import type Database from "better-sqlite3";
import type { AppDatabase } from "../database/connect.js";
import type { Clock } from "../core/clock.js";
import type { SchedulerRunner } from "../core/scheduler-runner.js";
import { submitCheckout } from "../core/checkout-service.js";
import { getActiveCredential } from "../core/credentials.js";
import { findIntentionByClientSecret } from "../core/intention-service.js";
import {
  createCheckoutSession,
  getCheckoutSession,
  touchHeartbeat,
  verifyTicket,
} from "../core/checkout-sessions-repository.js";
import { acknowledgeBrowserEvent, browserEventBus, listBrowserEventsAfter, type BrowserEventRow } from "../core/browser-events.js";
import { transactions } from "../database/schema.js";
import { eq } from "drizzle-orm";
import { mapTransactionStateToBrowserStatus } from "../core/browser-status.js";
import type { ClockMode, InternalState } from "@paymob-simulator/contracts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFastifyInstance = import("fastify").FastifyInstance<any, any, any, any, any>;

export interface CheckoutRouteDeps {
  db: AppDatabase;
  raw: Database.Database;
  clock: Clock;
  clockMode: ClockMode;
  defaultIntegrationId: number;
  scheduler: SchedulerRunner;
}

const HEARTBEAT_INTERVAL_MS = 15_000;
const SESSION_TTL_MS = 15 * 60 * 1000;

function formatSseEvent(event: BrowserEventRow): string {
  const data = JSON.stringify({
    actionId: event.scenarioActionId,
    type: event.type,
    payload: event.payloadJson,
    dueAt: event.dueAt,
  });
  return `id: ${event.eventSeq}\nevent: browser.action\ndata: ${data}\n\n`;
}

export function registerCheckoutRoutes(app: AnyFastifyInstance, deps: CheckoutRouteDeps): void {
  app.post("/__simulator/checkout/:clientSecret/open", async (req, reply) => {
    const { clientSecret } = req.params as { clientSecret: string };
    const intention = findIntentionByClientSecret(deps.db, clientSecret);
    if (!intention) return reply.code(404).send({ detail: "intention not found" });

    const now = deps.clock.now();
    if (new Date(intention.expiresAt).getTime() <= now.getTime()) {
      return reply.code(410).send({ detail: "intention expired" });
    }

    // Every render creates its own session/ticket (spec 10.4): two tabs for
    // the same intention each get their own session and both receive
    // published browser actions, but only the first atomic submit creates a
    // transaction. A fresh session has no browser_events of its own, so
    // reopening never replays an old navigation (10.4 step 5) -- instead,
    // if the intention was already submitted, we resolve and return the
    // transaction's current outcome directly here.
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    const created = createCheckoutSession(
      deps.db,
      { kind: "modern", intentionId: intention.id, expiresAt },
      now,
    );

    let currentStatus: string | null = null;
    if (intention.status !== "intended") {
      const txn = deps.db.select().from(transactions).where(eq(transactions.intentionId, intention.id)).get();
      currentStatus = txn ? mapTransactionStateToBrowserStatus(txn.state as InternalState) : null;
    }

    return reply.code(201).send({ sessionId: created.id, ticket: created.ticket, currentStatus });
  });

  const submitBodySchema = z.object({
    cardNumber: z.string().min(1),
    cardholderName: z.string().default(""),
    idempotencyKey: z.string().optional(),
  });

  app.post("/__simulator/checkout/:clientSecret/submit", async (req, reply) => {
    const { clientSecret } = req.params as { clientSecret: string };
    const parsed = submitBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(422).send({ detail: "invalid submission body" });
    }

    const hmacSecret = getActiveCredential(deps.db, "hmac_secret");
    const result = submitCheckout(
      {
        db: deps.db,
        raw: deps.raw,
        clock: deps.clock,
        hmacSecretVersion: hmacSecret.version,
        clockMode: deps.clockMode,
        defaultIntegrationId: deps.defaultIntegrationId,
      },
      {
        clientSecret,
        cardNumber: parsed.data.cardNumber,
        cardholderName: parsed.data.cardholderName,
        idempotencyKey: parsed.data.idempotencyKey,
      },
    );

    if (!result.ok) {
      const statusByReason = {
        not_found: 404,
        expired: 410,
        unrecognized_card: 422,
        unrecognized_alias: 422,
        conflict: 409,
      } as const;
      return reply.code(statusByReason[result.reason]).send({ detail: result.reason });
    }

    await deps.scheduler.tick();

    return reply.code(200).send({ transactionId: result.transactionId, replay: result.replay });
  });

  app.get("/__simulator/checkout-sessions/:sessionId/events", async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    const { ticket, after } = req.query as { ticket?: string; after?: string };
    const lastEventIdHeader = req.headers["last-event-id"] as string | undefined;

    const session = getCheckoutSession(deps.db, sessionId);
    if (!session || !ticket || !verifyTicket(session, ticket)) {
      return reply.code(401).send({ detail: "invalid checkout session or ticket" });
    }

    const afterCursor = Number.parseInt(lastEventIdHeader ?? after ?? "0", 10) || 0;

    // Fastify must not manage this response's lifecycle -- without hijack(),
    // the handler's returning promise resolves almost immediately (there's
    // nothing left to await after registering listeners), and Fastify then
    // tries to finalize a response that was never sent through its own
    // reply.send() path, leaving the connection in a state that never
    // flushes further writes to the client.
    reply.hijack();

    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    // writeHead() alone only buffers headers -- Node's http module doesn't
    // put them on the wire until the first write()/end(), which for an SSE
    // stream with an empty backlog might not happen for up to
    // HEARTBEAT_INTERVAL_MS. A client (EventSource, fetch) waiting on
    // response headers would hang until then. Force an immediate flush.
    reply.raw.flushHeaders();

    const backlog = listBrowserEventsAfter(deps.db, sessionId, afterCursor);
    for (const event of backlog) reply.raw.write(formatSseEvent(event));

    const onEvent = (event: BrowserEventRow) => {
      reply.raw.write(formatSseEvent(event));
    };
    browserEventBus.on(sessionId, onEvent);

    const heartbeat = setInterval(() => {
      touchHeartbeat(deps.db, sessionId, deps.clock.now());
      reply.raw.write(": heartbeat\n\n");
    }, HEARTBEAT_INTERVAL_MS);

    req.raw.on("close", () => {
      clearInterval(heartbeat);
      browserEventBus.off(sessionId, onEvent);
    });
  });

  const ackBodySchema = z.object({
    eventId: z.number().int().nonnegative(),
    outcome: z.enum(["applied", "failed"]),
  });

  app.post("/__simulator/checkout-sessions/:sessionId/ack", async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    const { ticket } = (req.query as { ticket?: string }) ?? {};
    const parsed = ackBodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(422).send({ detail: "invalid ack body" });

    const session = getCheckoutSession(deps.db, sessionId);
    if (!session || !ticket || !verifyTicket(session, ticket)) {
      return reply.code(401).send({ detail: "invalid checkout session or ticket" });
    }

    const now = deps.clock.now();
    acknowledgeBrowserEvent(deps.db, sessionId, parsed.data.eventId, now);
    touchHeartbeat(deps.db, sessionId, now);
    return reply.code(200).send({ acked: true });
  });
}
