import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type Database from "better-sqlite3";
import type { InternalState } from "@paymob-simulator/contracts";
import type { AppDatabase } from "../database/connect.js";
import { paymentOperations, scenarioRuns, transactions } from "../database/schema.js";
import type { Clock } from "./clock.js";
import { generateOpaqueId } from "./ids.js";
import { allocateId } from "./id-allocator.js";
import { transitionTransaction, type TransactionRow } from "./transaction-service.js";
import { buildTransactionObj } from "./transaction-payload.js";
import { materializeTransactionCallback } from "./webhook-payload.js";
import { createDelivery, attemptDelivery, type RetryPolicy } from "./webhook-delivery.js";
import type { AllowlistEntry } from "../security/allowlist.js";
import type { DnsResolver } from "../security/dns-pin.js";

export type OperationType = "capture" | "refund" | "void";

export interface PaymentOperationDeps {
  db: AppDatabase;
  raw: Database.Database;
  clock: Clock;
  hmacSecret: string;
  allowlist: readonly AllowlistEntry[];
  allowPrivateNetworks: boolean;
  resolver: DnsResolver;
  requestTimeoutMs: number;
  retryPolicy: RetryPolicy;
}

export type OperationFailureReason =
  | "not_found"
  | "invalid_state"
  | "amount_exceeds_remaining"
  | "partial_capture_unsupported"
  | "idempotency_conflict";

export type OperationResult =
  | { ok: true; child: TransactionRow; replay: boolean }
  | { ok: false; reason: OperationFailureReason; status: 404 | 409 | 422 };

