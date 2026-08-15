export interface ElementResponse {
  id: string;
  amount: number;
  currency: string;
  status: string;
  special_reference?: string;
  expires_at: string;
  payment_methods: number[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      // ignore
    }
    throw new ApiError(detail, res.status);
  }
  return (await res.json()) as T;
}

export async function fetchElement(publicKey: string, clientSecret: string): Promise<ElementResponse> {
  const res = await fetch(`/v1/intention/element/${encodeURIComponent(publicKey)}/${encodeURIComponent(clientSecret)}`);
  return asJson(res);
}

export interface OpenSessionResponse {
  sessionId: string;
  ticket: string;
}

export async function openCheckoutSession(clientSecret: string): Promise<OpenSessionResponse> {
  const res = await fetch(`/__simulator/checkout/${encodeURIComponent(clientSecret)}/open`, { method: "POST" });
  return asJson(res);
}

export interface SubmitResponse {
  transactionId: string;
  replay: boolean;
}

export async function submitCheckout(
  clientSecret: string,
  input: { cardNumber: string; cardholderName: string; idempotencyKey: string },
): Promise<SubmitResponse> {
  const res = await fetch(`/__simulator/checkout/${encodeURIComponent(clientSecret)}/submit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return asJson(res);
}

export function ackBrowserEvent(sessionId: string, ticket: string, eventId: number, outcome: "applied" | "failed") {
  return fetch(`/__simulator/checkout-sessions/${sessionId}/ack?ticket=${encodeURIComponent(ticket)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ eventId, outcome }),
    keepalive: true,
  });
}

export function eventsUrl(sessionId: string, ticket: string): string {
  return `/__simulator/checkout-sessions/${sessionId}/events?ticket=${encodeURIComponent(ticket)}`;
}
