import { promises as dnsPromises } from "node:dns";
import { isIPv4 } from "node:net";
import { Agent, buildConnector } from "undici";
import { ipv6ToBigInt } from "./allowlist.js";
import { checkBlockedRange } from "./ip-classify.js";

// Resolve-once-and-pin connection strategy (spec section 20.2): resolve A/
// AAAA records once, filter every candidate through blocked-range policy,
// choose the first in bytewise-sorted order, and pin the socket to that
// address while keeping the original hostname for Host header / TLS SNI.
// Never resolve a second time after the pinned choice is made.

export interface DnsResolver {
  resolve4(hostname: string): Promise<string[]>;
  resolve6(hostname: string): Promise<string[]>;
}

export const nodeDnsResolver: DnsResolver = {
  async resolve4(hostname) {
    try {
      return await dnsPromises.resolve4(hostname);
    } catch {
      return [];
    }
  },
  async resolve6(hostname) {
    try {
      return await dnsPromises.resolve6(hostname);
    } catch {
      return [];
    }
  },
};

export class NoResolvableAddressError extends Error {}

function ipToSortableBuffer(ip: string): Buffer {
  if (isIPv4(ip)) return Buffer.from(ip.split(".").map((s) => Number.parseInt(s, 10)));
  const big = ipv6ToBigInt(ip);
  const buf = Buffer.alloc(16);
  let value = big;
  for (let i = 15; i >= 0; i -= 1) {
    buf[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return buf;
}

export interface ResolvePinnedAddressResult {
  address: string;
  family: 4 | 6;
  rejectedCandidates: { address: string; reason: string }[];
}

/**
 * Resolves a hostname to candidate addresses exactly once, filters through
 * the blocked-range policy, and deterministically picks the first survivor
 * in bytewise-sorted order.
 */
export async function resolvePinnedAddress(
  hostname: string,
  resolver: DnsResolver,
  allowPrivateNetworks: boolean,
): Promise<ResolvePinnedAddressResult> {
  const [v4, v6] = await Promise.all([resolver.resolve4(hostname), resolver.resolve6(hostname)]);
  const candidates = [
    ...v4.map((address) => ({ address, family: 4 as const })),
    ...v6.map((address) => ({ address, family: 6 as const })),
  ];

  if (candidates.length === 0) {
    throw new NoResolvableAddressError(`"${hostname}" did not resolve to any A/AAAA record`);
  }

  const rejectedCandidates: { address: string; reason: string }[] = [];
  const survivors = candidates.filter((c) => {
    const check = checkBlockedRange(c.address, allowPrivateNetworks);
    if (check.blocked) rejectedCandidates.push({ address: c.address, reason: check.reason ?? "blocked" });
    return !check.blocked;
  });

  if (survivors.length === 0) {
    throw new NoResolvableAddressError(
      `every resolved address for "${hostname}" is blocked: ${rejectedCandidates
        .map((r) => `${r.address} (${r.reason})`)
        .join(", ")}`,
    );
  }

  survivors.sort((a, b) => Buffer.compare(ipToSortableBuffer(a.address), ipToSortableBuffer(b.address)));
  const chosen = survivors[0] as { address: string; family: 4 | 6 };
  return { address: chosen.address, family: chosen.family, rejectedCandidates };
}

/**
 * Builds a one-shot undici dispatcher whose socket connects to `pinnedIp`
 * while the TLS SNI / certificate verification and (via the request's own
 * URL) the HTTP Host header keep using `originalHostname`.
 */
export function buildPinnedDispatcher(
  pinnedIp: string,
  originalHostname: string,
  connectTimeoutMs = 5_000,
): Agent {
  const baseConnector = buildConnector({});
  return new Agent({
    connectTimeout: connectTimeoutMs,
    connect: (opts, callback) => {
      const servername =
        "servername" in opts && typeof opts.servername === "string" ? opts.servername : originalHostname;
      baseConnector({ ...opts, hostname: pinnedIp, servername }, callback);
    },
  });
}
