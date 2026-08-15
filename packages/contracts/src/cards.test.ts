import { describe, expect, it } from "vitest";
import { BUILT_IN_CARDS, findBuiltInCardByNumber, luhnValid, normalizeCardNumber } from "./cards.js";

describe("luhnValid", () => {
  it("accepts every built-in card number", () => {
    for (const card of BUILT_IN_CARDS) {
      expect(luhnValid(card.cardNumber)).toBe(true);
    }
  });

  it("rejects an obviously invalid number", () => {
    expect(luhnValid("1234567890123456")).toBe(false);
  });

  it("ignores spaces and hyphens", () => {
    expect(luhnValid("9900 0000 0000 0010")).toBe(true);
    expect(luhnValid("9900-0000-0000-0010")).toBe(true);
  });
});

describe("built-in card registry", () => {
  it("has 17 unique card numbers and scenario ids", () => {
    expect(BUILT_IN_CARDS).toHaveLength(17);
    expect(new Set(BUILT_IN_CARDS.map((c) => c.cardNumber)).size).toBe(17);
    expect(new Set(BUILT_IN_CARDS.map((c) => c.scenarioId)).size).toBe(17);
  });

  it("finds a card after normalizing separators", () => {
    const found = findBuiltInCardByNumber("9900 0000 0000 0010");
    expect(found?.scenarioId).toBe("success-immediate");
  });

  it("normalizes card numbers by stripping spaces and hyphens", () => {
    expect(normalizeCardNumber("9900 0000-0000 0010")).toBe("9900000000000010");
  });
});
