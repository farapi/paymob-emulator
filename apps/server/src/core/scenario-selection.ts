import { findBuiltInCardByNumber } from "@paymob-simulator/contracts";
import type { AppDatabase } from "../database/connect.js";
import { isGenericSelectorCard, resolveCardholderCommand } from "./card-aliases.js";
import { consumeExpectation, findActiveCheckoutExpectation } from "./expectations-repository.js";

// Scenario selection precedence (spec section 11.5).

export type ScenarioSelectionSource = "expectation" | "generic_alias" | "card_registry";

export interface ScenarioSelectionResult {
  scenarioId: string;
  source: ScenarioSelectionSource;
  expectationId?: string;
}

export type ScenarioSelectionError = { code: "unrecognized_card" } | { code: "unrecognized_alias" };

export type ScenarioSelectionOutcome =
  | { ok: true; result: ScenarioSelectionResult }
  | { ok: false; error: ScenarioSelectionError };

export interface ScenarioSelectionInput {
  cardNumber: string;
  cardholderName: string;
  specialReference?: string | undefined;
}

export function selectCheckoutScenario(
  db: AppDatabase,
  now: Date,
  input: ScenarioSelectionInput,
): ScenarioSelectionOutcome {
  const isRecognizedCard = isGenericSelectorCard(input.cardNumber) || Boolean(findBuiltInCardByNumber(input.cardNumber));

  // 1. Non-expired one-shot expectation matching special_reference wins, but
  // checkout still requires a recognized simulator card.
  if (input.specialReference) {
    const expectation = findActiveCheckoutExpectation(db, now, input.specialReference);
    if (expectation) {
      if (!isRecognizedCard) return { ok: false, error: { code: "unrecognized_card" } };
      consumeExpectation(db, expectation.id);
      return {
        ok: true,
        result: { scenarioId: expectation.scenarioId as string, source: "expectation", expectationId: expectation.id },
      };
    }
  }

  // 2. Generic-selector card + exact SIM:<scenario-id> or supported alias.
  if (isGenericSelectorCard(input.cardNumber)) {
    const scenarioId = resolveCardholderCommand(input.cardholderName);
    if (!scenarioId) return { ok: false, error: { code: "unrecognized_alias" } };
    return { ok: true, result: { scenarioId, source: "generic_alias" } };
  }

  // 3. Exact scenario-card registry match.
  const builtIn = findBuiltInCardByNumber(input.cardNumber);
  if (builtIn) {
    return { ok: true, result: { scenarioId: builtIn.scenarioId, source: "card_registry" } };
  }

  // An unmatched submitted PAN is always rejected -- never falls through to a default.
  return { ok: false, error: { code: "unrecognized_card" } };
}
