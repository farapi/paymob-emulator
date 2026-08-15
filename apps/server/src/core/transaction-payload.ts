import { projectPaymobFlags, type InternalState, type TransactionObj } from "@paymob-simulator/contracts";
import type { transactions } from "../database/schema.js";
import { formatCallbackTimestamp } from "./timestamps.js";

export type TransactionRow = typeof transactions.$inferSelect;

export interface BuildTransactionObjOptions {
  parentProviderNumericId?: number | null;
  overrideCreatedAt?: Date;
}

interface ProjectedPaymobFlagsLike {
  pending: boolean;
  success: boolean;
  errorOccured: boolean;
  message: string;
  isAuth: boolean;
  isCapture: boolean;
  isStandalonePayment: boolean;
  isVoided: boolean;
  isRefunded: boolean;
  isCaptured: boolean;
  isRefund: boolean;
  isVoid: boolean;
  refundedAmountCents: number;
  capturedAmount: number;
}

const CHILD_FLAG_BASE = {
  pending: false,
  success: true,
  errorOccured: false,
  isAuth: false,
  isCapture: false,
  isStandalonePayment: false,
  isVoided: false,
  isRefunded: false,
  isCaptured: false,
  isRefund: false,
  isVoid: false,
  refundedAmountCents: 0,
  capturedAmount: 0,
} as const;

/**
 * Financial-operation child transaction flags (spec 13.4). A capture/refund/
 * void child is not just "a transaction in state succeeded" -- it carries
 * its own fixed flag set (only the operation's own flag is true; the
 * original transaction's aggregate flags like is_refunded/is_captured never
 * appear on the child) regardless of the child row's `state` column, which
 * only exists to satisfy the internal state machine (13.1-13.2).
 */
function projectChildOperationFlags(operationType: string, message: string): ProjectedPaymobFlagsLike {
  switch (operationType) {
    case "capture":
      return { ...CHILD_FLAG_BASE, isCapture: true, message };
    case "refund":
      return { ...CHILD_FLAG_BASE, isRefund: true, message };
    case "void":
      return { ...CHILD_FLAG_BASE, isVoid: true, message };
    default:
      throw new Error(`unknown operation type "${operationType}"`);
  }
}

/**
 * Builds the frozen `obj` payload shape (spec 14.2) from a persisted
 * transaction row. This is the single place that projects internal state to
 * Paymob flags -- callers must not recompute flags themselves (13.3). A row
 * with `operationType` set (a capture/refund/void child, 13.4) uses the
 * fixed child flag set instead of the normal state projection.
 */
export function buildTransactionObj(row: TransactionRow, opts: BuildTransactionObjOptions = {}): TransactionObj {
  const flags: ProjectedPaymobFlagsLike = row.operationType
    ? projectChildOperationFlags(row.operationType, row.declineMessage ?? "")
    : projectPaymobFlags(row.state as InternalState, {
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
