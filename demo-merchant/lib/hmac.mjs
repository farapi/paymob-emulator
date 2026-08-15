// Independent reimplementation of Paymob's documented HMAC-SHA512
// verification (transaction callback + query-string redirect signature).
// Deliberately does NOT import anything from the simulator's own packages --
// a real merchant integration has no access to those and must not need any
// emulator-specific behavior to work correctly.
import { createHmac, timingSafeEqual } from "node:crypto";

const POST_FIELD_ORDER = [
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
  "order.id",
  "owner",
  "pending",
  "source_data.pan",
  "source_data.sub_type",
  "source_data.type",
  "success",
];

function normalize(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  return String(value);
}

function getPath(obj, path) {
  return path.split(".").reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

export function computeTransactionHmac(obj, secret) {
  const concatenated = POST_FIELD_ORDER.map((path) => normalize(getPath(obj, path))).join("");
  return createHmac("sha512", secret).update(concatenated).digest("hex");
}

export function verifyHmac(expected, provided) {
  if (typeof provided !== "string" || provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(provided, "hex"));
  } catch {
    return false;
  }
}

// Flat query-parameter field order for the redirect signature (spec 14.5).
// The order-identifying key is "order" or "order_id" depending on the
// merchant's configured redirect profile; try both since we don't control
// which the simulator instance uses.
const REDIRECT_FIELD_KEYS = (orderKey) => [
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
  orderKey,
  "owner",
  "pending",
  "source_data_pan",
  "source_data_sub_type",
  "source_data_type",
  "success",
];

export function computeRedirectHmac(query, secret, orderKey) {
  const concatenated = REDIRECT_FIELD_KEYS(orderKey).map((key) => query.get(key) ?? "").join("");
  return createHmac("sha512", secret).update(concatenated).digest("hex");
}

export function verifyRedirectHmac(query, secret) {
  const provided = query.get("hmac");
  if (!provided) return false;
  const orderKey = query.has("order") ? "order" : "order_id";
  const expected = computeRedirectHmac(query, secret, orderKey);
  return verifyHmac(expected, provided);
}
