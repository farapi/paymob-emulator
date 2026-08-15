import { describe, expect, it } from "vitest";
import { deriveSeed, Xorshift32 } from "./random.js";

describe("deriveSeed", () => {
  it("is deterministic for the same intention/revision pair", () => {
    expect(deriveSeed("pi_sim_1", "success-immediate@1")).toBe(
      deriveSeed("pi_sim_1", "success-immediate@1"),
    );
  });

  it("differs across intentions or revisions", () => {
    expect(deriveSeed("pi_sim_1", "rev@1")).not.toBe(deriveSeed("pi_sim_2", "rev@1"));
    expect(deriveSeed("pi_sim_1", "rev@1")).not.toBe(deriveSeed("pi_sim_1", "rev@2"));
  });

  it("never returns zero", () => {
    for (let i = 0; i < 1000; i += 1) {
      expect(deriveSeed(`pi_${i}`, "rev")).not.toBe(0);
    }
  });
});

describe("Xorshift32", () => {
  it("produces the same sequence for the same seed", () => {
    const a = new Xorshift32(12345);
    const b = new Xorshift32(12345);
    const seqA = Array.from({ length: 10 }, () => a.draw());
    const seqB = Array.from({ length: 10 }, () => b.draw());
    expect(seqA).toEqual(seqB);
  });

  it("produces draws in [0, 1)", () => {
    const rng = new Xorshift32(42);
    for (let i = 0; i < 1000; i += 1) {
      const d = rng.draw();
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThan(1);
    }
  });

  it("replaces a zero seed with the documented fallback", () => {
    const zero = new Xorshift32(0);
    const fallback = new Xorshift32(0x6d2b79f5);
    expect(zero.draw()).toBe(fallback.draw());
  });

  it("keeps nextIntInRange within the inclusive bounds", () => {
    const rng = new Xorshift32(777);
    for (let i = 0; i < 1000; i += 1) {
      const v = rng.nextIntInRange(1000, 120_000);
      expect(v).toBeGreaterThanOrEqual(1000);
      expect(v).toBeLessThanOrEqual(120_000);
    }
  });
});
