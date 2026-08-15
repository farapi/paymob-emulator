import { eq } from "drizzle-orm";
import type { AppDatabase } from "../database/connect.js";
import { webhookAttempts, webhookDeliveries, scheduledActions } from "../database/schema.js";
import type { Clock } from "./clock.js";
import { generateDeliveryId, generateOpaqueId } from "./ids.js";
import { appendCallbackHmac, getCallbackEvent } from "./webhook-payload.js";
import type { AllowlistEntry } from "../security/allowlist.js";
import type { DnsResolver } from "../security/dns-pin.js";
import { performSafeRequest } from "../security/safe-http-client.js";

export type WebhookDeliveryRow = typeof webhookDeliveries.$inferSelect;
export type WebhookAttemptRow = typeof webhookAttempts.$inferSelect;

export interface RetryPolicy {
  retryOnTransportError: boolean;
  retryOnStatuses: number[];
  intervalsMs: number[];
  maxAttempts: number;
}

export interface CreateDeliveryParams {
  callbackEventId: string;
  transactionId?: string | undefined;
  eventType: string;
  targetUrl: string;
  scheduledActionId?: string | undefined;
  originalDeliveryId?: string | undefined;
}

export function createDelivery(db: AppDatabase, params: CreateDeliveryParams, now: Date): WebhookDeliveryRow {
  const id = generateDeliveryId();
  db.insert(webhookDeliveries)
    .values({
      id,
      transactionId: params.transactionId ?? null,
      callbackEventId: params.callbackEventId,
      eventType: params.eventType,
      targetUrl: params.targetUrl,
      scheduledActionId: params.scheduledActionId ?? null,
      originalDeliveryId: params.originalDeliveryId ?? null,
      status: "scheduled",
      createdAt: now.toISOString(),
    })
    .run();
  const row = db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, id)).get();
  if (!row) throw new Error("failed to read back created delivery");
  return row;
}

export interface AttemptDeliveryDeps {
  db: AppDatabase;
  clock: Clock;
  allowlist: readonly AllowlistEntry[];
  allowPrivateNetworks: boolean;
  resolver: DnsResolver;
  requestTimeoutMs: number;
  retryPolicy: RetryPolicy;
}

export type RetryDecision = "delivered" | "retry_scheduled" | "exhausted" | "failed_terminal";

function decideRetry(
  outcome: Awaited<ReturnType<typeof performSafeRequest>>,
  attemptNumber: number,
  policy: RetryPolicy,
): RetryDecision {
  if (outcome.outcome === "response") {
    if (outcome.status >= 200 && outcome.status < 300) return "delivered";
    if (!policy.retryOnStatuses.includes(outcome.status)) return "failed_terminal";
  } else if (outcome.outcome === "transport_error") {
    if (!policy.retryOnTransportError) return "failed_terminal";
  } else {
    return "failed_terminal";
  }
  return attemptNumber >= policy.maxAttempts ? "exhausted" : "retry_scheduled";
}

/** Performs one physical HTTP delivery attempt, records it, and schedules a retry if the policy calls for one. */
export async function attemptDelivery(
  deps: AttemptDeliveryDeps,
  delivery: WebhookDeliveryRow,
): Promise<{ attempt: WebhookAttemptRow; decision: RetryDecision }> {
  const { db, clock } = deps;
  const event = getCallbackEvent(db, delivery.callbackEventId);
  if (!event) throw new Error(`callback event "${delivery.callbackEventId}" not found for delivery`);

  const priorAttempts = db
    .select()
    .from(webhookAttempts)
    .where(eq(webhookAttempts.deliveryId, delivery.id))
    .all();
  const attemptNumber = priorAttempts.length + 1;

  const url = appendCallbackHmac(delivery.targetUrl, event.hmac);
  const requestHeaders = {
    "content-type": event.contentType,
    "user-agent": "paymob-simulator/0.1.0",
    "x-paymob-simulator-delivery": delivery.id,
  };

  const startedAt = clock.now();
  const result = await performSafeRequest(url, {
    method: "POST",
    headers: requestHeaders,
    body: event.bodyBytes,
    allowlist: deps.allowlist,
    allowPrivateNetworks: deps.allowPrivateNetworks,
    resolver: deps.resolver,
    totalTimeoutMs: deps.requestTimeoutMs,
    maxResponseBodyBytes: 64 * 1024,
  });
  const finishedAt = clock.now();

  const decision = decideRetry(result, attemptNumber, deps.retryPolicy);

  const attemptId = generateOpaqueId("att");
  db.insert(webhookAttempts)
    .values({
      id: attemptId,
      deliveryId: delivery.id,
      attemptNumber,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      requestHeadersJson: requestHeaders,
      responseStatus: result.outcome === "response" ? result.status : null,
      responseHeadersJson: result.outcome === "response" ? result.headers : null,
      responseBodyExcerpt: result.outcome === "response" ? result.bodyExcerpt : null,
      transportErrorCode:
        result.outcome === "transport_error" ? result.code : result.outcome === "policy_rejected" ? "POLICY_REJECTED" : null,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      retryDecision: decision,
    })
    .run();

  const deliveryStatus =
    decision === "delivered"
      ? "delivered"
      : decision === "retry_scheduled"
        ? "retry_scheduled"
        : decision === "exhausted"
          ? "exhausted"
          : "failed";

  db.update(webhookDeliveries)
    .set({
      status: deliveryStatus,
      completedAt: decision === "delivered" || decision === "exhausted" || decision === "failed_terminal" ? finishedAt.toISOString() : null,
    })
    .where(eq(webhookDeliveries.id, delivery.id))
    .run();

  if (decision === "retry_scheduled") {
    const intervalMs = deps.retryPolicy.intervalsMs[attemptNumber - 1] ?? deps.retryPolicy.intervalsMs.at(-1) ?? 5_000;
    const dueAt = new Date(finishedAt.getTime() + intervalMs);
    db.insert(scheduledActions)
      .values({
        id: generateOpaqueId("sched"),
        transactionId: delivery.transactionId,
        scenarioActionId: `retry:${delivery.id}`,
        actionType: "webhook.retry",
        payloadJson: { deliveryId: delivery.id },
        dueAt: dueAt.toISOString(),
        status: "scheduled",
        createdAt: finishedAt.toISOString(),
        updatedAt: finishedAt.toISOString(),
      })
      .run();
  }

  const attempt = db.select().from(webhookAttempts).where(eq(webhookAttempts.id, attemptId)).get();
  if (!attempt) throw new Error("failed to read back webhook attempt");
  return { attempt, decision };
}
