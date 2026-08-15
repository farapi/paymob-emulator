import { describe, expect, it } from "vitest";
import { formatCallbackTimestamp } from "./timestamps.js";

describe("formatCallbackTimestamp", () => {
  it("matches the golden fixture format exactly", () => {
    expect(formatCallbackTimestamp(new Date("2026-08-14T12:00:00.000Z"))).toBe(
      "2026-08-14T12:00:00.000000",
    );
  });

  it("has no trailing Z and six fractional digits", () => {
    const out = formatCallbackTimestamp(new Date("2026-01-01T00:00:00.123Z"));
    expect(out).toBe("2026-01-01T00:00:00.123000");
    expect(out.endsWith("Z")).toBe(false);
  });
});
