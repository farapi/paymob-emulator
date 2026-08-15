import { fetch as undiciFetch } from "undici";
import type { AllowlistEntry } from "./allowlist.js";
import { checkOutboundUrlPolicy } from "./url-policy.js";
import { buildPinnedDispatcher, resolvePinnedAddress, type DnsResolver } from "./dns-pin.js";

// Ties URL policy + DNS pinning together into one safe outbound request for
// webhook delivery and the settings reachability probe (spec sections 20.2,
// 16.1). Redirects are never followed here; the caller decides whether to
// repeat this whole function for a validated redirect target (capped at 3
// hops, spec 20.2), fully re-running policy + fresh DNS + pinning each hop.

export interface SafeRequestOptions {
  method: string;
  headers?: Record<string, string>;
  body?: string;
  allowlist: readonly AllowlistEntry[];
  allowPrivateNetworks: boolean;
  resolver: DnsResolver;
  connectTimeoutMs?: number;
  totalTimeoutMs?: number;
  maxResponseBodyBytes?: number;
}

export type SafeRequestResult =
  | {
      outcome: "response";
      status: number;
      headers: Record<string, string>;
      bodyExcerpt: string;
      pinnedAddress: string;
    }
  | { outcome: "policy_rejected"; reason: string }
  | { outcome: "transport_error"; code: string; message: string };

export async function performSafeRequest(
  rawUrl: string,
  opts: SafeRequestOptions,
): Promise<SafeRequestResult> {
  const policy = checkOutboundUrlPolicy(rawUrl, opts.allowlist);
  if (!policy.ok) {
    return { outcome: "policy_rejected", reason: policy.reason };
  }

  let pinnedAddress: string;
  try {
    if (policy.isIpLiteral) {
      pinnedAddress = policy.hostname;
    } else {
      const resolved = await resolvePinnedAddress(
        policy.hostname,
        opts.resolver,
        opts.allowPrivateNetworks,
      );
      pinnedAddress = resolved.address;
    }
  } catch (err) {
    return { outcome: "transport_error", code: "DNS_RESOLUTION_FAILED", message: String(err) };
  }

  const dispatcher = buildPinnedDispatcher(pinnedAddress, policy.hostname, opts.connectTimeoutMs ?? 5_000);
  const totalTimeoutMs = opts.totalTimeoutMs ?? 10_000;
  const maxBodyBytes = opts.maxResponseBodyBytes ?? 64 * 1024;

  try {
    const response = await undiciFetch(policy.url, {
      method: opts.method,
      ...(opts.headers ? { headers: opts.headers } : {}),
      ...(opts.body !== undefined ? { body: opts.body } : {}),
      redirect: "manual",
      signal: AbortSignal.timeout(totalTimeoutMs),
      dispatcher,
    });

    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    const buf = Buffer.from(await response.arrayBuffer());
    const bodyExcerpt = buf.subarray(0, maxBodyBytes).toString("utf-8");

    return { outcome: "response", status: response.status, headers, bodyExcerpt, pinnedAddress };
  } catch (err) {
    const code =
      err instanceof Error && err.name === "AbortError" ? "REQUEST_TIMEOUT" : "TRANSPORT_ERROR";
    return { outcome: "transport_error", code, message: err instanceof Error ? err.message : String(err) };
  } finally {
    void dispatcher.close();
  }
}
