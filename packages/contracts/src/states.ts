// Internal transaction/intention lifecycle state model (spec section 13.1-13.2).

export const INTERNAL_STATES = [
  "intended",
  "checkout_opened",
  "processing",
  "pending",
  "authorized",
  "succeeded",
  "failed",
  "cancelled",
  "expired",
  "captured",
  "partially_refunded",
  "refunded",
  "voided",
] as const;

export type InternalState = (typeof INTERNAL_STATES)[number];

// Legal normal-application transitions. Chaos scenarios may bypass this via
// non-canonical snapshots but the canonical transaction only ever follows
// these edges (spec section 13.2).
export const NORMAL_TRANSITIONS: Record<InternalState, readonly InternalState[]> = {
  intended: ["checkout_opened"],
  checkout_opened: ["processing", "cancelled", "expired"],
  processing: ["pending", "authorized", "succeeded", "failed"],
  pending: ["authorized", "succeeded", "failed", "expired"],
  authorized: ["captured", "voided"],
  succeeded: ["partially_refunded", "refunded", "voided"],
  failed: [],
  cancelled: [],
  expired: [],
  captured: [],
  partially_refunded: ["partially_refunded", "refunded"],
  refunded: [],
  voided: [],
};

export function isLegalTransition(from: InternalState, to: InternalState): boolean {
  return NORMAL_TRANSITIONS[from].includes(to);
}

export const VALIDATION_MODES = ["realistic", "strict_docs", "permissive"] as const;
export type ValidationMode = (typeof VALIDATION_MODES)[number];

export const CLOCK_MODES = ["real", "manual"] as const;
export type ClockMode = (typeof CLOCK_MODES)[number];

export const SCENARIO_CLASSIFICATIONS = ["paymob_like", "adversarial", "api_fault"] as const;
export type ScenarioClassification = (typeof SCENARIO_CLASSIFICATIONS)[number];

export const BROWSER_COMPLETION_MODES = [
  "stay_in_checkout",
  "redirect_current_window",
  "redirect_top_window",
  "redirect_iframe",
  "post_message",
  "post_message_and_redirect",
  "close_embedded_checkout",
] as const;
export type BrowserCompletionMode = (typeof BROWSER_COMPLETION_MODES)[number];

export const REDIRECT_MODES = [
  "paymob_query_order",
  "paymob_query_order_id",
  "minimal_status",
  "no_parameters",
] as const;
export type RedirectMode = (typeof REDIRECT_MODES)[number];
