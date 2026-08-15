import {
  computeTransactionHmac,
  normalizeHmacValue,
  transactionObjToHmacFields,
  type RedirectMode,
  type TransactionObj,
} from "@paymob-simulator/contracts";

// Redirect URL construction (spec section 14.5). Two named profiles sign the
// identical value string but label the order-identifying key differently.

const CANONICAL_QUERY_KEYS = [
  "amount_cents",
  "created_at",
  "currency",
  "error_occured",
  "has_parent_transaction",
  "id",
  "integration_id",
  "is_3d_secure",
  "is_auth",
  "is_capture",
  "is_refunded",
  "is_standalone_payment",
  "is_voided",
  "order",
  "owner",
  "pending",
  "source_data_pan",
  "source_data_sub_type",
  "source_data_type",
  "success",
] as const;

const ALL_SIMULATOR_OWNED_KEYS = new Set([
  ...CANONICAL_QUERY_KEYS,
  "order_id",
  "amount",
  "hmac",
  "simulator_status",
  "transaction_id",
]);

export type BrowserRedirectStatus = "success" | "failed" | "pending" | "cancelled" | "expired";

export interface BuildRedirectUrlOptions {
  baseUrl: string;
  mode: RedirectMode;
  obj: TransactionObj;
  browserStatus: BrowserRedirectStatus;
  hmacSecret: string;
}

function stripOwnedParams(url: URL): [string, string][] {
  return [...url.searchParams.entries()].filter(([key]) => !ALL_SIMULATOR_OWNED_KEYS.has(key));
}

export function buildRedirectUrl(opts: BuildRedirectUrlOptions): string {
  const url = new URL(opts.baseUrl);
  url.hash = "";
  const kept = stripOwnedParams(url);
  url.search = "";
  for (const [key, value] of kept) url.searchParams.append(key, value);

  if (opts.mode === "no_parameters") {
    return url.toString();
  }

  if (opts.mode === "minimal_status") {
    url.searchParams.append("simulator_status", opts.browserStatus);
    url.searchParams.append("transaction_id", String(opts.obj.id));
    return url.toString();
  }

  const fields = transactionObjToHmacFields(opts.obj);
  const hmac = computeTransactionHmac(fields, opts.hmacSecret);
  const canonicalOrderKey = opts.mode === "paymob_query_order_id" ? "order_id" : "order";

  const valuesByKey: Record<string, string> = {
    amount_cents: normalizeHmacValue(fields.amountCents),
    created_at: fields.createdAt,
    currency: fields.currency,
    error_occured: normalizeHmacValue(fields.errorOccured),
    has_parent_transaction: normalizeHmacValue(fields.hasParentTransaction),
    id: normalizeHmacValue(fields.id),
    integration_id: normalizeHmacValue(fields.integrationId),
    is_3d_secure: normalizeHmacValue(fields.is3dSecure),
    is_auth: normalizeHmacValue(fields.isAuth),
    is_capture: normalizeHmacValue(fields.isCapture),
    is_refunded: normalizeHmacValue(fields.isRefunded),
    is_standalone_payment: normalizeHmacValue(fields.isStandalonePayment),
    is_voided: normalizeHmacValue(fields.isVoided),
    order: normalizeHmacValue(fields.orderId),
    owner: normalizeHmacValue(fields.owner),
    pending: normalizeHmacValue(fields.pending),
    source_data_pan: fields.sourceDataPan,
    source_data_sub_type: fields.sourceDataSubType,
    source_data_type: fields.sourceDataType,
    success: normalizeHmacValue(fields.success),
  };

  for (const key of CANONICAL_QUERY_KEYS) {
    const outputKey = key === "order" ? canonicalOrderKey : key;
    url.searchParams.append(outputKey, valuesByKey[key] as string);
  }
  url.searchParams.append("hmac", hmac);

  return url.toString();
}
