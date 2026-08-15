import { eq } from "drizzle-orm";
import { z } from "zod";
import type { AppDatabase } from "../database/connect.js";
import { scheduledActions, webhookAttempts, webhookDeliveries } from "../database/schema.js";
import type { Clock } from "../core/clock.js";
import { createDelivery } from "../core/webhook-delivery.js";
import { getCallbackEvent } from "../core/webhook-payload.js";
import { generateOpaqueId } from "../core/ids.js";
import { parseDuration } from "@paymob-simulator/contracts";
import { parsePageParams, paginate } from "./pagination.js";
import type { AuthContext } from "./auth.js";
import { requireAdmin } from "./require-admin.js";
import type { SchedulerRunner } from "../core/scheduler-runner.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFastifyInstance = import("fastify").FastifyInstance<any, any, any, any, any>;

export interface DeliveriesRouteDeps {
  db: AppDatabase;
  clock: Clock;
  auth: AuthContext;
  scheduler: SchedulerRunner;
}

function controlPlaneError(code: string, message: string) {
  return { error: { code, message, details: {} } };
}

const replayBodySchema = z.union([
  z.object({ when: z.literal("now") }),
  z.object({ after: z.string().min(1) }),
]);

export function registerDeliveriesControlRoutes(app: AnyFastifyInstance, deps: DeliveriesRouteDeps): void {
  app.get("/__simulator/api/deliveries", { preHandler: requireAdmin(deps.auth) }, async (req, reply) => {
    const query = req.query as { limit?: string; cursor?: string };
    const rows = deps.db.select().from(webhookDeliveries).all();
    rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return reply.code(200).send(paginate(rows, parsePageParams(query)));
  });

  app.get("/__simulator/api/deliveries/:id", { preHandler: requireAdmin(deps.auth) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const delivery = deps.db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, id)).get();
    if (!delivery) return reply.code(404).send(controlPlaneError("not_found", "delivery not found"));

    const event = getCallbackEvent(deps.db, delivery.callbackEventId);
    const attempts = deps.db.select().from(webhookAttempts).where(eq(webhookAttempts.deliveryId, id)).all();
    return reply.code(200).send({ delivery, event, attempts });
  });

  app.post(
    "/__simulator/api/deliveries/:id/replay",
    { preHandler: requireAdmin(deps.auth) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const source = deps.db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, id)).get();
      if (!source) return reply.code(404).send(controlPlaneError("not_found", "delivery not found"));

      const parsed = replayBodySchema.safeParse(req.body ?? { when: "now" });
      if (!parsed.success) return reply.code(422).send(controlPlaneError("invalid_body", parsed.error.message));

      const now = deps.clock.now();
      const delayMs = "after" in parsed.data ? parseDuration(parsed.data.after) : 0;

      const newDelivery = createDelivery(
        deps.db,
        {
          callbackEventId: source.callbackEventId,
          transactionId: source.transactionId ?? undefined,
          eventType: source.eventType,
          targetUrl: source.targetUrl,
          originalDeliveryId: source.id,
        },
        now,
      );

      if (delayMs === 0) {
        await deps.scheduler.tick();
      } else {
        deps.db
          .insert(scheduledActions)
          .values({
            id: generateOpaqueId("sched"),
            transactionId: source.transactionId,
            scenarioActionId: `replay:${newDelivery.id}`,
            actionType: "webhook.retry",
            payloadJson: { deliveryId: newDelivery.id },
            dueAt: new Date(now.getTime() + delayMs).toISOString(),
            status: "scheduled",
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
          })
          .run();
      }

      return reply.code(201).send(newDelivery);
    },
  );

  app.post(
    "/__simulator/api/deliveries/:id/cancel",
    { preHandler: requireAdmin(deps.auth) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const delivery = deps.db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, id)).get();
      if (!delivery) return reply.code(404).send(controlPlaneError("not_found", "delivery not found"));
      if (delivery.status !== "scheduled") {
        return reply.code(409).send(controlPlaneError("already_leased", "delivery is no longer cancellable"));
      }
      deps.db
        .update(webhookDeliveries)
        .set({ status: "cancelled", completedAt: deps.clock.now().toISOString() })
        .where(eq(webhookDeliveries.id, id))
        .run();
      return reply.code(200).send({ cancelled: true });
    },
  );
}
