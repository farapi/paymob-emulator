import { describe, expect, it } from "vitest";
import { DurationParseError, formatDurationMs, parseDuration } from "./duration.js";

describe("parseDuration", () => {
  it("parses integer milliseconds", () => {
    expect(parseDuration(500)).toBe(500);
    expect(parseDuration(0)).toBe(0);
  });

  it("parses unit-suffixed strings", () => {
    expect(parseDuration("500ms")).toBe(500);
    expect(parseDuration("5s")).toBe(5_000);
    expect(parseDuration("2m")).toBe(120_000);
    expect(parseDuration("1h")).toBe(3_600_000);
  });

  it("rejects malformed input", () => {
    expect(() => parseDuration("5 seconds")).toThrow(DurationParseError);
    expect(() => parseDuration("-5s")).toThrow(DurationParseError);
    expect(() => parseDuration(-1)).toThrow(DurationParseError);
    expect(() => parseDuration(1.5)).toThrow(DurationParseError);
  });
});

describe("formatDurationMs", () => {
  it("round-trips clean unit boundaries", () => {
    expect(formatDurationMs(parseDuration("2m"))).toBe("2m");
    expect(formatDurationMs(parseDuration("1h"))).toBe("1h");
    expect(formatDurationMs(500)).toBe("500ms");
  });
});
