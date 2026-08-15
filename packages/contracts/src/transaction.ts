import { z } from "zod";
import type { TransactionHmacFields } from "./hmac.js";

// Frozen transaction callback payload fixture (spec section 14.2). Field
// names and nesting are provider-shaped and must not be renamed.

export const sourceDataSchema = z.object({
  type: z.literal("card"),
  pan: z.string(),
  sub_type: z.string(),
});

export const orderObjectSchema = z.object({
  id: z.number().int().positive(),
  created_at: z.string(),
  delivery_needed: z.boolean(),
  merchant: z.object({ id: z.number().int().positive() }),
  collector: z.null(),
  amount_cents: z.number().int().nonnegative(),
  shipping_data: z.null(),
  currency: z.string(),
  is_payment_locked: z.boolean(),
  merchant_order_id: z.string(),
  wallet_notification: z.null(),
  paid_amount_cents: z.number().int().nonnegative(),
  notify_user_with_email: z.boolean(),
  items: z.array(z.unknown()),
});

export const transactionObjSchema = z.object({
  id: z.number().int().positive(),
  pending: z.boolean(),
  amount_cents: z.number().int().nonnegative(),
  success: z.boolean(),
  is_auth: z.boolean(),
  is_capture: z.boolean(),
  is_standalone_payment: z.boolean(),
  is_voided: z.boolean(),
  is_refunded: z.boolean(),
  is_3d_secure: z.boolean(),
  integration_id: z.number().int().positive(),
  profile_id: z.number().int().positive(),
  has_parent_transaction: z.boolean(),
  order: orderObjectSchema,
  created_at: z.string(),
  currency: z.string(),
  source_data: sourceDataSchema,
  api_source: z.literal("OTHER"),
  terminal_id: z.null(),
  merchant_commission: z.literal(0),
  installment: z.null(),
  discount_details: z.array(z.unknown()),
  is_void: z.boolean(),
  is_refund: z.boolean(),
  data: z.object({ message: z.string() }),
  is_hidden: z.literal(false),
  payment_key_claims: z.object({}),
  error_occured: z.boolean(),
  is_live: z.literal(false),
  other_endpoint_reference: z.null(),
  refunded_amount_cents: z.number().int().nonnegative(),
  source_id: z.literal(-1),
  is_captured: z.boolean(),
  captured_amount: z.number().int().nonnegative(),
  merchant_staff_tag: z.null(),
  owner: z.number().int().positive(),
  parent_transaction: z.number().int().positive().nullable(),
});

export type TransactionObj = z.infer<typeof transactionObjSchema>;

export const transactionCallbackSchema = z.object({
  type: z.literal("TRANSACTION"),
  obj: transactionObjSchema,
});

export type TransactionCallback = z.infer<typeof transactionCallbackSchema>;

export const cardTokenObjSchema = z.object({
  id: z.number().int().positive(),
  token: z.string(),
  masked_pan: z.string(),
  merchant_id: z.number().int().positive(),
  card_subtype: z.string(),
  created_at: z.string(),
  email: z.string(),
  order_id: z.string(),
  user_added: z.boolean(),
  next_payment_intention: z.string(),
});

export type CardTokenObj = z.infer<typeof cardTokenObjSchema>;

export const cardTokenCallbackSchema = z.object({
  type: z.literal("TOKEN"),
  obj: cardTokenObjSchema,
});

export type CardTokenCallback = z.infer<typeof cardTokenCallbackSchema>;

export function transactionObjToHmacFields(obj: TransactionObj): TransactionHmacFields {
  return {
    amountCents: obj.amount_cents,
    createdAt: obj.created_at,
    currency: obj.currency,
    errorOccured: obj.error_occured,
    hasParentTransaction: obj.has_parent_transaction,
    id: obj.id,
    integrationId: obj.integration_id,
    is3dSecure: obj.is_3d_secure,
    isAuth: obj.is_auth,
    isCapture: obj.is_capture,
    isRefunded: obj.is_refunded,
    isStandalonePayment: obj.is_standalone_payment,
    isVoided: obj.is_voided,
    orderId: obj.order.id,
    owner: obj.owner,
    pending: obj.pending,
    sourceDataPan: obj.source_data.pan,
    sourceDataSubType: obj.source_data.sub_type,
    sourceDataType: obj.source_data.type,
    success: obj.success,
  };
}

// Flat query-key order for the redirect HMAC (spec section 14.5). The value
// ordering/normalization is identical to the POST HMAC; only the "order" vs
// "order_id" query key label differs between redirect profiles.
export const REDIRECT_HMAC_QUERY_KEYS_ORDER_PROFILE = [
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
  "order", // or order_id, depending on the active redirect profile
  "owner",
  "pending",
  "source_data_pan",
  "source_data_sub_type",
  "source_data_type",
  "success",
] as const;
