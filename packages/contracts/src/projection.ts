import type { InternalState } from "./states.js";

// Centralizes the internal-state -> Paymob callback/inquiry flag projection
// described in spec section 13.3. This must be the single place that maps
// state to flags; routes and webhook builders import this instead of
// duplicating the table.

export interface ProjectedPaymobFlags {
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

export interface ProjectionContext {
  originalAmountCents: number;
  refundedAmountCents?: number;
  declineMessage?: string;
}

const BASE_FALSE = {
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

// States with no transaction-callback or inquiry-aggregate projection
// because no transaction exists yet, or none is emitted by default.
const NO_PROJECTION_STATES = new Set<InternalState>([
  "intended",
  "checkout_opened",
  "cancelled",
  "expired",
]);

export function hasPaymobProjection(state: InternalState): boolean {
  return !NO_PROJECTION_STATES.has(state);
}

export function projectPaymobFlags(
  state: InternalState,
  ctx: ProjectionContext,
): ProjectedPaymobFlags {
  if (NO_PROJECTION_STATES.has(state)) {
    throw new Error(`state "${state}" has no Paymob callback projection`);
  }

  switch (state) {
    case "processing":
    case "pending":
      return {
        ...BASE_FALSE,
        pending: true,
        success: false,
        errorOccured: false,
        message: "Pending",
      };

    case "succeeded":
      return {
        ...BASE_FALSE,
        pending: false,
        success: true,
        errorOccured: false,
        message: "Approved",
        isStandalonePayment: true,
      };

    case "failed":
      return {
        ...BASE_FALSE,
        pending: false,
        success: false,
        errorOccured: true,
        message: ctx.declineMessage ?? "Declined",
      };

    case "authorized":
      return {
        ...BASE_FALSE,
        pending: false,
        success: true,
        errorOccured: false,
        message: "Approved",
        isAuth: true,
        isCaptured: false,
      };

    case "captured":
      return {
        ...BASE_FALSE,
        pending: false,
        success: true,
        errorOccured: false,
        message: "Approved",
        isCaptured: true,
        isCapture: false,
        capturedAmount: ctx.originalAmountCents,
      };

    case "partially_refunded": {
      const refunded = ctx.refundedAmountCents ?? 0;
      return {
        ...BASE_FALSE,
        pending: false,
        success: true,
        errorOccured: false,
        message: "Approved",
        isRefunded: false,
        isRefund: false,
        refundedAmountCents: refunded,
      };
    }

    case "refunded":
      return {
        ...BASE_FALSE,
        pending: false,
        success: true,
        errorOccured: false,
        message: "Approved",
        isRefunded: true,
        isRefund: false,
        refundedAmountCents: ctx.originalAmountCents,
      };

    case "voided":
      return {
        ...BASE_FALSE,
        pending: false,
        success: true,
        errorOccured: false,
        message: "Approved",
        isVoided: true,
        isVoid: false,
      };

    default:
      throw new Error(`unhandled state "${String(state)}"`);
  }
}
