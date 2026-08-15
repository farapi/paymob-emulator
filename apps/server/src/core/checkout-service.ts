import { eq } from "drizzle-orm";
import type Database from "better-sqlite3";
import { normalizeCardNumber, type ClockMode } from "@paymob-simulator/contracts";
import { compileScenario } from "@paymob-simulator/scenario-engine";
import type { AppDatabase } from "../database/connect.js";
import { intentions, scenarioRuns, transactions, scheduledActions } from "../database/schema.js";
import type { Clock } from "./clock.js";
import { generateOpaqueId } from "./ids.js";
import { findIntentionByClientSecret } from "./intention-service.js";
import { getScenarioDefinition } from "./scenario-registry.js";
import { selectCheckoutScenario, type ScenarioSelectionResult } from "./scenario-selection.js";
import { createTransaction, type TransactionRow } from "./transaction-service.js";

export interface SubmitCheckoutParams {
  clientSecret: string;
  cardNumber: string;
  cardholderName: string;
  idempotencyKey?: string | undefined;
}

export interface CheckoutDeps {
  db: AppDatabase;
  raw: Database.Database;
  clock: Clock;
  hmacSecretVersion: number;
  clockMode: ClockMode;
  defaultIntegrationId: number;
}

export type SubmitCheckoutFailureReason =
  | "not_found"
  | "expired"
  | "unrecognized_card"
  | "unrecognized_alias"
  | "conflict";

export type SubmitCheckoutResult =
  | { ok: true; transactionId: string; scenarioRunId: string; replay: boolean }
  | { ok: false; reason: SubmitCheckoutFailureReason };

function findTransactionByIntentionId(db: AppDatabase, intentionId: string): TransactionRow | undefined {
  return db.select().from(transactions).where(eq(transactions.intentionId, intentionId)).get();
}

/**
 * The single atomic checkout submission (spec 9.1, 12.1): validates the
 * card/alias/expectation, creates exactly one transaction + scenario run,
 * compiles the scenario's timeline into concrete scheduled_actions, and
 * consumes the intention. A repeated submission with the same idempotency
 * key replays the original result instead of creating a second transaction.
 */
export function submitCheckout(deps: CheckoutDeps, params: SubmitCheckoutParams): SubmitCheckoutResult {
  const { db, raw, clock } = deps;

  const intention = findIntentionByClientSecret(db, params.clientSecret);
  if (!intention) return { ok: false, reason: "not_found" };

  const now = clock.now();
  if (new Date(intention.expiresAt).getTime() <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }

  if (intention.status !== "intended") {
    if (params.idempotencyKey && intention.idempotencyKey === params.idempotencyKey) {
      const txn = findTransactionByIntentionId(db, intention.id);
      if (txn) return { ok: true, transactionId: txn.id, scenarioRunId: txn.scenarioRunId ?? "", replay: true };
    }
    return { ok: false, reason: "conflict" };
  }

  const selection = selectCheckoutScenario(db, now, {
    cardNumber: params.cardNumber,
    cardholderName: params.cardholderName,
    specialReference: intention.specialReference ?? undefined,
  });
  if (!selection.ok) return { ok: false, reason: selection.error.code };

  const definition = getScenarioDefinition(db, selection.result.scenarioId);
  if (!definition) return { ok: false, reason: "unrecognized_card" };

  return db.transaction((tx) => {
    const fresh = tx.select().from(intentions).where(eq(intentions.id, intention.id)).get();
    if (!fresh || fresh.status !== "intended") {
      if (fresh && params.idempotencyKey && fresh.idempotencyKey === params.idempotencyKey) {
        const txn = findTransactionByIntentionId(tx as unknown as AppDatabase, intention.id);
        if (txn) return { ok: true, transactionId: txn.id, scenarioRunId: txn.scenarioRunId ?? "", replay: true };
      }
      return { ok: false, reason: "conflict" };
    }

    const nowIso = now.toISOString();
    tx.update(intentions)
      .set({ status: "processing", idempotencyKey: params.idempotencyKey ?? null, updatedAt: nowIso })
      .where(eq(intentions.id, intention.id))
      .run();

    const lastFour = normalizeCardNumber(params.cardNumber).slice(-4);
    const scenarioRunId = generateOpaqueId("run");
    const revisionId = `${definition.id}@1`;

    const txnRow = createTransaction(raw, tx as unknown as AppDatabase, {
      intentionId: intention.id,
      amountCents: intention.amount,
      currency: intention.currency,
      integrationId: intention.integrationId ?? deps.defaultIntegrationId,
      merchantOrderId: intention.specialReference ?? intention.id,
      sourceLastFour: lastFour,
      sourceSubType: "Visa",
      is3dSecure: definition.checkout.requireThreeDS ?? false,
      scenarioRunId,
      now,
    });

    tx.insert(scenarioRuns)
      .values({
        id: scenarioRunId,
        intentionId: intention.id,
        transactionId: txnRow.id,
        scenarioId: definition.id,
        scenarioRevisionId: revisionId,
        notificationUrl: intention.notificationUrl,
        redirectionUrl: intention.redirectionUrl,
        integrationId: intention.integrationId ?? deps.defaultIntegrationId,
        hmacSecretVersion: deps.hmacSecretVersion,
        clockMode: deps.clockMode,
        randomSeed: 0,
        selectionSource: selection.result.source,
        submittedAt: nowIso,
        createdAt: nowIso,
      })
      .run();

    const compiled = compileScenario(definition, {
      intentionId: intention.id,
      scenarioRevisionId: revisionId,
      submittedAt: now,
    });

    tx.update(scenarioRuns).set({ randomSeed: compiled.seed }).where(eq(scenarioRuns.id, scenarioRunId)).run();

    compiled.actions.forEach((action, index) => {
      tx.insert(scheduledActions)
        .values({
          id: generateOpaqueId("sched"),
          transactionId: txnRow.id,
          scenarioRunId,
          scenarioActionId: action.actionId,
          actionType: action.action,
          payloadJson: action.params,
          dueAt: action.dueAt.toISOString(),
          status: "scheduled",
          stepIndex: index,
          createdAt: nowIso,
          updatedAt: nowIso,
        })
        .run();
    });

    return { ok: true, transactionId: txnRow.id, scenarioRunId, replay: false };
  });
}

export type { ScenarioSelectionResult };
