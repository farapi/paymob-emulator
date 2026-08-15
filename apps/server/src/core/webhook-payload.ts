import {
  computeTransactionHmac,
  flipLastHexNibble,
  transactionObjToHmacFields,
  type TransactionObj,
} from "@paymob-simulator/contracts";
import { eq } from "drizzle-orm";
import type { AppDatabase } from "../database/connect.js";
import { callbackEvents } from "../database/schema.js";
import { generateOpaqueId } from "./ids.js";

export type CallbackEventRow = typeof callbackEvents.$inferSelect;

export interface MaterializeTransactionCallbackOptions {
  signatureMode?: "valid" | "corrupt";
  mergePatch?: Record<string, unknown>;
  sourceSnapshotId?: string;
}

function applyMergePatch(obj: TransactionObj, patch: Record<string, unknown>): TransactionObj {
  const clone = structuredClone(obj) as Record<string, unknown>;
  for (const [path, value] of Object.entries(patch)) {
    const parts = path.split("/").filter((p) => p.length > 0);
    let cursor: Record<string, unknown> = clone;
    for (let i = 0; i < parts.length - 1; i += 1) {
      cursor = cursor[parts[i] as string] as Record<string, unknown>;
    }
    cursor[parts[parts.length - 1] as string] = value;
  }
  return clone as unknown as TransactionObj;
}

/**
 * Materializes one immutable transaction callback event: builds the frozen
 * payload bytes once, signs (or deliberately corrupts) the HMAC, and
 * persists both together so later retries/duplicates reuse the exact bytes
 * (spec 14.1, 18.2).
 */
export function materializeTransactionCallback(
  db: AppDatabase,
  transactionId: string,
  obj: TransactionObj,
  hmacSecret: string,
  now: Date,
  opts: MaterializeTransactionCallbackOptions = {},
): CallbackEventRow {
  const finalObj = opts.mergePatch ? applyMergePatch(obj, opts.mergePatch) : obj;
  const fields = transactionObjToHmacFields(finalObj);
  let hmac = computeTransactionHmac(fields, hmacSecret);
  const signatureMode = opts.signatureMode ?? "valid";
  if (signatureMode === "corrupt") hmac = flipLastHexNibble(hmac);

  const bodyBytes = JSON.stringify({ type: "TRANSACTION", obj: finalObj });
  const id = generateOpaqueId("cbev");

  db.insert(callbackEvents)
    .values({
      id,
      transactionId,
      eventType: "transaction",
      canonical: true,
      bodyBytes,
      contentType: "application/json",
      hmac,
      signatureMode,
      sourceSnapshotId: opts.sourceSnapshotId ?? null,
      createdAt: now.toISOString(),
    })
    .run();

  const row = db.select().from(callbackEvents).where(eq(callbackEvents.id, id)).get();
  if (!row) throw new Error("failed to read back materialized callback event");
  return row;
}

/** Deterministically re-corrupts an existing callback event's bytes into a new immutable event (webhook.corrupt_hmac). */
export function corruptExistingCallback(db: AppDatabase, source: CallbackEventRow, now: Date): CallbackEventRow {
  const id = generateOpaqueId("cbev");
  db.insert(callbackEvents)
    .values({
      id,
      transactionId: source.transactionId,
      eventType: source.eventType,
      canonical: source.canonical,
      bodyBytes: source.bodyBytes,
      contentType: source.contentType,
      hmac: flipLastHexNibble(source.hmac),
      signatureMode: "corrupt",
      sourceSnapshotId: source.sourceSnapshotId,
      createdAt: now.toISOString(),
    })
    .run();
  const row = db.select().from(callbackEvents).where(eq(callbackEvents.id, id)).get();
  if (!row) throw new Error("failed to read back corrupted callback event");
  return row;
}

export function getCallbackEvent(db: AppDatabase, id: string): CallbackEventRow | undefined {
  return db.select().from(callbackEvents).where(eq(callbackEvents.id, id)).get();
}

/**
 * Appends the transaction HMAC as the `hmac` query parameter, removing every
 * pre-existing `hmac` key first (case-sensitive), preserving other params
 * (spec 14.1).
 */
export function appendCallbackHmac(targetUrl: string, hmac: string): string {
  const url = new URL(targetUrl);
  const kept = [...url.searchParams.entries()].filter(([key]) => key !== "hmac");
  url.search = "";
  for (const [key, value] of kept) url.searchParams.append(key, value);
  url.searchParams.append("hmac", hmac);
  return url.toString();
}
