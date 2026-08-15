import { createHmac } from "node:crypto";

// Golden HMAC contract: spec section 14.3 (transaction), 14.5 (redirect —
// same value ordering, different query key), 14.6 (card token).
// Do not reorder these fields; golden fixtures in
// packages/test-fixtures depend on exact concatenation order.

export interface TransactionHmacFields {
  amountCents: number;
  createdAt: string;
  currency: string;
  errorOccured: boolean;
  hasParentTransaction: boolean;
  id: number;
  integrationId: number;
  is3dSecure: boolean;
  isAuth: boolean;
  isCapture: boolean;
  isRefunded: boolean;
  isStandalonePayment: boolean;
  isVoided: boolean;
  orderId: number;
  owner: number;
  pending: boolean;
  sourceDataPan: string;
  sourceDataSubType: string;
  sourceDataType: string;
  success: boolean;
}

export interface CardTokenHmacFields {
  cardSubtype: string;
  createdAt: string;
  email: string;
  id: number;
  maskedPan: string;
  merchantId: number;
  orderId: string;
  token: string;
}

export type NormalizableValue = string | number | boolean | null | undefined;

// Boolean -> lowercase true/false. Number -> base-10 string. String -> unchanged.
// null/undefined -> empty string (only legitimate for genuinely optional fields).
export function normalizeHmacValue(value: NormalizableValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  return value;
}

export function transactionHmacConcatenation(f: TransactionHmacFields): string {
  return (
    [
      f.amountCents,
      f.createdAt,
      f.currency,
      f.errorOccured,
      f.hasParentTransaction,
      f.id,
      f.integrationId,
      f.is3dSecure,
      f.isAuth,
      f.isCapture,
      f.isRefunded,
      f.isStandalonePayment,
      f.isVoided,
      f.orderId,
      f.owner,
      f.pending,
      f.sourceDataPan,
      f.sourceDataSubType,
      f.sourceDataType,
      f.success,
    ] satisfies NormalizableValue[]
  )
    .map(normalizeHmacValue)
    .join("");
}

export function computeTransactionHmac(f: TransactionHmacFields, secret: string): string {
  return createHmac("sha512", secret).update(transactionHmacConcatenation(f)).digest("hex");
}

export function cardTokenHmacConcatenation(f: CardTokenHmacFields): string {
  return (
    [
      f.cardSubtype,
      f.createdAt,
      f.email,
      f.id,
      f.maskedPan,
      f.merchantId,
      f.orderId,
      f.token,
    ] satisfies NormalizableValue[]
  )
    .map(normalizeHmacValue)
    .join("");
}

export function computeCardTokenHmac(f: CardTokenHmacFields, secret: string): string {
  return createHmac("sha512", secret).update(cardTokenHmacConcatenation(f)).digest("hex");
}

// Deterministically corrupt a lowercase-hex digest by flipping its final
// nibble (spec section 14.4 / webhook.corrupt_hmac "flip_last_hex").
export function flipLastHexNibble(hex: string): string {
  if (hex.length === 0) throw new Error("cannot flip an empty hex string");
  const last = hex[hex.length - 1];
  const flipped = last === "0" ? "1" : "0";
  return hex.slice(0, -1) + flipped;
}
