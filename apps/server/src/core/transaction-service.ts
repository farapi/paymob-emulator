import { eq } from "drizzle-orm";
import { isLegalTransition, type InternalState } from "@paymob-simulator/contracts";
import type Database from "better-sqlite3";
import type { AppDatabase } from "../database/connect.js";
import { transactions, transactionSnapshots } from "../database/schema.js";
import { allocateId, SIMULATOR_PROFILE_ID } from "./id-allocator.js";
import { generateOpaqueId } from "./ids.js";
import { buildTransactionObj } from "./transaction-payload.js";

export type TransactionRow = typeof transactions.$inferSelect;

export interface CreateTransactionParams {
  intentionId: string;
  amountCents: number;
  currency: string;
  integrationId: number;
  merchantOrderId: string;
  sourceLastFour: string;
  sourceSubType: string;
  is3dSecure: boolean;
  scenarioRunId: string;
  now: Date;
}

export function createTransaction(
  raw: Database.Database,
  db: AppDatabase,
  params: CreateTransactionParams,
): TransactionRow {
  const providerNumericId = allocateId(raw, "transaction");
  const orderId = allocateId(raw, "order");
  const nowIso = params.now.toISOString();

  const id = generateOpaqueId("txn");
  db.insert(transactions)
    .values({
      id,
      providerNumericId,
      intentionId: params.intentionId,
      state: "processing",
      amountCents: params.amountCents,
      currency: params.currency,
      integrationId: params.integrationId,
      profileId: SIMULATOR_PROFILE_ID,
      ownerId: SIMULATOR_PROFILE_ID,
      orderId,
      merchantOrderId: params.merchantOrderId,
      sourceType: "card",
      sourceSubType: params.sourceSubType,
      sourceLastFour: params.sourceLastFour,
      is3dSecure: params.is3dSecure,
      isStandalonePayment: true,
      capturedAmountCents: 0,
      refundedAmountCents: 0,
      hasParentTransaction: false,
      scenarioRunId: params.scenarioRunId,
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    .run();

  const row = db.select().from(transactions).where(eq(transactions.id, id)).get();
  if (!row) throw new Error("failed to read back created transaction");
  return row;
}

export class IllegalTransitionError extends Error {}

/**
 * Atomically applies a legal canonical transition and persists a canonical
 * snapshot (spec 12.3 transaction.transition). Illegal transitions never
 * mutate state -- scenario compilation should already reject these, but this
 * is the last line of defense at execution time.
 */
export function transitionTransaction(
  db: AppDatabase,
  transactionId: string,
  to: InternalState,
  now: Date,
  opts: { declineMessage?: string; sourceActionId?: string } = {},
): TransactionRow {
  return db.transaction((tx) => {
    const current = tx.select().from(transactions).where(eq(transactions.id, transactionId)).get();
    if (!current) throw new Error(`unknown transaction "${transactionId}"`);
    if (!isLegalTransition(current.state as InternalState, to)) {
      throw new IllegalTransitionError(`illegal transition ${current.state} -> ${to}`);
    }

    const nowIso = now.toISOString();
    const patch: Partial<TransactionRow> = { state: to, updatedAt: nowIso };
    if (to === "failed") {
      patch.failedAt = nowIso;
      if (opts.declineMessage) patch.declineMessage = opts.declineMessage;
    }
    if (to === "succeeded" || to === "authorized") {
      patch.paidAt = nowIso;
    }

    tx.update(transactions).set(patch).where(eq(transactions.id, transactionId)).run();
    const updated = tx.select().from(transactions).where(eq(transactions.id, transactionId)).get();
    if (!updated) throw new Error("failed to read back transitioned transaction");

    const obj = buildTransactionObj(updated);
    tx.insert(transactionSnapshots)
      .values({
        id: generateOpaqueId("snap"),
        transactionId,
        canonical: true,
        state: to,
        payloadJson: obj,
        sourceActionId: opts.sourceActionId ?? null,
        createdAt: nowIso,
      })
      .run();

    return updated;
  });
}

/**
 * Creates a non-canonical projected snapshot without mutating the
 * transaction (spec 12.3 transaction.snapshot, canonical:false only).
 */
export function createNonCanonicalSnapshot(
  db: AppDatabase,
  transactionId: string,
  state: InternalState,
  now: Date,
  sourceActionId: string,
): void {
  const current = db.select().from(transactions).where(eq(transactions.id, transactionId)).get();
  if (!current) throw new Error(`unknown transaction "${transactionId}"`);

  const projected = { ...current, state };
  const obj = buildTransactionObj(projected as TransactionRow, { overrideCreatedAt: new Date(current.createdAt) });

  db.insert(transactionSnapshots)
    .values({
      id: generateOpaqueId("snap"),
      transactionId,
      canonical: false,
      state,
      payloadJson: obj,
      sourceActionId,
      createdAt: now.toISOString(),
    })
    .run();
}

export function getTransactionById(db: AppDatabase, id: string): TransactionRow | undefined {
  return db.select().from(transactions).where(eq(transactions.id, id)).get();
}
