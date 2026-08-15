import { z } from "zod";
import type Database from "better-sqlite3";
import type { AppDatabase } from "../../database/connect.js";
import { transactions } from "../../database/schema.js";
import { eq } from "drizzle-orm";
import type { Clock } from "../../core/clock.js";
import { verifyActiveCredential } from "../../core/credentials.js";
import { buildTransactionObj } from "../../core/transaction-payload.js";
import {
  captureTransaction,
  refundTransaction,
  voidTransaction,
  type PaymentOperationDeps,
} from "../../core/payment-operations.js";
import { getActiveCredential } from "../../core/credentials.js";
import type { AllowlistEntry } from "../../security/allowlist.js";
import type { DnsResolver } from "../../security/dns-pin.js";
import type { RetryPolicy } from "../../core/webhook-delivery.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFastifyInstance = import("fastify").FastifyInstance<any, any, any, any, any>;

export interface OperationsRouteDeps {
  db: AppDatabase;
  raw: Database.Database;
  clock: Clock;
  allowlist: readonly AllowlistEntry[];
  allowPrivateNetworks: boolean;
  resolver: DnsResolver;
  requestTimeoutMs: number;
  retryPolicy: RetryPolicy;
}

function opDeps(deps: OperationsRouteDeps): PaymentOperationDeps {
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

function findByNumericId(db: AppDatabase, transactionId: number) {
  return db.select().from(transactions).where(eq(transactions.providerNumericId, transactionId)).get();
}

function extractToken(req: { headers: Record<string, string | string[] | undefined> }): string | undefined {
  const match = /^Token\s+(.+)$/.exec((req.headers.authorization as string | undefined) ?? "");
  return match?.[1];
}

const refundBodySchema = z.object({ transaction_id: z.number().int().positive(), amount_cents: z.number().int().positive() });
const voidBodySchema = z.object({ transaction_id: z.number().int().positive() });
const captureBodySchema = z.object({ transaction_id: z.number().int().positive(), amount_cents: z.number().int().positive() });

export function registerLegacyOperationsRoutes(app: AnyFastifyInstance, deps: OperationsRouteDeps): void {
  app.post("/api/acceptance/void_refund/refund", async (req, reply) => {
    const token = extractToken(req as never);
    if (!token || !verifyActiveCredential(deps.db, "secret_key", token)) {
      return reply.code(401).send({ detail: "incorrect credentials" });
    }
    const parsed = refundBodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(422).send({ detail: "invalid refund request" });

    const original = findByNumericId(deps.db, parsed.data.transaction_id);
    if (!original) return reply.code(404).send({ detail: "Transaction not found" });

    const idempotencyKey = req.headers["idempotency-key"] as string | undefined;
    const result = await refundTransaction(opDeps(deps), original, parsed.data.amount_cents, idempotencyKey);
    if (!result.ok) return reply.code(result.status).send({ detail: result.reason });
    return reply.code(201).send(buildTransactionObj(result.child));
  });

  app.post("/api/acceptance/void_refund/void", async (req, reply) => {
    const token = extractToken(req as never);
    if (!token || !verifyActiveCredential(deps.db, "secret_key", token)) {
      return reply.code(401).send({ detail: "incorrect credentials" });
    }
    const parsed = voidBodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(422).send({ detail: "invalid void request" });

    const original = findByNumericId(deps.db, parsed.data.transaction_id);
    if (!original) return reply.code(404).send({ detail: "Transaction not found" });

    const idempotencyKey = req.headers["idempotency-key"] as string | undefined;
    const result = await voidTransaction(opDeps(deps), original, idempotencyKey);
    if (!result.ok) return reply.code(result.status).send({ detail: result.reason });
    return reply.code(201).send(buildTransactionObj(result.child));
  });

  app.post("/api/acceptance/capture", async (req, reply) => {
    const token = extractToken(req as never);
    if (!token || !verifyActiveCredential(deps.db, "secret_key", token)) {
      return reply.code(401).send({ detail: "incorrect credentials" });
    }
    const parsed = captureBodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(422).send({ detail: "invalid capture request" });

    const original = findByNumericId(deps.db, parsed.data.transaction_id);
    if (!original) return reply.code(404).send({ detail: "Transaction not found" });

    const idempotencyKey = req.headers["idempotency-key"] as string | undefined;
    const result = await captureTransaction(opDeps(deps), original, parsed.data.amount_cents, idempotencyKey);
    if (!result.ok) return reply.code(result.status).send({ detail: result.reason });
    return reply.code(201).send(buildTransactionObj(result.child));
  });
}
