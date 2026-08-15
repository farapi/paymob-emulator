import type { InternalState } from "@paymob-simulator/contracts";
import type { BrowserRedirectStatus } from "./redirect-builder.js";

// Maps a transaction's current internal state to the browser-facing status
// vocabulary used by browser.redirect/show_result actions and by the
// "reopen checkout, show the current outcome" path (spec 10.4 step 5:
// "Reopening checkout renders the current outcome but does not replay an
// old navigation"). Returns null when there is no meaningful outcome yet
// (no transaction created, or still mid-flight before any browser action
// would have run).

export function mapTransactionStateToBrowserStatus(state: InternalState): BrowserRedirectStatus | null {
  switch (state) {
    case "intended":
    case "checkout_opened":
      return null;
    case "processing":
    case "pending":
      return "pending";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "expired":
      return "expired";
    case "authorized":
    case "succeeded":
    case "captured":
    case "partially_refunded":
    case "refunded":
    case "voided":
      return "success";
    default:
      return null;
  }
}
