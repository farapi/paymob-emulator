import { z } from "zod";
import { parseDuration } from "@paymob-simulator/contracts";
import { ClockBackwardsError, ManualClock, type Clock } from "../core/clock.js";
import type { SchedulerRunner } from "../core/scheduler-runner.js";
import type { AuthContext } from "./auth.js";
import { requireAdmin } from "./require-admin.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFastifyInstance = import("fastify").FastifyInstance<any, any, any, any, any>;

export interface ClockRouteDeps {
  auth: AuthContext;
  clock: Clock;
  scheduler: SchedulerRunner;
}

const advanceBodySchema = z.object({
  by: z.union([z.number().int().nonnegative(), z.string()]),
  drain: z.boolean().optional().default(true),
  timeoutMs: z.number().int().positive().optional().default(30_000),
});

const setBodySchema = z.object({
  to: z.string().min(1),
  drain: z.boolean().optional().default(true),
  timeoutMs: z.number().int().positive().optional().default(30_000),
});

export function registerClockRoutes(app: AnyFastifyInstance, deps: ClockRouteDeps): void {
  app.post(
    "/__simulator/api/clock/advance",
    { preHandler: requireAdmin(deps.auth) },
    async (req, reply) => {
      const parsed = advanceBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(422).send({ error: { code: "invalid_body", message: parsed.error.message, details: {} } });
      }
      if (!(deps.clock instanceof ManualClock)) {
        return reply
          .code(409)
          .send({ error: { code: "clock_mode_not_manual", message: "advance is only valid in manual clock mode", details: {} } });
      }

      let ms: number;
      try {
        ms = parseDuration(parsed.data.by);
      } catch (err) {
        return reply.code(422).send({ error: { code: "invalid_duration", message: String(err), details: {} } });
      }

      const oldTime = deps.clock.now();
      deps.clock.advanceBy(ms);

      if (parsed.data.drain) {
        const { idle } = await deps.scheduler.drain(parsed.data.timeoutMs);
        return reply.code(idle ? 200 : 202).send({
          old: oldTime.toISOString(),
          new: deps.clock.now().toISOString(),
          idle,
        });
      }

      void deps.scheduler.tick();
      return reply.code(202).send({ old: oldTime.toISOString(), new: deps.clock.now().toISOString(), idle: false });
    },
  );

  app.post(
    "/__simulator/api/clock/set",
    { preHandler: requireAdmin(deps.auth) },
    async (req, reply) => {
      const parsed = setBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(422).send({ error: { code: "invalid_body", message: parsed.error.message, details: {} } });
      }
      if (!(deps.clock instanceof ManualClock)) {
        return reply
          .code(409)
          .send({ error: { code: "clock_mode_not_manual", message: "set is only valid in manual clock mode", details: {} } });
      }

      const target = new Date(parsed.data.to);
      if (Number.isNaN(target.getTime())) {
        return reply.code(422).send({ error: { code: "invalid_timestamp", message: "to must be a valid ISO 8601 timestamp", details: {} } });
      }

      const oldTime = deps.clock.now();
      try {
        deps.clock.setTo(target.getTime());
      } catch (err) {
        if (err instanceof ClockBackwardsError) {
          return reply.code(409).send({
            error: { code: "clock_would_move_backward", message: err.message, details: {} },
          });
        }
        throw err;
      }

      if (parsed.data.drain) {
        const { idle } = await deps.scheduler.drain(parsed.data.timeoutMs);
        return reply.code(idle ? 200 : 202).send({
          old: oldTime.toISOString(),
          new: deps.clock.now().toISOString(),
          idle,
        });
      }

      void deps.scheduler.tick();
      return reply.code(202).send({ old: oldTime.toISOString(), new: deps.clock.now().toISOString(), idle: false });
    },
  );
}
