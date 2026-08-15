import { describe, expect, it } from "vitest";
import { isLegalTransition } from "./states.js";

describe("isLegalTransition", () => {
  it("allows every documented normal transition", () => {
    expect(isLegalTransition("intended", "checkout_opened")).toBe(true);
    expect(isLegalTransition("checkout_opened", "processing")).toBe(true);
    expect(isLegalTransition("processing", "succeeded")).toBe(true);
    expect(isLegalTransition("pending", "expired")).toBe(true);
    expect(isLegalTransition("authorized", "captured")).toBe(true);
    expect(isLegalTransition("succeeded", "refunded")).toBe(true);
    expect(isLegalTransition("partially_refunded", "partially_refunded")).toBe(true);
    expect(isLegalTransition("partially_refunded", "refunded")).toBe(true);
  });

  it("rejects transitions that skip or reverse the state machine", () => {
    expect(isLegalTransition("intended", "succeeded")).toBe(false);
    expect(isLegalTransition("succeeded", "processing")).toBe(false);
    expect(isLegalTransition("failed", "succeeded")).toBe(false);
    expect(isLegalTransition("voided", "succeeded")).toBe(false);
  });
});
