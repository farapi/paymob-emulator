import { describe, expect, it } from "vitest";
import { mapTransactionStateToBrowserStatus } from "./browser-status.js";

describe("mapTransactionStateToBrowserStatus", () => {
  it("maps pre-transaction states to null (no outcome yet)", () => {
    expect(mapTransactionStateToBrowserStatus("intended")).toBeNull();
    expect(mapTransactionStateToBrowserStatus("checkout_opened")).toBeNull();
  });

  it("maps in-flight states to pending", () => {
    expect(mapTransactionStateToBrowserStatus("processing")).toBe("pending");
    expect(mapTransactionStateToBrowserStatus("pending")).toBe("pending");
  });

  it("maps every success-flagged terminal/aggregate state to success", () => {
    for (const state of ["authorized", "succeeded", "captured", "partially_refunded", "refunded", "voided"] as const) {
      expect(mapTransactionStateToBrowserStatus(state)).toBe("success");
    }
  });

  it("maps failed/cancelled/expired to their own status", () => {
    expect(mapTransactionStateToBrowserStatus("failed")).toBe("failed");
    expect(mapTransactionStateToBrowserStatus("cancelled")).toBe("cancelled");
    expect(mapTransactionStateToBrowserStatus("expired")).toBe("expired");
  });
});
