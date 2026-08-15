// Admin API client: session cookie is sent automatically via
// credentials:"include"; state-changing requests must carry the CSRF token
// returned by /auth/session (spec section 16).

export class AdminApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
  if (init.body) headers["content-type"] = "application/json";
  if (csrfToken && init.method && init.method !== "GET") headers["x-csrf-token"] = csrfToken;

  const res = await fetch(path, { ...init, headers, credentials: "include" });
  if (res.status === 204) return undefined as T;

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }

  if (!res.ok) {
    const message =
      (body as { error?: { message?: string }; detail?: string } | undefined)?.error?.message ??
      (body as { detail?: string } | undefined)?.detail ??
      res.statusText;
    throw new AdminApiError(message, res.status);
  }
  return body as T;
}

export interface SessionInfo {
  authenticated: boolean;
  csrfToken?: string;
  expiresAt?: string;
}

export const getSession = () => request<SessionInfo>("/__simulator/api/auth/session");
export const bootstrap = (token: string) =>
  request<SessionInfo>("/__simulator/api/auth/bootstrap", { method: "POST", body: JSON.stringify({ token }) });
export const login = (token: string) =>
  request<SessionInfo>("/__simulator/api/auth/login", { method: "POST", body: JSON.stringify({ token }) });
export const logout = () => request<void>("/__simulator/api/auth/logout", { method: "POST" });

export interface PagedResult<T> {
  data: T[];
  page: { nextCursor: string | null };
}

export const listTransactions = () => request<PagedResult<TransactionRow>>("/__simulator/api/transactions?limit=50");
export const getTransaction = (id: string) => request<TransactionDetail>(`/__simulator/api/transactions/${id}`);
export const refundTransaction = (id: string, amountCents: number) =>
  request(`/__simulator/api/transactions/${id}/refund`, { method: "POST", body: JSON.stringify({ amountCents }) });
export const voidTransaction = (id: string) =>
  request(`/__simulator/api/transactions/${id}/void`, { method: "POST" });
export const captureTransaction = (id: string, amountCents: number) =>
  request(`/__simulator/api/transactions/${id}/capture`, { method: "POST", body: JSON.stringify({ amountCents }) });

export const listDeliveries = () => request<PagedResult<DeliveryRow>>("/__simulator/api/deliveries?limit=50");
export const getDelivery = (id: string) => request<DeliveryDetail>(`/__simulator/api/deliveries/${id}`);
export const replayDelivery = (id: string) =>
  request(`/__simulator/api/deliveries/${id}/replay`, { method: "POST", body: JSON.stringify({ when: "now" }) });
export const cancelDelivery = (id: string) =>
  request(`/__simulator/api/deliveries/${id}/cancel`, { method: "POST" });

export interface SettingRow {
  path: string;
  value: unknown;
  source: "env" | "file" | "database" | "default";
  locked: boolean;
}
export const listSettings = () => request<{ data: SettingRow[] }>("/__simulator/api/settings");

export const advanceClock = (by: string) =>
  request<{ old: string; new: string; idle: boolean }>("/__simulator/api/clock/advance", {
    method: "POST",
    body: JSON.stringify({ by, drain: true }),
  });

export interface TransactionRow {
  id: string;
  providerNumericId: number;
  state: string;
  amountCents: number;
  currency: string;
  merchantOrderId: string;
  createdAt: string;
  refundedAmountCents: number;
  capturedAmountCents: number;
  hasParentTransaction: boolean;
  parentTransactionId: string | null;
}

export interface TransactionDetail extends TransactionRow {
  obj: Record<string, unknown>;
}

export interface DeliveryRow {
  id: string;
  transactionId: string | null;
  eventType: string;
  targetUrl: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
}

export interface DeliveryDetail {
  delivery: DeliveryRow;
  event: { hmac: string; bodyBytes: string; signatureMode: string } | null;
  attempts: Array<{
    id: string;
    attemptNumber: number;
    responseStatus: number | null;
    transportErrorCode: string | null;
    retryDecision: string | null;
    durationMs: number | null;
  }>;
}
