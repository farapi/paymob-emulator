import { GENERIC_SELECTOR_CARD, normalizeCardNumber } from "@paymob-simulator/contracts";

// Cardholder-name commands (spec section 11.4). Only interpreted when the
// generic-selector card is used; on any other card these are ordinary
// display names.

const NAMED_ALIASES: Record<string, string> = {
  "SIM SUCCESS": "success-immediate",
  "SIM FAIL": "decline-immediate",
  "SIM DELAY 120": "success-delayed-2m",
  "SIM DUP 3": "success-duplicate-3",
  "SIM NOHOOK": "success-no-webhook",
  "SIM BADHMAC": "success-invalid-hmac",
  "SIM REDIRECT FIRST": "redirect-before-webhook",
  "SIM WEBHOOK FIRST": "webhook-before-redirect",
};

function normalizeCommand(name: string): string {
  return name.trim().replace(/\s+/g, " ").toUpperCase();
}

export function isGenericSelectorCard(cardNumber: string): boolean {
  return normalizeCardNumber(cardNumber) === GENERIC_SELECTOR_CARD;
}

/**
 * Resolves a cardholder-name command against the generic-selector card only.
 * Returns undefined for names that don't start with SIM: or an exact
 * documented "SIM " alias (spec: "Never interpret names that do not start
 * with SIM: or an exact documented SIM alias").
 */
export function resolveCardholderCommand(name: string): string | undefined {
  const trimmed = name.trim().replace(/\s+/g, " ");
  const normalized = normalizeCommand(name);
  if (normalized.startsWith("SIM:")) {
    const scenarioId = trimmed.slice(4).trim().toLowerCase();
    return scenarioId.length > 0 ? scenarioId : undefined;
  }
  return NAMED_ALIASES[normalized];
}

export function listDocumentedAliases(): string[] {
  return Object.keys(NAMED_ALIASES);
}