function requestHash(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function findExistingByIdempotencyKey(
  db: AppDatabase,
  transactionId: string,
  operationType: OperationType,
  idempotencyKey: string,
): (typeof paymentOperations.$inferSelect) | undefined {
  return db
    .select()
    .from(paymentOperations)
    .all()
    .find(
      (row) =>
        row.transactionId === transactionId && row.operationType === operationType && row.idempotencyKey === idempotencyKey,
    );
}

const MESSAGE_BY_OPERATION: Record<OperationType, string> = {
  capture: "Captured",
  refund: "Refunded",
  void: "Voided",
};

async function createChildAndDeliver(
  deps: PaymentOperationDeps,
  original: TransactionRow,
  operationType: OperationType,
  operationAmountCents: number,
  idempotencyKey: string | undefined,
  requestPayload: unknown,
): Promise<OperationResult> {
  const { db, raw, clock } = deps;

  if (idempotencyKey) {
    const existing = findExistingByIdempotencyKey(db, original.id, operationType, idempotencyKey);
    if (existing) {
      if (existing.requestHash !== requestHash(requestPayload)) {
        return { ok: false, reason: "idempotency_conflict", status: 409 };
      }
      const child = db.select().from(transactions).where(eq(transactions.id, existing.childTransactionId)).get();
      if (child) return { ok: true, child, replay: true };
    }
  }

  const now = clock.now();
  const childId = generateOpaqueId("txn");
  const childProviderNumericId = allocateId(raw, "transaction");

  const { childRow, updatedOriginal } = db.transaction((tx) => {
    let capturedAmountCents = original.capturedAmountCents;
    let refundedAmountCents = original.refundedAmountCents;
    let newState: InternalState;

    if (operationType === "capture") {
      capturedAmountCents = operationAmountCents;
      newState = "captured";
    } else if (operationType === "refund") {
      refundedAmountCents = original.refundedAmountCents + operationAmountCents;
      newState = refundedAmountCents >= original.amountCents ? "refunded" : "partially_refunded";
    } else {
      newState = "voided";
    }

    tx.insert(transactions)
      .values({
        id: childId,
        providerNumericId: childProviderNumericId,
        intentionId: original.intentionId,
        parentTransactionId: original.id,
        state: newState === "captured" || newState === "voided" ? newState : "succeeded",
        amountCents: operationAmountCents,
        currency: original.currency,
        integrationId: original.integrationId,
        profileId: original.profileId,
        ownerId: original.ownerId,
        orderId: original.orderId,
        merchantOrderId: original.merchantOrderId,
        sourceType: original.sourceType,
        sourceSubType: original.sourceSubType,
        sourceLastFour: original.sourceLastFour,
        is3dSecure: original.is3dSecure,
        isStandalonePayment: false,
        hasParentTransaction: true,
        operationType,
        capturedAmountCents: 0,
        refundedAmountCents: 0,
        declineMessage: MESSAGE_BY_OPERATION[operationType],
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      })
      .run();

    tx.update(transactions)
      .set({ capturedAmountCents, refundedAmountCents, updatedAt: now.toISOString() })
      .where(eq(transactions.id, original.id))
      .run();

    const updated = transitionTransaction(tx as unknown as AppDatabase, original.id, newState, now, {
      sourceActionId: `${operationType}:${childId}`,
    });

    const child = tx.select().from(transactions).where(eq(transactions.id, childId)).get()!;

    if (idempotencyKey) {
      tx.insert(paymentOperations)
        .values({
          id: generateOpaqueId("op"),
          transactionId: original.id,
          childTransactionId: childId,
          operationType,
          amountCents: operationAmountCents,
          idempotencyKey,
          requestHash: requestHash(requestPayload),
          createdAt: now.toISOString(),
        })
        .run();
    }

    return { childRow: child, updatedOriginal: updated };
  });

  void updatedOriginal;

  const childObj = buildTransactionObj(childRow, { parentProviderNumericId: original.providerNumericId });
  const scenarioRun = original.scenarioRunId
    ? db.select().from(scenarioRuns).where(eq(scenarioRuns.id, original.scenarioRunId)).get()
    : undefined;

  if (scenarioRun?.notificationUrl) {
    const event = materializeTransactionCallback(db, childId, childObj, deps.hmacSecret, now);
    const delivery = createDelivery(
      db,
      { callbackEventId: event.id, transactionId: childId, eventType: "transaction", targetUrl: scenarioRun.notificationUrl },
      now,
    );
    await attemptDelivery(
      {
        db,
        clock,
        allowlist: deps.allowlist,
        allowPrivateNetworks: deps.allowPrivateNetworks,
        resolver: deps.resolver,
        requestTimeoutMs: deps.requestTimeoutMs,
        retryPolicy: deps.retryPolicy,
      },
      delivery,
    );
  }

  return { ok: true, child: childRow, replay: false };
}

export async function captureTransaction(
  deps: PaymentOperationDeps,
  original: TransactionRow,
  amountCents: number,
  idempotencyKey: string | undefined,
): Promise<OperationResult> {
  if (original.state !== "authorized") {
    return { ok: false, reason: "invalid_state", status: 409 };
  }
  if (amountCents !== original.amountCents) {
    return { ok: false, reason: "partial_capture_unsupported", status: 422 };
  }
  return createChildAndDeliver(deps, original, "capture", amountCents, idempotencyKey, { op: "capture", amountCents });
}

export async function refundTransaction(
  deps: PaymentOperationDeps,
  original: TransactionRow,
  amountCents: number,
  idempotencyKey: string | undefined,
): Promise<OperationResult> {
  if (original.state !== "succeeded" && original.state !== "captured" && original.state !== "partially_refunded") {
    return { ok: false, reason: "invalid_state", status: 409 };
  }
  const remaining = original.amountCents - original.refundedAmountCents;
  if (amountCents > remaining) {
    return { ok: false, reason: "amount_exceeds_remaining", status: 409 };
  }
  return createChildAndDeliver(deps, original, "refund", amountCents, idempotencyKey, { op: "refund", amountCents });
}

export async function voidTransaction(
  deps: PaymentOperationDeps,
  original: TransactionRow,
  idempotencyKey: string | undefined,
): Promise<OperationResult> {
  if (original.state !== "authorized" && original.state !== "succeeded") {
    return { ok: false, reason: "invalid_state", status: 409 };
  }
  return createChildAndDeliver(deps, original, "void", original.amountCents, idempotencyKey, { op: "void" });
}
