import { describe, expect, it } from "vitest";
import { isGenericSelectorCard, resolveCardholderCommand } from "./card-aliases.js";

describe("isGenericSelectorCard", () => {
  it("recognizes the generic-selector card with separators", () => {
    expect(isGenericSelectorCard("9900 0000 0000 0002")).toBe(true);
    expect(isGenericSelectorCard("9900000000000010")).toBe(false);
  });
});

describe("resolveCardholderCommand", () => {
  it("resolves the canonical SIM:<scenario-id> form", () => {
    expect(resolveCardholderCommand("SIM:success-delayed-2m")).toBe("success-delayed-2m");
    expect(resolveCardholderCommand("sim:success-delayed-2m")).toBe("success-delayed-2m");
    expect(resolveCardholderCommand("  SIM:success-delayed-2m  ")).toBe("success-delayed-2m");
  });

  it("resolves documented literal aliases case-insensitively with normalized whitespace", () => {
    expect(resolveCardholderCommand("SIM SUCCESS")).toBe("success-immediate");
    expect(resolveCardholderCommand("sim   fail")).toBe("decline-immediate");
    expect(resolveCardholderCommand("Sim Delay 120")).toBe("success-delayed-2m");
  });

  it("never interprets names that don't start with SIM: or a documented alias", () => {
    expect(resolveCardholderCommand("John Doe")).toBeUndefined();
    expect(resolveCardholderCommand("SIMBAD")).toBeUndefined();
    expect(resolveCardholderCommand("SIM UNKNOWN")).toBeUndefined();
  });

  it("rejects an empty scenario id after the colon", () => {
    expect(resolveCardholderCommand("SIM:")).toBeUndefined();
  });
});
