import { projectPaymobFlags, type InternalState, type TransactionObj } from "@paymob-simulator/contracts";
import type { transactions } from "../database/schema.js";
import { formatCallbackTimestamp } from "./timestamps.js";

export type TransactionRow = typeof transactions.$inferSelect;

export interface BuildTransactionObjOptions {
  parentProviderNumericId?: number | null;
  overrideCreatedAt?: Date;
}

/**
 * Builds the frozen `obj` payload shape (spec 14.2) from a persisted
 * transaction row. This is the single place that projects internal state to
 * Paymob flags -- callers must not recompute flags themselves (13.3).
 */
export function buildTransactionObj(row: TransactionRow, opts: BuildTransactionObjOptions = {}): TransactionObj {
  const flags = projectPaymobFlags(row.state as InternalState, {
    originalAmountCents: row.amountCents,
    refundedAmountCents: row.refundedAmountCents,
    declineMessage: row.declineMessage ?? undefined,
  });

  const createdAt = formatCallbackTimestamp(opts.overrideCreatedAt ?? new Date(row.createdAt));

  return {
    id: row.providerNumericId,
    pending: flags.pending,
    amount_cents: row.amountCents,
    success: flags.success,
    is_auth: flags.isAuth,
    is_capture: flags.isCapture,
    is_standalone_payment: flags.isStandalonePayment,
    is_voided: flags.isVoided,
    is_refunded: flags.isRefunded,
    is_3d_secure: row.is3dSecure,
    integration_id: row.integrationId,
    profile_id: row.profileId,
    has_parent_transaction: row.hasParentTransaction,
    order: {
      id: row.orderId,
      created_at: createdAt,
      delivery_needed: false,
      merchant: { id: row.profileId },
      collector: null,
      amount_cents: row.amountCents,
      shipping_data: null,
      currency: row.currency,
      is_payment_locked: false,
      merchant_order_id: row.merchantOrderId,
      wallet_notification: null,
      paid_amount_cents: row.amountCents,
      notify_user_with_email: false,
      items: [],
    },
    created_at: createdAt,
    currency: row.currency,
    source_data: {
      type: row.sourceType as "card",
      pan: row.sourceLastFour,
      sub_type: row.sourceSubType,
    },
    api_source: "OTHER",
    terminal_id: null,
    merchant_commission: 0,
    installment: null,
    discount_details: [],
    is_void: flags.isVoid,
    is_refund: flags.isRefund,
    data: { message: flags.message },
    is_hidden: false,
    payment_key_claims: {},
    error_occured: flags.errorOccured,
    is_live: false,
    other_endpoint_reference: null,
    refunded_amount_cents: flags.refundedAmountCents,
    source_id: -1,
    is_captured: flags.isCaptured,
    captured_amount: flags.capturedAmount,
    merchant_staff_tag: null,
    owner: row.ownerId,
    parent_transaction: opts.parentProviderNumericId ?? null,
  };
}
