// Built-in scenario test cards (spec section 11.2). All "99"-prefixed numbers
// are fictional emulator-only identifiers, never real Paymob sandbox cards.

export function luhnValid(pan: string): boolean {
  const digits = pan.replace(/[\s-]/g, "");
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export function normalizeCardNumber(pan: string): string {
  return pan.replace(/[\s-]/g, "");
}

export interface BuiltInCardDefinition {
  cardNumber: string;
  scenarioId: string;
  description: string;
}

export const GENERIC_SELECTOR_CARD = "9900000000000002";

export const BUILT_IN_CARDS: readonly BuiltInCardDefinition[] = [
  {
    cardNumber: "9900000000000002",
    scenarioId: "generic-selector",
    description: "Select any loaded scenario with cardholder name SIM:<scenario-id>.",
  },
  {
    cardNumber: "9900000000000010",
    scenarioId: "success-immediate",
    description: "Valid success callback, then success redirect.",
  },
  {
    cardNumber: "9900000000000028",
    scenarioId: "decline-immediate",
    description: "Valid declined callback and failure redirect.",
  },
  {
    cardNumber: "9900000000000036",
    scenarioId: "success-delayed-2m",
    description: "Pending redirect immediately; success callback after two minutes.",
  },
  {
    cardNumber: "9900000000000044",
    scenarioId: "decline-delayed-2m",
    description: "Pending redirect immediately; declined callback after two minutes.",
  },
  {
    cardNumber: "9900000000000051",
    scenarioId: "pending-forever",
    description: "Pending UX; no final callback.",
  },
  {
    cardNumber: "9900000000000069",
    scenarioId: "success-no-webhook",
    description: "Success-looking redirect; backend callback omitted.",
  },
  {
    cardNumber: "9900000000000077",
    scenarioId: "success-duplicate-3",
    description: "Same valid success callback at 0s, 5s, and 30s.",
  },
  {
    cardNumber: "9900000000000085",
    scenarioId: "success-invalid-hmac",
    description: "Success payload with a deliberately corrupted signature.",
  },
  {
    cardNumber: "9900000000000093",
    scenarioId: "redirect-before-webhook",
    description: "Success redirect, then valid callback after five seconds.",
  },
  {
    cardNumber: "9900000000000101",
    scenarioId: "webhook-before-redirect",
    description: "Valid callback, then redirect after five seconds.",
  },
  {
    cardNumber: "9900000000000119",
    scenarioId: "three-ds-success",
    description: "Simple OTP challenge; 123456 succeeds.",
  },
  {
    cardNumber: "9900000000000127",
    scenarioId: "three-ds-failure",
    description: "Simple OTP challenge; final result fails.",
  },
  {
    cardNumber: "9900000000000135",
    scenarioId: "success-partial-refund",
    description: "Success, then a 50% refund callback after one minute.",
  },
  {
    cardNumber: "9900000000000143",
    scenarioId: "success-then-void",
    description: "Success, then a void event after one minute.",
  },
  {
    cardNumber: "9900000000000150",
    scenarioId: "out-of-order-regression",
    description: "Success snapshot followed by an older failure snapshot.",
  },
  {
    cardNumber: "9900000000000168",
    scenarioId: "random-delay-success",
    description: "Success callback after deterministic seeded jitter between 1 and 120 seconds.",
  },
] as const;

export const BUILT_IN_CARD_EXPIRY = "01/39";
export const BUILT_IN_CARD_CVV = "123";

export function findBuiltInCardByNumber(pan: string): BuiltInCardDefinition | undefined {
  const normalized = normalizeCardNumber(pan);
  return BUILT_IN_CARDS.find((c) => c.cardNumber === normalized);
}
