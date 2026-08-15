import { and, eq, inArray } from "drizzle-orm";
import type Database from "better-sqlite3";
import type { AppDatabase } from "../database/connect.js";
import {
  scenarioRuns,
  scheduledActions,
  transactions,
  transactionSnapshots,
  webhookDeliveries,
} from "../database/schema.js";
import type { Clock } from "./clock.js";
import { getTransactionById, transitionTransaction, createNonCanonicalSnapshot } from "./transaction-service.js";
import { buildTransactionObj } from "./transaction-payload.js";
import { corruptExistingCallback, getCallbackEvent, materializeTransactionCallback } from "./webhook-payload.js";
import { attemptDelivery, createDelivery, type RetryPolicy } from "./webhook-delivery.js";
import { buildRedirectUrl, type BrowserRedirectStatus } from "./redirect-builder.js";
import { createBrowserEvent } from "./browser-events.js";
import { findLatestCheckoutSessionForIntention } from "./checkout-sessions-repository.js";
import type { AllowlistEntry } from "../security/allowlist.js";
import type { DnsResolver } from "../security/dns-pin.js";
import type { RedirectMode } from "@paymob-simulator/contracts";

export type ScheduledActionRow = typeof scheduledActions.$inferSelect;

export interface SchedulerDeps {
  db: AppDatabase;
  raw: Database.Database;
  clock: Clock;
  workerOwnerId: string;
  leaseDurationMs: number;
  getHmacSecretForVersion: (version: number) => string;
  allowlist: readonly AllowlistEntry[];
  allowPrivateNetworks: boolean;
  resolver: DnsResolver;
  requestTimeoutMs: number;
  retryPolicy: RetryPolicy;
  defaultRedirectMode: RedirectMode;
}

function claimDueActions(deps: SchedulerDeps, now: Date, batchSize: number): ScheduledActionRow[] {
  const leaseExpiresAt = new Date(now.getTime() + deps.leaseDurationMs).toISOString();
  const nowIso = now.toISOString();

  const claimed = deps.raw
    .prepare(
      `UPDATE scheduled_actions
       SET status = 'leased', lease_owner = ?, lease_expires_at = ?, updated_at = ?
       WHERE id IN (
         SELECT id FROM scheduled_actions
         WHERE (status = 'scheduled' AND due_at <= ?)
            OR (status = 'leased' AND lease_expires_at <= ?)
         ORDER BY due_at, step_index, id
         LIMIT ?
       )
       RETURNING id`,
    )
    .all(deps.workerOwnerId, leaseExpiresAt, nowIso, nowIso, nowIso, batchSize) as { id: string }[];

  if (claimed.length === 0) return [];
  const ids = claimed.map((c) => c.id);
  const rows = deps.db.select().from(scheduledActions).where(inArray(scheduledActions.id, ids)).all();
  rows.sort((a, b) => {
    const dueDiff = new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
    if (dueDiff !== 0) return dueDiff;
    return a.stepIndex - b.stepIndex;
  });
  return rows;
}

function markActionStatus(db: AppDatabase, actionId: string, status: string, now: Date): void {
  db.update(scheduledActions)
    .set({ status, updatedAt: now.toISOString() })
    .where(eq(scheduledActions.id, actionId))
    .run();
}

function findCallbackEventForScenarioAction(db: AppDatabase, transactionId: string, scenarioActionId: string) {
  const action = db
    .select()
    .from(scheduledActions)
    .where(
      and(eq(scheduledActions.transactionId, transactionId), eq(scheduledActions.scenarioActionId, scenarioActionId)),
    )
    .get();
  if (!action) return undefined;
  const delivery = db.select().from(webhookDeliveries).where(eq(webhookDeliveries.scheduledActionId, action.id)).get();
  if (!delivery) return undefined;
  return getCallbackEvent(db, delivery.callbackEventId);
}

function findSnapshotForScenarioAction(db: AppDatabase, transactionId: string, scenarioActionId: string) {
  return db
    .select()
    .from(transactionSnapshots)
    .where(
      and(
        eq(transactionSnapshots.transactionId, transactionId),
        eq(transactionSnapshots.sourceActionId, scenarioActionId),
      ),
    )
    .get();
}

async function deliverAndAttempt(
  deps: SchedulerDeps,
  action: ScheduledActionRow,
  callbackEventId: string,
  eventType: string,
  targetUrl: string,
  now: Date,
): Promise<void> {
  const delivery = createDelivery(
    deps.db,
    {
      callbackEventId,
      transactionId: action.transactionId ?? undefined,
      eventType,
      targetUrl,
      scheduledActionId: action.id,
    },
    now,
  );
  await attemptDelivery(
    {
      db: deps.db,
      clock: deps.clock,
      allowlist: deps.allowlist,
      allowPrivateNetworks: deps.allowPrivateNetworks,
      resolver: deps.resolver,
      requestTimeoutMs: deps.requestTimeoutMs,
      retryPolicy: deps.retryPolicy,
    },
    delivery,
  );
}

