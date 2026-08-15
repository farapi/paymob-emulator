import { z } from "zod";
import type Database from "better-sqlite3";
import type { AppDatabase } from "../database/connect.js";
import { transactions } from "../database/schema.js";
import type { Clock } from "../core/clock.js";
import { getTransactionById } from "../core/transaction-service.js";
import { buildTransactionObj } from "../core/transaction-payload.js";
import { captureTransaction, refundTransaction, voidTransaction, type PaymentOperationDeps } from "../core/payment-operations.js";
import { getActiveCredential } from "../core/credentials.js";
import { parsePageParams, paginate } from "./pagination.js";
import type { AuthContext } from "./auth.js";
import { requireAdmin } from "./require-admin.js";
import type { AllowlistEntry } from "../security/allowlist.js";
import type { DnsResolver } from "../security/dns-pin.js";
import type { RetryPolicy } from "../core/webhook-delivery.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFastifyInstance = import("fastify").FastifyInstance<any, any, any, any, any>;

export interface TransactionsRouteDeps {
  db: AppDatabase;
  raw: Database.Database;
  clock: Clock;
  auth: AuthContext;
  allowlist: readonly AllowlistEntry[];
  allowPrivateNetworks: boolean;
  resolver: DnsResolver;
  requestTimeoutMs: number;
  retryPolicy: RetryPolicy;
}

function controlPlaneError(code: string, message: string) {
  return { error: { code, message, details: {} } };
}

function opDeps(deps: TransactionsRouteDeps): PaymentOperationDeps {
  return {
    db: deps.db,
    raw: deps.raw,
    clock: deps.clock,
    hmacSecret: getActiveCredential(deps.db, "hmac_secret").value,
    allowlist: deps.allowlist,
    allowPrivateNetworks: deps.allowPrivateNetworks,
    resolver: deps.resolver,
    requestTimeoutMs: deps.requestTimeoutMs,
    retryPolicy: deps.retryPolicy,
  };
}

const amountBodySchema = z.object({ amountCents: z.number().int().positive() });

export function registerTransactionsControlRoutes(app: AnyFastifyInstance, deps: TransactionsRouteDeps): void {
  app.get("/__simulator/api/transactions", { preHandler: requireAdmin(deps.auth) }, async (req, reply) => {
    const query = req.query as { limit?: string; cursor?: string };
    const rows = deps.db.select().from(transactions).all();
    rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return reply.code(200).send(paginate(rows, parsePageParams(query)));
  });

  app.get("/__simulator/api/transactions/:id", { preHandler: requireAdmin(deps.auth) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = getTransactionById(deps.db, id);
    if (!row) return reply.code(404).send(controlPlaneError("not_found", "transaction not found"));
    return reply.code(200).send({ ...row, obj: buildTransactionObj(row) });
  });

  app.post(
    "/__simulator/api/transactions/:id/capture",
    { preHandler: requireAdmin(deps.auth) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const original = getTransactionById(deps.db, id);
      if (!original) return reply.code(404).send(controlPlaneError("not_found", "transaction not found"));

      const parsed = amountBodySchema.safeParse(req.body);
      if (!parsed.success) return reply.code(422).send(controlPlaneError("invalid_body", parsed.error.message));

      const idempotencyKey = req.headers["idempotency-key"] as string | undefined;
      const result = await captureTransaction(opDeps(deps), original, parsed.data.amountCents, idempotencyKey);
      if (!result.ok) return reply.code(result.status).send(controlPlaneError(result.reason, result.reason));
      return reply.code(result.replay ? 200 : 201).send(buildTransactionObj(result.child));
    },
  );

  app.post(
    "/__simulator/api/transactions/:id/refund",
    { preHandler: requireAdmin(deps.auth) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const original = getTransactionById(deps.db, id);
      if (!original) return reply.code(404).send(controlPlaneError("not_found", "transaction not found"));

      const parsed = amountBodySchema.safeParse(req.body);
      if (!parsed.success) return reply.code(422).send(controlPlaneError("invalid_body", parsed.error.message));

      const idempotencyKey = req.headers["idempotency-key"] as string | undefined;
      const result = await refundTransaction(opDeps(deps), original, parsed.data.amountCents, idempotencyKey);
      if (!result.ok) return reply.code(result.status).send(controlPlaneError(result.reason, result.reason));
      return reply.code(result.replay ? 200 : 201).send(buildTransactionObj(result.child));
    },
  );

  app.post(
    "/__simulator/api/transactions/:id/void",
    { preHandler: requireAdmin(deps.auth) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const original = getTransactionById(deps.db, id);
      if (!original) return reply.code(404).send(controlPlaneError("not_found", "transaction not found"));

      const idempotencyKey = req.headers["idempotency-key"] as string | undefined;
      const result = await voidTransaction(opDeps(deps), original, idempotencyKey);
      if (!result.ok) return reply.code(result.status).send(controlPlaneError(result.reason, result.reason));
      return reply.code(result.replay ? 200 : 201).send(buildTransactionObj(result.child));
    },
  );
}
