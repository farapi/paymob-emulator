import { createHash } from "node:crypto";

// Deterministic randomness (spec section 12.5). Frozen to xorshift32 so the
// same intention id + scenario revision id + range always produces the same
// delay, making "random" chaos scenarios reproducible in CI.

const ZERO_REPLACEMENT_SEED = 0x6d2b79f5;

export function deriveSeed(intentionId: string, scenarioRevisionId: string): number {
  const hash = createHash("sha256").update(`${intentionId}:${scenarioRevisionId}`).digest();
  const state = hash.readUInt32BE(0);
  return state === 0 ? ZERO_REPLACEMENT_SEED : state >>> 0;
}

export class Xorshift32 {
  private state: number;

  constructor(seed: number) {
    const normalized = seed >>> 0;
    this.state = normalized === 0 ? ZERO_REPLACEMENT_SEED : normalized;
  }

  /** Advance one xorshift32 step and return the new unsigned 32-bit state. */
  private step(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state;
  }

  /** One draw in [0, 1), computed as state / 2^32 after the xorshift step. */
  draw(): number {
    return this.step() / 2 ** 32;
  }

  /** Inclusive integer range [min, max] using min + floor(draw * (max - min + 1)). */
  nextIntInRange(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new Error(`invalid inclusive range [${min}, ${max}]`);
    }
    return min + Math.floor(this.draw() * (max - min + 1));
  }
}