async function executeAction(deps: SchedulerDeps, action: ScheduledActionRow, now: Date): Promise<void> {
  const { db } = deps;
  const params = action.payloadJson as Record<string, unknown>;

  switch (action.actionType) {
    case "transaction.transition": {
      if (!action.transactionId) break;
      transitionTransaction(db, action.transactionId, params.to as never, now, {
        sourceActionId: action.scenarioActionId,
      });
      break;
    }

    case "transaction.snapshot": {
      if (!action.transactionId) break;
      createNonCanonicalSnapshot(db, action.transactionId, params.state as never, now, action.scenarioActionId);
      break;
    }

    case "webhook.omit": {
      // Audit-only: intentionally creates no callback event, delivery, or attempt.
      break;
    }

    case "webhook.transaction": {
      if (!action.transactionId) break;
      const scenarioRun = getScenarioRunForTransaction(db, action.transactionId);
      if (!scenarioRun?.notificationUrl) break;
      const txn = getTransactionById(db, action.transactionId);
      if (!txn) break;

      let obj = buildTransactionObj(txn);
      if (params.snapshot !== "current") {
        const snap = findSnapshotForScenarioAction(db, action.transactionId, params.snapshot as string);
        if (snap) obj = snap.payloadJson as typeof obj;
      }
      const hmacSecret = deps.getHmacSecretForVersion(scenarioRun.hmacSecretVersion);
      const event = materializeTransactionCallback(db, action.transactionId, obj, hmacSecret, now, {
        sourceSnapshotId: action.scenarioActionId,
      });
      await deliverAndAttempt(deps, action, event.id, "transaction", scenarioRun.notificationUrl, now);
      break;
    }

    case "webhook.repeat": {
      if (!action.transactionId) break;
      const scenarioRun = getScenarioRunForTransaction(db, action.transactionId);
      if (!scenarioRun?.notificationUrl) break;
      const source = findCallbackEventForScenarioAction(db, action.transactionId, params.sourceActionId as string);
      if (!source) break;
      await deliverAndAttempt(deps, action, source.id, source.eventType, scenarioRun.notificationUrl, now);
      break;
    }

    case "webhook.corrupt_hmac": {
      if (!action.transactionId) break;
      const scenarioRun = getScenarioRunForTransaction(db, action.transactionId);
      if (!scenarioRun?.notificationUrl) break;
      const source = findCallbackEventForScenarioAction(db, action.transactionId, params.sourceActionId as string);
      let event;
      if (source) {
        event = corruptExistingCallback(db, source, now);
      } else {
        const txn = getTransactionById(db, action.transactionId);
        if (!txn) break;
        const hmacSecret = deps.getHmacSecretForVersion(scenarioRun.hmacSecretVersion);
        event = materializeTransactionCallback(db, action.transactionId, buildTransactionObj(txn), hmacSecret, now, {
          signatureMode: "corrupt",
        });
      }
      await deliverAndAttempt(deps, action, event.id, event.eventType, scenarioRun.notificationUrl, now);
      break;
    }

    case "webhook.retry": {
      const delivery = db
        .select()
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.id, params.deliveryId as string))
        .get();
      if (!delivery) break;
      await attemptDelivery(
        {
          db,
          clock: deps.clock,
          allowlist: deps.allowlist,
          allowPrivateNetworks: deps.allowPrivateNetworks,
          resolver: deps.resolver,
          requestTimeoutMs: deps.requestTimeoutMs,
          retryPolicy: deps.retryPolicy,
        },
        delivery,
      );
      break;
    }

    case "browser.redirect":
    case "browser.show_result":
    case "three_ds.open": {
      if (!action.transactionId) break;
      const txn = getTransactionById(db, action.transactionId);
      if (!txn || !txn.intentionId) break;
      const session = findLatestCheckoutSessionForIntention(db, txn.intentionId);
      const scenarioRun = getScenarioRunForTransaction(db, action.transactionId);

      let payload: Record<string, unknown>;
      if (action.actionType === "browser.redirect") {
        const status = (params.status as BrowserRedirectStatus) ?? "success";
        const redirectionUrl = scenarioRun?.redirectionUrl;
        const url = redirectionUrl
          ? buildRedirectUrl({
              baseUrl: redirectionUrl,
              mode: deps.defaultRedirectMode,
              obj: buildTransactionObj(txn),
              browserStatus: status,
              hmacSecret: deps.getHmacSecretForVersion(scenarioRun?.hmacSecretVersion ?? 1),
            })
          : undefined;
        payload = { status, url };
      } else if (action.actionType === "three_ds.open") {
        payload = { prompt: params.prompt ?? "Enter the one-time passcode" };
      } else {
        payload = { status: params.status, message: params.message };
      }

      createBrowserEvent(
        db,
        session,
        { transactionId: action.transactionId, type: action.actionType, payload, scenarioActionId: action.scenarioActionId },
        now,
      );
      break;
    }

    default:
      break;
  }

  markActionStatus(db, action.id, "delivered", now);
}

function getScenarioRunForTransaction(db: AppDatabase, transactionId: string) {
  const txn = db.select().from(transactions).where(eq(transactions.id, transactionId)).get();
  if (!txn?.scenarioRunId) return undefined;
  return db.select().from(scenarioRuns).where(eq(scenarioRuns.id, txn.scenarioRunId)).get();
}

export async function runSchedulerTick(deps: SchedulerDeps, batchSize = 25): Promise<{ executed: number }> {
  const now = deps.clock.now();
  const due = claimDueActions(deps, now, batchSize);
  for (const action of due) {
    await executeAction(deps, action, deps.clock.now());
  }
  return { executed: due.length };
}
