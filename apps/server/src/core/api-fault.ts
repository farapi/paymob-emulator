import { parseDuration } from "@paymob-simulator/contracts";

// Provider-API fault injection (spec section 16.3). Delay uses real wall
// time -- "intentional provider API response sleeps use monotonic wall
// time" (15.5) -- so a fault is felt as real latency by the caller
// regardless of clock mode.

export interface ApiFaultResponse {
  status?: number;
  delay?: string;
  body?: Record<string, unknown>;
  connectionClose?: boolean;
  timeout?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyReply = any;

/**
 * Applies a matched API-fault expectation to an in-flight request. Returns
 * true if the fault fully handled the response (caller must not continue
 * normal processing).
 */
export async function applyApiFault(reply: AnyReply, fault: ApiFaultResponse): Promise<boolean> {
  const delayMs = fault.delay ? parseDuration(fault.delay) : 0;
  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  if (fault.timeout) {
    // Honest timeout simulation: hijack the response and never complete it.
    // The caller's own request timeout, not us, is what eventually fires.
    reply.hijack();
    return true;
  }

  if (fault.connectionClose) {
    reply.hijack();
    reply.raw.destroy();
    return true;
  }

  if (fault.status !== undefined) {
    reply.code(fault.status).send(fault.body ?? { detail: "Simulated provider failure" });
    return true;
  }

  return false;
}
