import { describe, expect, it, vi } from "vitest";
import type { DnsResolver } from "./dns-pin.js";
import { NoResolvableAddressError, resolvePinnedAddress } from "./dns-pin.js";

// Spec section 20.2: "Tests must include a resolver double that returns an
// allowed address during validation and a forbidden address on a
// hypothetical second lookup; the pinned connector proves that no second
// lookup occurs." resolvePinnedAddress only calls the resolver once per
// family per call; we assert the resolver functions are each invoked
// exactly once, and that the chosen address is the one from that single
// resolution -- never a value from some later, different resolution.
describe("resolvePinnedAddress", () => {
  it("resolves each family exactly once and pins to an allowed candidate", async () => {
    const resolve4 = vi.fn(async () => ["93.184.216.34"]);
    const resolve6 = vi.fn(async () => [] as string[]);
    const resolver: DnsResolver = { resolve4, resolve6 };

    const result = await resolvePinnedAddress("example.com", resolver, false);

    expect(resolve4).toHaveBeenCalledTimes(1);
    expect(resolve6).toHaveBeenCalledTimes(1);
    expect(result.address).toBe("93.184.216.34");
    expect(result.family).toBe(4);
  });

  it("filters out blocked candidates and never falls back to a second lookup", async () => {
    let callCount = 0;
    const resolver: DnsResolver = {
      resolve4: async () => {
        callCount += 1;
        // First (and only) call returns a metadata address alongside a safe one.
        return ["169.254.169.254", "93.184.216.34"];
      },
      resolve6: async () => [],
    };

    const result = await resolvePinnedAddress("example.com", resolver, false);
    expect(callCount).toBe(1);
    expect(result.address).toBe("93.184.216.34");
    expect(result.rejectedCandidates).toContainEqual({
      address: "169.254.169.254",
      reason: "cloud metadata address",
    });
  });

  it("throws when every candidate is blocked, without a second resolution attempt", async () => {
    const resolve4 = vi.fn(async () => ["169.254.169.254"]);
    const resolve6 = vi.fn(async () => [] as string[]);
    const resolver: DnsResolver = { resolve4, resolve6 };

    await expect(resolvePinnedAddress("example.com", resolver, false)).rejects.toThrow(
      NoResolvableAddressError,
    );
    expect(resolve4).toHaveBeenCalledTimes(1);
  });

  it("picks the bytewise-first survivor deterministically", async () => {
    const resolver: DnsResolver = {
      resolve4: async () => ["93.184.216.40", "93.184.216.10", "93.184.216.99"],
      resolve6: async () => [],
    };
    const result = await resolvePinnedAddress("example.com", resolver, false);
    expect(result.address).toBe("93.184.216.10");
  });
});
