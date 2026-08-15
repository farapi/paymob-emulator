import { parseDuration } from "@paymob-simulator/contracts";

// Safe bounds for control-plane-supplied duration strings (spec 16.2:
// expiresIn accepts 1s..24h; 11.4: max delay defaults to 24h).

export const MAX_EXPECTATION_EXPIRES_IN_MS = 24 * 60 * 60 * 1000;
export const MIN_EXPECTATION_EXPIRES_IN_MS = 1_000;
export const DEFAULT_EXPECTATION_EXPIRES_IN_MS = 10 * 60 * 1000;

export function parseExpiresIn(raw: string | undefined): number {
  if (!raw) return DEFAULT_EXPECTATION_EXPIRES_IN_MS;
  const ms = parseDuration(raw);
  if (ms < MIN_EXPECTATION_EXPIRES_IN_MS || ms > MAX_EXPECTATION_EXPIRES_IN_MS) {
    throw new RangeError(`expiresIn must be between 1s and 24h, got "${raw}"`);
  }
  return ms;
}
