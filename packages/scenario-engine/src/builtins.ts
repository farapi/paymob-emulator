import type { ScenarioDefinition } from "./schema.js";

/**
 * Frozen built-in scenario timelines (spec section 12.5.1). All offsets are
 * from the atomically accepted checkout submission; actions at the same
 * offset execute in the listed order.
 *
 * Two extensions beyond the 14-action generic vocabulary (section 12.3) are
 * used here and interpreted by the server-side executor, not by custom
 * scenario authors:
 *
 * - `metadata.childOperation`: `success-partial-refund` and
 *   `success-then-void` create an immutable *child* transaction (new id,
 *   section 13.4) rather than transitioning the original transaction, so
 *   they cannot be expressed with a plain `transaction.transition`. The
 *   executor creates the child and delivers its callback at the given offset.
 * - `metadata.threeDsOutcome`: `three-ds-success` / `three-ds-failure` open a
 *   challenge whose resolution depends on interactive OTP submission, not a
 *   fixed offset from checkout submission. The executor schedules the
 *   post-challenge transition/webhook/redirect relative to OTP acceptance
 *   time using the same compiler, once the customer submits an OTP.
 *
 * `webhook.corrupt_hmac` / `webhook.mutate_payload` `sourceActionId` may
 * reference either a prior `webhook.*` action (reuse its materialized bytes
 * verbatim) or a `transaction.transition` / `transaction.snapshot` action
 * (derive fresh canonical bytes from that snapshot, then corrupt/mutate).
 * This keeps `success-invalid-hmac` a single materialize+corrupt+deliver
 * step instead of first delivering a valid callback and then a corrupted
 * duplicate.
 */
