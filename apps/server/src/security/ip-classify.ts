import { isIPv4, isIPv6 } from "node:net";

// Blocked-range classification for outbound callback targets (spec section
// 20.2): link-local, cloud metadata (169.254.169.254), multicast,
// unspecified, and documentation-reserved ranges are blocked unconditionally.
// Loopback/private ranges are gated by `allowPrivateNetworks` because this is
// a local simulator that legitimately talks to `localhost`/`127.0.0.1`/
// container-private addresses.

export interface IpClassification {
  family: 4 | 6;
  isLoopback: boolean;
  isPrivate: boolean;
  isLinkLocal: boolean;
  isMulticast: boolean;
  isUnspecified: boolean;
  isDocumentation: boolean;
  isMetadata: boolean;
}

function ipv4ToBytes(ip: string): number[] {
  return ip.split(".").map((s) => Number.parseInt(s, 10));
}

function inCidr4(bytes: number[], base: number[], prefixLen: number): boolean {
  let remaining = prefixLen;
  for (let i = 0; i < 4; i += 1) {
    if (remaining <= 0) break;
    const bits = Math.min(8, remaining);
    const mask = 0xff << (8 - bits);
    if (((bytes[i] as number) & mask) !== ((base[i] as number) & mask)) return false;
    remaining -= bits;
  }
  return true;
}

function classifyIpv4(ip: string): IpClassification {
  const bytes = ipv4ToBytes(ip);
  const [a, b] = bytes as [number, number, number, number];

  const isLoopback = a === 127;
  const isLinkLocal = a === 169 && b === 254; // includes 169.254.169.254 metadata
  const isMetadata = ip === "169.254.169.254";
  const isUnspecified = ip === "0.0.0.0";
  const isMulticast = a >= 224 && a <= 239;
  const isDocumentation =
    inCidr4(bytes, [192, 0, 2, 0], 24) ||
    inCidr4(bytes, [198, 51, 100, 0], 24) ||
    inCidr4(bytes, [203, 0, 113, 0], 24);
  const isPrivate =
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    inCidr4(bytes, [100, 64, 0, 0], 10); // carrier-grade NAT, treated as private

  return {
    family: 4,
    isLoopback,
    isPrivate,
    isLinkLocal,
    isMulticast,
    isUnspecified,
    isDocumentation,
    isMetadata,
  };
}

function classifyIpv6(ip: string): IpClassification {
  const normalized = ip.toLowerCase();
  const isLoopback = normalized === "::1";
  const isUnspecified = normalized === "::";
  const isLinkLocal = normalized.startsWith("fe8") || normalized.startsWith("fe9") ||
    normalized.startsWith("fea") || normalized.startsWith("feb");
  const isMulticast = normalized.startsWith("ff");
  const isPrivate = normalized.startsWith("fc") || normalized.startsWith("fd"); // unique local fc00::/7
  const isDocumentation = normalized.startsWith("2001:db8");
  // IPv4-mapped IPv6 metadata address representation.
  const isMetadata = normalized === "::ffff:169.254.169.254" || normalized.includes("169.254.169.254");

  return {
    family: 6,
    isLoopback,
    isPrivate,
    isLinkLocal,
    isMulticast,
    isUnspecified,
    isDocumentation,
    isMetadata,
  };
}

export function classifyIp(ip: string): IpClassification {
  if (isIPv4(ip)) return classifyIpv4(ip);
  if (isIPv6(ip)) return classifyIpv6(ip);
  throw new Error(`"${ip}" is not a valid IP literal`);
}

export interface BlockedRangeCheck {
  blocked: boolean;
  reason?: string;
}

/**
 * Applies the unconditional + allowPrivateNetworks-gated blocked-range
 * policy to a single resolved/literal IP address.
 */
export function checkBlockedRange(ip: string, allowPrivateNetworks: boolean): BlockedRangeCheck {
  const c = classifyIp(ip);
  if (c.isMetadata) return { blocked: true, reason: "cloud metadata address" };
  if (c.isLinkLocal) return { blocked: true, reason: "link-local address" };
  if (c.isMulticast) return { blocked: true, reason: "multicast address" };
  if (c.isUnspecified) return { blocked: true, reason: "unspecified address" };
  if (c.isDocumentation) return { blocked: true, reason: "documentation-reserved address" };
  if (!allowPrivateNetworks && (c.isLoopback || c.isPrivate)) {
    return { blocked: true, reason: "private/loopback address blocked by configuration" };
  }
  return { blocked: false };
}
