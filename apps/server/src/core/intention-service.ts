import { eq } from "drizzle-orm";
import type { AppDatabase } from "../database/connect.js";
import { intentions } from "../database/schema.js";
import type { Clock } from "./clock.js";
import { clientSecretDisplaySuffix, generateClientSecret, generateIntentionId } from "./ids.js";
import { hashOpaqueSecret } from "./secret-hash.js";
import type { NormalizedIntentionInput } from "./intention-validation.js";

export type IntentionRow = typeof intentions.$inferSelect;

export interface CreateIntentionOptions {
  defaultNotificationUrl?: string | undefined;
  defaultRedirectionUrl?: string | undefined;
  rawRequest: Record<string, unknown>;
}

export interface CreatedIntention {
  id: string;
  clientSecret: string;
  row: IntentionRow;
}

const RAW_REQUEST_MAX_BYTES = 256 * 1024;

function capRawRequest(raw: Record<string, unknown>): Record<string, unknown> {
  const serialized = JSON.stringify(raw);
  if (Buffer.byteLength(serialized, "utf-8") <= RAW_REQUEST_MAX_BYTES) return raw;
  return { _truncated: true, note: "raw request exceeded the size-limited snapshot cap" };
}

export function createIntention(
  db: AppDatabase,
  clock: Clock,
  input: NormalizedIntentionInput,
  opts: CreateIntentionOptions,
): CreatedIntention {
  const id = generateIntentionId();
  const clientSecret = generateClientSecret();
  const now = clock.now();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + input.expiration * 1000).toISOString();

  const notificationUrl = input.notificationUrl ?? opts.defaultNotificationUrl ?? null;
  const redirectionUrl = input.redirectionUrl ?? opts.defaultRedirectionUrl ?? null;
  const integrationId = input.paymentMethodIds[0] ?? null;

  db.insert(intentions)
    .values({
      id,
      clientSecretHash: hashOpaqueSecret(clientSecret),
      clientSecretDisplaySuffix: clientSecretDisplaySuffix(clientSecret),
      specialReference: input.specialReference ?? null,
      amount: input.amount,
      currency: input.currency,
      paymentMethodIdsJson: input.paymentMethodIds,
      billingDataJson: input.billingData ?? null,
      customerJson: input.customer ?? null,
      itemsJson: input.items,
      extrasJson: input.extras ?? null,
      rawRequestJson: capRawRequest(opts.rawRequest),
      notificationUrl,
      redirectionUrl,
      integrationId,
      status: "intended",
      createdAt: nowIso,
      updatedAt: nowIso,
      expiresAt,
    })
    .run();

  const row = db.select().from(intentions).where(eq(intentions.id, id)).get();
  if (!row) throw new Error("failed to read back inserted intention");

  return { id, clientSecret, row };
}

export type UpdateIntentionErrorReason = "not_found" | "already_submitted" | "expired" | "empty_body";
export type UpdateIntentionResult =
  | { ok: true; row: IntentionRow }
  | { ok: false; reason: UpdateIntentionErrorReason }
  | { ok: false; reason: "validation"; status: 404 | 406 | 422; body: unknown };

export function findIntentionByClientSecret(db: AppDatabase, clientSecret: string): IntentionRow | undefined {
  const hash = hashOpaqueSecret(clientSecret);
  return db.select().from(intentions).where(eq(intentions.clientSecretHash, hash)).get();
}

/** Reconstructs the provider-request shape from a persisted row, for merging with a PUT patch. */
function rowToRawInput(row: IntentionRow): Record<string, unknown> {
  return {
    amount: row.amount,
    currency: row.currency,
    payment_methods: row.paymentMethodIdsJson,
    items: row.itemsJson ?? undefined,
    billing_data: row.billingDataJson ?? undefined,
    customer: row.customerJson ?? undefined,
    special_reference: row.specialReference ?? undefined,
    notification_url: row.notificationUrl ?? undefined,
    redirection_url: row.redirectionUrl ?? undefined,
    extras: row.extrasJson ?? undefined,
  };
}

export interface UpdateIntentionDeps {
  db: AppDatabase;
  clock: Clock;
  clientSecret: string;
  rawPatch: Record<string, unknown>;
  validate: (merged: Record<string, unknown>) => import("./intention-validation.js").ValidationResult;
}

/**
 * PUT /v1/intention/:clientSecret (spec 9.1): merges the patch onto the
 * existing normalized request and re-validates the FULL merged object
 * (item totals, integration ids, URL policy) before persisting.
 */
export function updateIntention(deps: UpdateIntentionDeps): UpdateIntentionResult {
  const { db, clock, clientSecret, rawPatch } = deps;
  if (Object.keys(rawPatch).length === 0) return { ok: false, reason: "empty_body" };

  const existing = findIntentionByClientSecret(db, clientSecret);
  if (!existing) return { ok: false, reason: "not_found" };
  if (existing.status !== "intended") return { ok: false, reason: "already_submitted" };

  const now = clock.now();
  if (new Date(existing.expiresAt).getTime() <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }

  const merged = { ...rowToRawInput(existing), ...rawPatch };
  const validation = deps.validate(merged);
  if (!validation.ok) {
    return { ok: false, reason: "validation", status: validation.status, body: validation.body };
  }

  const data = validation.data;
  const nowIso = now.toISOString();
  const expiresAt =
    rawPatch.expiration !== undefined
      ? new Date(new Date(existing.createdAt).getTime() + data.expiration * 1000).toISOString()
      : existing.expiresAt;

  db.update(intentions)
    .set({
      amount: data.amount,
      currency: data.currency,
      paymentMethodIdsJson: data.paymentMethodIds,
      billingDataJson: data.billingData ?? null,
      customerJson: data.customer ?? null,
      itemsJson: data.items,
      extrasJson: data.extras ?? null,
      specialReference: data.specialReference ?? null,
      notificationUrl: data.notificationUrl ?? null,
      redirectionUrl: data.redirectionUrl ?? null,
      integrationId: data.paymentMethodIds[0] ?? existing.integrationId,
      updatedAt: nowIso,
      expiresAt,
      rawRequestJson: capRawRequest({ ...(existing.rawRequestJson as Record<string, unknown>), ...rawPatch }),
    })
    .where(eq(intentions.id, existing.id))
    .run();

  const row = db.select().from(intentions).where(eq(intentions.id, existing.id)).get();
  if (!row) throw new Error("failed to read back updated intention");
  return { ok: true, row };
}

export function getIntentionById(db: AppDatabase, id: string): IntentionRow | undefined {
  return db.select().from(intentions).where(eq(intentions.id, id)).get();
}
