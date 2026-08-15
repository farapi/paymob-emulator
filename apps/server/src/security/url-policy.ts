import { isIP } from "node:net";
import { type AllowlistEntry, isHostnameAllowed, isIpAllowed, normalizeHostname } from "./allowlist.js";

// Syntax + host-policy validation for outbound callback URLs (spec section
// 20.2 and 9.1's notification_url/redirection_url rules). This layer never
// touches the network -- DNS resolution and connection pinning happen at
// delivery time in dns-pin.ts.

export interface UrlPolicyOk {
  ok: true;
  url: URL;
  hostname: string;
  isIpLiteral: boolean;
  port: number;
}

export interface UrlPolicyRejected {
  ok: false;
  reason: string;
}

export type UrlPolicyResult = UrlPolicyOk | UrlPolicyRejected;

function defaultPortFor(protocol: string): number {
  return protocol === "https:" ? 443 : 80;
}

export function checkOutboundUrlPolicy(raw: string, allowlist: readonly AllowlistEntry[]): UrlPolicyResult {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "malformed URL" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: `unsupported scheme "${url.protocol}"` };
  }
  if (url.username !== "" || url.password !== "") {
    return { ok: false, reason: "URL userinfo is not allowed" };
  }

  const port = url.port === "" ? defaultPortFor(url.protocol) : Number.parseInt(url.port, 10);
  if (port === 0) {
    return { ok: false, reason: "port 0 is not allowed" };
  }

  const hostRaw = url.hostname.replace(/^\[|\]$/g, "");
  const ipFamily = isIP(hostRaw);
  const isIpLiteral = ipFamily !== 0;

  if (isIpLiteral) {
    if (!isIpAllowed(hostRaw, port, allowlist)) {
      return { ok: false, reason: `IP literal "${hostRaw}" is not in the callback target allowlist` };
    }
    return { ok: true, url, hostname: hostRaw, isIpLiteral: true, port };
  }

  const hostname = normalizeHostname(hostRaw);
  if (!isHostnameAllowed(hostname, port, allowlist)) {
    return { ok: false, reason: `host "${hostname}" is not in the callback target allowlist` };
  }
  return { ok: true, url, hostname, isIpLiteral: false, port };
}

/**
 * Redirection URL policy (spec section 9.1): must be absolute HTTP(S), no
 * userinfo, and its normalized scheme://host:port must exactly match an
 * `allowedRedirectOrigins` entry. Paths/query strings are allowed; fragments
 * are stripped by the caller when building the final redirect, not here.
 */
export function checkRedirectOriginPolicy(
  raw: string,
  allowedOrigins: readonly string[],
): UrlPolicyResult {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "malformed URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: `unsupported scheme "${url.protocol}"` };
  }
  if (url.username !== "" || url.password !== "") {
    return { ok: false, reason: "URL userinfo is not allowed" };
  }

  const port = url.port === "" ? defaultPortFor(url.protocol) : Number.parseInt(url.port, 10);
  const normalizedOrigin = `${url.protocol}//${url.hostname}:${port}`;

  const allowed = allowedOrigins.some((entry) => {
    try {
      const o = new URL(entry);
      const oPort = o.port === "" ? defaultPortFor(o.protocol) : Number.parseInt(o.port, 10);
      return `${o.protocol}//${o.hostname}:${oPort}` === normalizedOrigin;
    } catch {
      return false;
    }
  });

  if (!allowed) {
    return { ok: false, reason: `redirect origin "${normalizedOrigin}" is not allowed` };
  }
  return { ok: true, url, hostname: url.hostname, isIpLiteral: false, port };
}