export const BUILT_IN_SCENARIOS: readonly ScenarioDefinition[] = [
  {
    version: 1,
    id: "success-immediate",
    displayName: "Success (immediate)",
    description: "Valid success callback, then success redirect.",
    classification: "paymob_like",
    match: {},
    checkout: { requireThreeDS: false },
    timeline: [
      { id: "transition", after: 0, action: "transaction.transition", params: { to: "succeeded" } },
      {
        id: "webhook",
        after: 0,
        action: "webhook.transaction",
        params: { snapshot: "current", signature: "valid" },
      },
      { id: "redirect", after: "100ms", action: "browser.redirect", params: { status: "success" } },
    ],
    deliveryPolicy: { retryPolicy: "default" },
    metadata: { tags: ["success"] },
  },
  {
    version: 1,
    id: "decline-immediate",
    displayName: "Decline (immediate)",
    description: "Valid declined callback and failure redirect.",
    classification: "paymob_like",
    match: {},
    checkout: { requireThreeDS: false },
    timeline: [
      { id: "transition", after: 0, action: "transaction.transition", params: { to: "failed" } },
      {
        id: "webhook",
        after: 0,
        action: "webhook.transaction",
        params: { snapshot: "current", signature: "valid" },
      },
      { id: "redirect", after: "100ms", action: "browser.redirect", params: { status: "failed" } },
    ],
    deliveryPolicy: { retryPolicy: "default" },
    metadata: { tags: ["decline"] },
  },
  {
    version: 1,
    id: "success-delayed-2m",
    displayName: "Success (delayed 2 minutes)",
    description: "Pending redirect immediately; success callback after two minutes.",
    classification: "paymob_like",
    match: {},
    checkout: { requireThreeDS: false },
    timeline: [
      { id: "pending-transition", after: 0, action: "transaction.transition", params: { to: "pending" } },
      { id: "pending-redirect", after: 0, action: "browser.redirect", params: { status: "pending" } },
      {
        id: "success-transition",
        after: "2m",
        action: "transaction.transition",
        params: { to: "succeeded" },
      },
      {
        id: "success-webhook",
        after: "2m",
        action: "webhook.transaction",
        params: { snapshot: "current", signature: "valid" },
      },
    ],
    deliveryPolicy: { retryPolicy: "default" },
    metadata: { tags: ["success", "delayed"] },
  },
  {
    version: 1,
    id: "decline-delayed-2m",
    displayName: "Decline (delayed 2 minutes)",
    description: "Pending redirect immediately; declined callback after two minutes.",
    classification: "paymob_like",
    match: {},
    checkout: { requireThreeDS: false },
    timeline: [
      { id: "pending-transition", after: 0, action: "transaction.transition", params: { to: "pending" } },
      { id: "pending-redirect", after: 0, action: "browser.redirect", params: { status: "pending" } },
      {
        id: "failed-transition",
        after: "2m",
        action: "transaction.transition",
        params: { to: "failed" },
      },
      {
        id: "failed-webhook",
        after: "2m",
        action: "webhook.transaction",
        params: { snapshot: "current", signature: "valid" },
      },
    ],
    deliveryPolicy: { retryPolicy: "default" },
    metadata: { tags: ["decline", "delayed"] },
  },
  {
    version: 1,
    id: "pending-forever",
    displayName: "Pending forever",
    description: "Pending UX; no final callback.",
    classification: "adversarial",
    match: {},
    checkout: { requireThreeDS: false },
    timeline: [
      { id: "transition", after: 0, action: "transaction.transition", params: { to: "pending" } },
      { id: "result", after: 0, action: "browser.show_result", params: { status: "pending" } },
    ],
    deliveryPolicy: { retryPolicy: "default" },
    metadata: { tags: ["pending", "adversarial"] },
  },
  {
    version: 1,
    id: "success-no-webhook",
    displayName: "Success, no webhook",
    description: "Success-looking redirect; backend callback omitted.",
    classification: "adversarial",
    match: {},
    checkout: { requireThreeDS: false },
    timeline: [
      { id: "transition", after: 0, action: "transaction.transition", params: { to: "succeeded" } },
      {
        id: "omit",
        after: 0,
        action: "webhook.omit",
        params: { event: "transaction", reason: "success-no-webhook scenario" },
      },
      { id: "redirect", after: "100ms", action: "browser.redirect", params: { status: "success" } },
    ],
    deliveryPolicy: { retryPolicy: "default" },
    metadata: { tags: ["success", "adversarial", "missing-webhook"] },
  },
  {
    version: 1,
    id: "success-duplicate-3",
    displayName: "Success, duplicated 3 times",
    description: "Same valid success callback at 0s, 5s, and 30s.",
    classification: "adversarial",
    match: {},
    checkout: { requireThreeDS: false },
    timeline: [
      { id: "transition", after: 0, action: "transaction.transition", params: { to: "succeeded" } },
      {
        id: "webhook",
        after: 0,
        action: "webhook.transaction",
        params: { snapshot: "current", signature: "valid" },
      },
      { id: "redirect", after: "100ms", action: "browser.redirect", params: { status: "success" } },
      {
        id: "duplicate-1",
        after: "5s",
        action: "webhook.repeat",
        params: { sourceActionId: "webhook", exactPayload: true },
      },
      {
        id: "duplicate-2",
        after: "30s",
        action: "webhook.repeat",
        params: { sourceActionId: "webhook", exactPayload: true },
      },
    ],
    deliveryPolicy: { retryPolicy: "default" },
    metadata: { tags: ["success", "adversarial", "duplicate"] },
  },
  {
    version: 1,
    id: "success-invalid-hmac",
    displayName: "Success, invalid HMAC",
    description: "Success payload with a deliberately corrupted signature.",
    classification: "adversarial",
    match: {},
    checkout: { requireThreeDS: false },
    timeline: [
      { id: "transition", after: 0, action: "transaction.transition", params: { to: "succeeded" } },
      {
        id: "webhook",
        after: 0,
        action: "webhook.corrupt_hmac",
        params: { sourceActionId: "transition", mutation: "flip_last_hex" },
      },
      { id: "redirect", after: "100ms", action: "browser.redirect", params: { status: "success" } },
    ],
    deliveryPolicy: { retryPolicy: "default" },
    metadata: { tags: ["success", "adversarial", "invalid-hmac"] },
  },
  {
    version: 1,
    id: "redirect-before-webhook",
    displayName: "Redirect before webhook",
    description: "Success redirect, then valid callback after five seconds.",
    classification: "paymob_like",
    match: {},
    checkout: { requireThreeDS: false },
    timeline: [
      { id: "transition", after: 0, action: "transaction.transition", params: { to: "succeeded" } },
      { id: "redirect", after: 0, action: "browser.redirect", params: { status: "success" } },
      {
        id: "webhook",
        after: "5s",
        action: "webhook.transaction",
        params: { snapshot: "current", signature: "valid" },
      },
    ],
    deliveryPolicy: { retryPolicy: "default" },
    metadata: { tags: ["success", "ordering"] },
  },
  {
    version: 1,
    id: "webhook-before-redirect",
    displayName: "Webhook before redirect",
    description: "Valid callback, then redirect after five seconds.",
    classification: "paymob_like",
    match: {},
    checkout: { requireThreeDS: false },
    timeline: [
      { id: "transition", after: 0, action: "transaction.transition", params: { to: "succeeded" } },
      {
        id: "webhook",
        after: 0,
        action: "webhook.transaction",
        params: { snapshot: "current", signature: "valid" },
      },
      { id: "redirect", after: "5s", action: "browser.redirect", params: { status: "success" } },
    ],
    deliveryPolicy: { retryPolicy: "default" },
    metadata: { tags: ["success", "ordering"] },
  },
  {
    version: 1,
    id: "three-ds-success",
    displayName: "3-D Secure (success)",
    description: "Simple OTP challenge; 123456 succeeds.",
    classification: "paymob_like",
    match: {},
    checkout: { requireThreeDS: true },
    timeline: [{ id: "open-challenge", after: 0, action: "three_ds.open", params: {} }],
    deliveryPolicy: { retryPolicy: "default" },
    metadata: { tags: ["3ds", "success"], threeDsOutcome: "success", threeDsOtp: "123456" },
  },
  {
    version: 1,
    id: "three-ds-failure",
    displayName: "3-D Secure (failure)",
    description: "Simple OTP challenge; final result fails.",
    classification: "paymob_like",
    match: {},
    checkout: { requireThreeDS: true },
    timeline: [{ id: "open-challenge", after: 0, action: "three_ds.open", params: {} }],
    deliveryPolicy: { retryPolicy: "default" },
    metadata: { tags: ["3ds", "failure"], threeDsOutcome: "failure" },
  },
  {
    version: 1,
    id: "success-partial-refund",
    displayName: "Success, then partial refund",
    description: "Success, then a 50% refund callback after one minute.",
    classification: "paymob_like",
    match: {},
    checkout: { requireThreeDS: false },
    timeline: [
      { id: "transition", after: 0, action: "transaction.transition", params: { to: "succeeded" } },
      {
        id: "webhook",
        after: 0,
        action: "webhook.transaction",
        params: { snapshot: "current", signature: "valid" },
      },
      { id: "redirect", after: "100ms", action: "browser.redirect", params: { status: "success" } },
    ],
    deliveryPolicy: { retryPolicy: "default" },
    metadata: {
      tags: ["success", "refund"],
      childOperation: { type: "refund", afterMs: 60_000, fraction: 0.5 },
    },
  },
  {
    version: 1,
    id: "success-then-void",
    displayName: "Success, then void",
    description: "Success, then a void event after one minute.",
    classification: "paymob_like",
    match: {},
    checkout: { requireThreeDS: false },
    timeline: [
      { id: "transition", after: 0, action: "transaction.transition", params: { to: "succeeded" } },
      {
        id: "webhook",
        after: 0,
        action: "webhook.transaction",
        params: { snapshot: "current", signature: "valid" },
      },
      { id: "redirect", after: "100ms", action: "browser.redirect", params: { status: "success" } },
    ],
    deliveryPolicy: { retryPolicy: "default" },
    metadata: {
      tags: ["success", "void"],
      childOperation: { type: "void", afterMs: 60_000 },
    },
  },
  {
    version: 1,
    id: "out-of-order-regression",
    displayName: "Out-of-order regression",
    description: "Success snapshot followed by an older failure snapshot.",
    classification: "adversarial",
    match: {},
    checkout: { requireThreeDS: false },
    timeline: [
      { id: "transition", after: 0, action: "transaction.transition", params: { to: "succeeded" } },
      {
        id: "webhook",
        after: 0,
        action: "webhook.transaction",
        params: { snapshot: "current", signature: "valid" },
      },
      { id: "redirect", after: "100ms", action: "browser.redirect", params: { status: "success" } },
      {
        id: "stale-snapshot",
        after: "5s",
        action: "transaction.snapshot",
        params: { state: "failed", canonical: false },
      },
      {
        id: "stale-webhook",
        after: "5s",
        action: "webhook.transaction",
        params: { snapshot: "stale-snapshot", signature: "valid" },
      },
    ],
    deliveryPolicy: { retryPolicy: "default" },
    metadata: { tags: ["adversarial", "out-of-order"] },
  },
  {
    version: 1,
    id: "random-delay-success",
    displayName: "Success (seeded random delay)",
    description: "Success callback after deterministic seeded jitter between 1 and 120 seconds.",
    classification: "paymob_like",
    match: {},
    checkout: { requireThreeDS: false },
    timeline: [
      { id: "pending-transition", after: 0, action: "transaction.transition", params: { to: "pending" } },
      { id: "pending-result", after: 0, action: "browser.show_result", params: { status: "pending" } },
      {
        id: "success-transition",
        after: "seeded",
        action: "transaction.transition",
        params: { to: "succeeded" },
      },
      {
        id: "success-webhook",
        after: "seeded",
        action: "webhook.transaction",
        params: { snapshot: "current", signature: "valid" },
      },
    ],
    deliveryPolicy: { retryPolicy: "default" },
    metadata: { tags: ["success", "random"], seededRangeMs: [1000, 120_000] },
  },
];

export const GENERIC_SELECTOR_SCENARIO_ID = "generic-selector";

export function findBuiltInScenario(id: string): ScenarioDefinition | undefined {
  return BUILT_IN_SCENARIOS.find((s) => s.id === id);
}
