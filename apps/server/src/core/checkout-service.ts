import { eq } from "drizzle-orm";
import type Database from "better-sqlite3";
import { normalizeCardNumber, type ClockMode } from "@paymob-simulator/contracts";
import { compileScenario, type ScenarioDefinition } from "@paymob-simulator/scenario-engine";
import type { AppDatabase } from "../database/connect.js";
import { intentions, scenarioRuns, transactions, scheduledActions } from "../database/schema.js";
import type { Clock } from "./clock.js";
import { generateOpaqueId } from "./ids.js";
import { findIntentionByClientSecret, getIntentionById, type IntentionRow } from "./intention-service.js";
import { getScenarioDefinition } from "./scenario-registry.js";
import { selectCheckoutScenario, type ScenarioSelectionResult, type ScenarioSelectionSource } from "./scenario-selection.js";
import { createTransaction, type TransactionRow } from "./transaction-service.js";

export interface CheckoutDeps {
  db: AppDatabase;
  raw: Database.Database;
  clock: Clock;
  hmacSecretVersion: number;
  clockMode: ClockMode;
  defaultIntegrationId: number;
}

export type ActivateFailureReason = "conflict";
export type ActivateResult =
  | { ok: true; transactionId: string; scenarioRunId: string; replay: boolean }
  | { ok: false; reason: ActivateFailureReason };

function findTransactionByIntentionId(db: AppDatabase, intentionId: string): TransactionRow | undefined {
  return db.select().from(transactions).where(eq(transactions.intentionId, intentionId)).get();
}

/**
 * Shared atomic activation core (spec 9.1, 12.1): consumes the intention,
 * creates exactly one transaction + scenario run, compiles the scenario
 * timeline into scheduled_actions. Used by both card-driven checkout
 * submission and the control-plane headless completion helper -- the only
 * difference between them is how the scenario and source card fields are
 * resolved before calling this.
 */
function activateScenarioForIntention(
  deps: CheckoutDeps,
  intention: IntentionRow,
  definition: ScenarioDefinition,
  selectionSource: ScenarioSelectionSource,
  sourceLastFour: string,
  sourceSubType: string,
  idempotencyKey: string | undefined,
): ActivateResult {
  const { db, raw, clock } = deps;
  const now = clock.now();

  return db.transaction((tx) => {
    const fresh = tx.select().from(intentions).where(eq(intentions.id, intention.id)).get();
    if (!fresh || fresh.status !== "intended") {
      if (fresh && idempotencyKey && fresh.idempotencyKey === idempotencyKey) {
        const txn = findTransactionByIntentionId(tx as unknown as AppDatabase, intention.id);
        if (txn) return { ok: true, transactionId: txn.id, scenarioRunId: txn.scenarioRunId ?? "", replay: true };
      }
      return { ok: false, reason: "conflict" };
    }

    const nowIso = now.toISOString();
    tx.update(intentions)
      .set({ status: "processing", idempotencyKey: idempotencyKey ?? null, updatedAt: nowIso })
      .where(eq(intentions.id, intention.id))
      .run();

    const scenarioRunId = generateOpaqueId("run");
    const revisionId = `${definition.id}@1`;

    const txnRow = createTransaction(raw, tx as unknown as AppDatabase, {
      intentionId: intention.id,
      amountCents: intention.amount,
      currency: intention.currency,
      integrationId: intention.integrationId ?? deps.defaultIntegrationId,
      merchantOrderId: intention.specialReference ?? intention.id,
      sourceLastFour,
      sourceSubType,
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
        selectionSource,
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

export interface SubmitCheckoutParams {
  clientSecret: string;
  cardNumber: string;
  cardholderName: string;
  idempotencyKey?: string | undefined;
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

/**
 * The single atomic checkout submission (spec 9.1, 12.1): validates the
 * card/alias/expectation, then activates the resolved scenario. A repeated
 * submission with the same idempotency key replays the original result
 * instead of creating a second transaction.
 */
export function submitCheckout(deps: CheckoutDeps, params: SubmitCheckoutParams): SubmitCheckoutResult {
  const intention = findIntentionByClientSecret(deps.db, params.clientSecret);
  if (!intention) return { ok: false, reason: "not_found" };

  const now = deps.clock.now();
  if (new Date(intention.expiresAt).getTime() <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }

  if (intention.status !== "intended") {
    if (params.idempotencyKey && intention.idempotencyKey === params.idempotencyKey) {
      const txn = findTransactionByIntentionId(deps.db, intention.id);
      if (txn) return { ok: true, transactionId: txn.id, scenarioRunId: txn.scenarioRunId ?? "", replay: true };
    }
    return { ok: false, reason: "conflict" };
  }

  const selection = selectCheckoutScenario(deps.db, now, {
    cardNumber: params.cardNumber,
    cardholderName: params.cardholderName,
    specialReference: intention.specialReference ?? undefined,
  });
  if (!selection.ok) return { ok: false, reason: selection.error.code };

  const definition = getScenarioDefinition(deps.db, selection.result.scenarioId);
  if (!definition) return { ok: false, reason: "unrecognized_card" };

  const lastFour = normalizeCardNumber(params.cardNumber).slice(-4);
  return activateScenarioForIntention(
    deps,
    intention,
    definition,
    selection.result.source,
    lastFour,
    "Visa",
    params.idempotencyKey,
  );
}

export interface CompleteHeadlessParams {
  intentionId: string;
  scenarioId?: string | undefined;
  idempotencyKey: string;
  defaultScenarioId: string;
}

export type CompleteHeadlessFailureReason = "not_found" | "expired" | "unrecognized_scenario" | "conflict";
export type CompleteHeadlessResult =
  | { ok: true; transactionId: string; scenarioRunId: string; replay: boolean }
  | { ok: false; reason: CompleteHeadlessFailureReason };

/**
 * POST /__simulator/api/intentions/:id/complete (spec 16.1, 16.2): a
 * control-plane test helper that behaves like a checkout submission without
 * a browser. Uses the configured default scenario only when scenarioId is
 * absent (11.5 rule 4) -- an api_fault scenario can never be selected here
 * (11.5: "API-fault expectations are consumed only by their named provider
 * API operation").
 */
export function completeIntentionHeadless(
  deps: CheckoutDeps,
  params: CompleteHeadlessParams,
): CompleteHeadlessResult {
  const intention = getIntentionById(deps.db, params.intentionId);
  if (!intention) return { ok: false, reason: "not_found" };

  const now = deps.clock.now();
  if (new Date(intention.expiresAt).getTime() <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }

  if (intention.status !== "intended") {
    if (intention.idempotencyKey === params.idempotencyKey) {
      const txn = findTransactionByIntentionId(deps.db, intention.id);
      if (txn) return { ok: true, transactionId: txn.id, scenarioRunId: txn.scenarioRunId ?? "", replay: true };
    }
    return { ok: false, reason: "conflict" };
  }

  const scenarioId = params.scenarioId ?? params.defaultScenarioId;
  const definition = getScenarioDefinition(deps.db, scenarioId);
  if (!definition || definition.classification === "api_fault") {
    return { ok: false, reason: "unrecognized_scenario" };
  }

  return activateScenarioForIntention(
    deps,
    intention,
    definition,
    "control_plane_complete",
    "0000",
    "Visa",
    params.idempotencyKey,
  );
}

export type { ScenarioSelectionResult };
