import { z } from "zod";
import type Database from "better-sqlite3";
import type { ClockMode } from "@paymob-simulator/contracts";
import type { AppDatabase } from "../database/connect.js";
import { intentions } from "../database/schema.js";
import type { Clock } from "../core/clock.js";
import { completeIntentionHeadless } from "../core/checkout-service.js";
import { getActiveCredential } from "../core/credentials.js";
import { getIntentionById } from "../core/intention-service.js";
import { parsePageParams, paginate } from "./pagination.js";
import type { AuthContext } from "./auth.js";
import { requireAdmin } from "./require-admin.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFastifyInstance = import("fastify").FastifyInstance<any, any, any, any, any>;

export interface IntentionsRouteDeps {
  db: AppDatabase;
  raw: Database.Database;
  clock: Clock;
  clockMode: ClockMode;
  defaultIntegrationId: number;
  defaultScenarioId: string;
  auth: AuthContext;
}

function controlPlaneError(code: string, message: string) {
  return { error: { code, message, details: {} } };
}

const completeBodySchema = z.object({
  scenarioId: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1),
});

export function registerIntentionsControlRoutes(app: AnyFastifyInstance, deps: IntentionsRouteDeps): void {
  app.get("/__simulator/api/intentions", { preHandler: requireAdmin(deps.auth) }, async (req, reply) => {
    const query = req.query as { limit?: string; cursor?: string };
    const rows = deps.db.select().from(intentions).all();
    rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return reply.code(200).send(paginate(rows, parsePageParams(query)));
  });

  app.get("/__simulator/api/intentions/:id", { preHandler: requireAdmin(deps.auth) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = getIntentionById(deps.db, id);
    if (!row) return reply.code(404).send(controlPlaneError("not_found", "intention not found"));
    return reply.code(200).send(row);
  });

  app.post(
    "/__simulator/api/intentions/:id/complete",
    { preHandler: requireAdmin(deps.auth) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = completeBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(422).send(controlPlaneError("invalid_body", parsed.error.message));
      }

      const hmacSecret = getActiveCredential(deps.db, "hmac_secret");
      const result = completeIntentionHeadless(
        {
          db: deps.db,
          raw: deps.raw,
          clock: deps.clock,
          hmacSecretVersion: hmacSecret.version,
          clockMode: deps.clockMode,
          defaultIntegrationId: deps.defaultIntegrationId,
        },
        {
          intentionId: id,
          scenarioId: parsed.data.scenarioId,
          idempotencyKey: parsed.data.idempotencyKey,
          defaultScenarioId: deps.defaultScenarioId,
        },
      );

      if (!result.ok) {
        const statusByReason = {
          not_found: 404,
          expired: 410,
          unrecognized_scenario: 422,
          conflict: 409,
        } as const;
        return reply
          .code(statusByReason[result.reason])
          .send(controlPlaneError(result.reason, `intention completion failed: ${result.reason}`));
      }

      return reply
        .code(result.replay ? 200 : 201)
        .send({ transactionId: result.transactionId, scenarioRunId: result.scenarioRunId, replay: result.replay });
    },
  );
}
