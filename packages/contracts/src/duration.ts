// Duration parsing (spec section 12.4): integer milliseconds, or strings like
// "500ms", "5s", "2m", "1h". Parsed once, stored as normalized milliseconds.

const DURATION_PATTERN = /^(\d+)(ms|s|m|h)$/;

const UNIT_TO_MS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
};

export class DurationParseError extends Error {}

export function parseDuration(input: number | string): number {
  if (typeof input === "number") {
    if (!Number.isInteger(input) || input < 0) {
      throw new DurationParseError(`duration milliseconds must be a non-negative integer`);
    }
    return input;
  }

  const match = DURATION_PATTERN.exec(input.trim());
  if (!match) {
    throw new DurationParseError(
      `invalid duration "${input}": expected integer milliseconds or a string like "500ms", "5s", "2m", "1h"`,
    );
  }

  const [, amountStr, unit] = match;
  const amount = Number.parseInt(amountStr as string, 10);
  const unitMs = UNIT_TO_MS[unit as string];
  if (unitMs === undefined) {
    throw new DurationParseError(`unknown duration unit in "${input}"`);
  }
  return amount * unitMs;
}

export function formatDurationMs(ms: number): string {
  if (ms % 3_600_000 === 0 && ms > 0) return `${ms / 3_600_000}h`;
  if (ms % 60_000 === 0 && ms > 0) return `${ms / 60_000}m`;
  if (ms % 1_000 === 0 && ms > 0) return `${ms / 1_000}s`;
  return `${ms}ms`;
}
