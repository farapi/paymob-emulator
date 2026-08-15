import { domainToASCII } from "node:url";
import { isIPv4, isIPv6 } from "node:net";

// Frozen allowlist entry matching (spec section 20.2). An entry is an exact
// DNS hostname, exact hostname:port, exact IP literal, or CIDR. No
// wildcards, suffix matching, paths, or regex.

export class AllowlistParseError extends Error {}

export type AllowlistEntry =
  | { kind: "hostname"; hostname: string; port: number | null }
  | { kind: "ip"; ip: string; family: 4 | 6; port: number | null }
  | { kind: "cidr"; base: string; prefixLen: number; family: 4 | 6 };

function parsePort(raw: string, original: string): number {
  const port = Number.parseInt(raw, 10);
  if (!/^\d+$/.test(raw) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new AllowlistParseError(`invalid port in allowlist entry "${original}"`);
  }
  return port;
}

export function normalizeHostname(host: string): string {
  let h = host.trim().toLowerCase();
  if (h.endsWith(".")) h = h.slice(0, -1);
  const ascii = domainToASCII(h);
  return ascii.length > 0 ? ascii : h;
}

export function parseAllowlistEntry(raw: string): AllowlistEntry {
  const value = raw.trim();
  if (value.length === 0) throw new AllowlistParseError("empty allowlist entry");

  if (value.includes("/")) {
    const slashIdx = value.indexOf("/");
    const base = value.slice(0, slashIdx);
    const prefixStr = value.slice(slashIdx + 1);
    const family = isIPv4(base) ? 4 : isIPv6(base) ? 6 : null;
    if (!family) throw new AllowlistParseError(`invalid CIDR base address in "${raw}"`);
    const prefixLen = Number.parseInt(prefixStr, 10);
    const maxPrefix = family === 4 ? 32 : 128;
    if (!/^\d+$/.test(prefixStr) || prefixLen < 0 || prefixLen > maxPrefix) {
      throw new AllowlistParseError(`invalid CIDR prefix length in "${raw}"`);
    }
    return { kind: "cidr", base, prefixLen, family };
  }

  if (value.startsWith("[")) {
    const closeIdx = value.indexOf("]");
    if (closeIdx === -1) throw new AllowlistParseError(`malformed bracketed literal in "${raw}"`);
    const ipPart = value.slice(1, closeIdx);
    const rest = value.slice(closeIdx + 1);
    if (!isIPv6(ipPart)) throw new AllowlistParseError(`invalid IPv6 literal in "${raw}"`);
    let port: number | null = null;
    if (rest.length > 0) {
      if (!rest.startsWith(":")) throw new AllowlistParseError(`malformed entry "${raw}"`);
      port = parsePort(rest.slice(1), raw);
    }
    return { kind: "ip", ip: ipPart.toLowerCase(), family: 6, port };
  }

  if (isIPv6(value)) {
    return { kind: "ip", ip: value.toLowerCase(), family: 6, port: null };
  }

  if (isIPv4(value)) {
    return { kind: "ip", ip: value, family: 4, port: null };
  }

  const lastColon = value.lastIndexOf(":");
  if (lastColon !== -1) {
    const hostPart = value.slice(0, lastColon);
    const portPart = value.slice(lastColon + 1);
    if (/^\d+$/.test(portPart)) {
      if (isIPv4(hostPart)) {
        return { kind: "ip", ip: hostPart, family: 4, port: parsePort(portPart, raw) };
      }
      return {
        kind: "hostname",
        hostname: normalizeHostname(hostPart),
        port: parsePort(portPart, raw),
      };
    }
  }

  return { kind: "hostname", hostname: normalizeHostname(value), port: null };
}

function ipv4ToInt(ip: string): number {
  const parts = ip.split(".").map((s) => Number.parseInt(s, 10));
  return ((parts[0] as number) << 24) | ((parts[1] as number) << 16) | ((parts[2] as number) << 8) | (parts[3] as number);
}

export function ipv6ToBigInt(ip: string): bigint {
  // Expand :: and parse as 8 groups of 16 bits.
  const [head, tail] = ip.split("::");
  const headParts = head ? head.split(":").filter((p) => p.length > 0) : [];
  const tailParts = tail ? tail.split(":").filter((p) => p.length > 0) : [];
  const missing = 8 - headParts.length - tailParts.length;
  const groups = [...headParts, ...Array(Math.max(missing, 0)).fill("0"), ...tailParts];
  let value = 0n;
  for (const g of groups.slice(0, 8)) {
    value = (value << 16n) | BigInt(Number.parseInt(g || "0", 16));
  }
  return value;
}

function ipv4InCidr(ip: string, base: string, prefixLen: number): boolean {
  if (prefixLen === 0) return true;
  const mask = prefixLen === 32 ? 0xffffffff : (0xffffffff << (32 - prefixLen)) >>> 0;
  return ((ipv4ToInt(ip) & mask) >>> 0) === ((ipv4ToInt(base) & mask) >>> 0);
}

function ipv6InCidr(ip: string, base: string, prefixLen: number): boolean {
  if (prefixLen === 0) return true;
  const shift = 128n - BigInt(prefixLen);
  const mask = shift >= 128n ? 0n : (((1n << BigInt(prefixLen)) - 1n) << shift);
  return (ipv6ToBigInt(ip) & mask) === (ipv6ToBigInt(base) & mask);
}

/** True if a DNS hostname (never an IP literal) matches a hostname allowlist entry. */
export function isHostnameAllowed(
  hostname: string,
  port: number,
  entries: readonly AllowlistEntry[],
): boolean {
  const normalized = normalizeHostname(hostname);
  return entries.some(
    (e) => e.kind === "hostname" && e.hostname === normalized && (e.port === null || e.port === port),
  );
}

/** True if a URL IP literal (or a resolved candidate address, for the pinned-connect check) matches an ip/cidr allowlist entry. */
export function isIpAllowed(ip: string, port: number, entries: readonly AllowlistEntry[]): boolean {
  const family = isIPv4(ip) ? 4 : isIPv6(ip) ? 6 : null;
  if (!family) return false;
  return entries.some((e) => {
    if (e.kind === "ip") {
      return e.family === family && e.ip === (family === 4 ? ip : ip.toLowerCase()) && (e.port === null || e.port === port);
    }
    if (e.kind === "cidr" && e.family === family) {
      return family === 4 ? ipv4InCidr(ip, e.base, e.prefixLen) : ipv6InCidr(ip, e.base, e.prefixLen);
    }
    return false;
  });
}

export function parseAllowlist(raw: readonly string[]): AllowlistEntry[] {
  return raw.map(parseAllowlistEntry);
}
