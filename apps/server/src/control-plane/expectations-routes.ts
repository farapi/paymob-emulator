import type { AppDatabase } from "../database/connect.js";
import type { Clock } from "../core/clock.js";
import {
  cancelExpectation,
  createApiFaultExpectationSchema,
  createCheckoutExpectation,
  createApiFaultExpectation,
  createCheckoutExpectationSchema,
  ExpectationValidationError,
  listExpectations,
} from "../core/expectations-service.js";
import type { AuthContext } from "./auth.js";
import { requireAdmin } from "./require-admin.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFastifyInstance = import("fastify").FastifyInstance<any, any, any, any, any>;

export interface ExpectationRouteDeps {
  db: AppDatabase;
  clock: Clock;
  auth: AuthContext;
}

function controlPlaneError(code: string, message: string) {
  return { error: { code, message, details: {} } };
}

export function registerExpectationRoutes(app: AnyFastifyInstance, deps: ExpectationRouteDeps): void {
  app.post("/__simulator/api/expectations", { preHandler: requireAdmin(deps.auth) }, async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const isApiFault = body.response !== undefined;

    try {
      if (isApiFault) {
        const parsed = createApiFaultExpectationSchema.safeParse(body);
        if (!parsed.success) {
          return reply.code(422).send(controlPlaneError("invalid_body", parsed.error.message));
        }
        const row = createApiFaultExpectation(deps.db, deps.clock, parsed.data);
        return reply.code(201).send(row);
      }

      const parsed = createCheckoutExpectationSchema.safeParse(body);
      if (!parsed.success) {
        return reply.code(422).send(controlPlaneError("invalid_body", parsed.error.message));
      }
      const row = createCheckoutExpectation(deps.db, deps.clock, parsed.data);
      return reply.code(201).send(row);
    } catch (err) {
      if (err instanceof ExpectationValidationError) {
        return reply.code(409).send(controlPlaneError("ambiguous_expectation", err.message));
      }
      throw err;
    }
  });

  app.get("/__simulator/api/expectations", { preHandler: requireAdmin(deps.auth) }, async (_req, reply) => {
    return reply.code(200).send({ data: listExpectations(deps.db) });
  });

  app.delete(
    "/__simulator/api/expectations/:id",
    { preHandler: requireAdmin(deps.auth) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const ok = cancelExpectation(deps.db, id);
      if (!ok) return reply.code(404).send(controlPlaneError("not_found", "expectation not found"));
      return reply.code(204).send();
    },
  );
}
