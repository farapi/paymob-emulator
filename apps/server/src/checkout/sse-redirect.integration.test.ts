import { afterEach, describe, expect, it } from "vitest";
import { buildTestApp, type TestApp } from "../test-helpers/build-test-app.js";
import { getCheckoutSession } from "../core/checkout-sessions-repository.js";
import { ManualClock } from "../core/clock.js";

interface SseEvent {
  id: number;
  data: { actionId: string | null; type: string; payload: Record<string, unknown>; dueAt: string };
}

interface OpenSessionResponse {
  sessionId: string;
  ticket: string;
  currentStatus: string | null;
}

/** Reads SSE events from a live response stream until `matches` returns true or the timeout elapses. */
async function readSseUntil(
  response: Response,
  matches: (e: SseEvent) => boolean,
  timeoutMs = 4_000,
): Promise<SseEvent> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("timed out waiting for matching SSE event")), timeoutMs);
  });

  try {
    for (;;) {
      const { value, done } = await Promise.race([reader.read(), timeout]);
      if (done) throw new Error("SSE stream closed before a matching event arrived");
      buffer += decoder.decode(value, { stream: true });

      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const idLine = chunk.split("\n").find((l) => l.startsWith("id: "));
        const dataLine = chunk.split("\n").find((l) => l.startsWith("data: "));
        if (!idLine || !dataLine) continue;
        const event: SseEvent = {
          id: Number.parseInt(idLine.slice(4), 10),
          data: JSON.parse(dataLine.slice(6)),
        };
        if (matches(event)) return event;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

describe("SSE browser events + acknowledgement + real redirect completion", () => {
  let testApp: TestApp;
  let baseUrl: string;
  const abortControllers: AbortController[] = [];

  afterEach(async () => {
    for (const controller of abortControllers) controller.abort();
    abortControllers.length = 0;
    // A live SSE connection is a long-lived open socket; Node's default
    // http.Server.close() waits for all sockets to end naturally, which an
    // SSE stream never does on its own. Force-close so close() doesn't hang.
    testApp?.app.server.closeAllConnections?.();
    await testApp?.close();
  }, 15_000);

  async function boot() {
    testApp = buildTestApp({
      manualStartMs: new Date("2026-08-14T12:00:00.000Z").getTime(),
      env: { SIM_ALLOWED_REDIRECT_ORIGINS: "http://localhost:3000" },
    });
    const address = await testApp.app.listen({ port: 0, host: "127.0.0.1" });
    baseUrl = address;
  }

  function openSse(url: string): Promise<Response> {
    const controller = new AbortController();
    abortControllers.push(controller);
    return fetch(url, { signal: controller.signal });
  }

  it(
    "delivers a real signed redirect URL over SSE and records the acknowledgement",
    async () => {
      await boot();

      const create = await testApp.app.inject({
        method: "POST",
        url: "/v1/intention/",
        headers: { authorization: "Token sk_sim_local", "content-type": "application/json" },
        payload: {
          amount: 10_000,
          currency: "EGP",
          payment_methods: [1001],
          redirection_url: "http://localhost:3000/payment/result",
        },
      });
      expect(create.statusCode).toBe(201);
      const { client_secret: clientSecret } = create.json();

      const openRes = await fetch(`${baseUrl}/__simulator/checkout/${clientSecret}/open`, { method: "POST" });
      const { sessionId, ticket, currentStatus } = (await openRes.json()) as OpenSessionResponse;
      expect(currentStatus).toBeNull();

      const sseResponse = await openSse(
        `${baseUrl}/__simulator/checkout-sessions/${sessionId}/events?ticket=${ticket}`,
      );
      expect(sseResponse.status).toBe(200);
      expect(sseResponse.headers.get("content-type")).toContain("text/event-stream");

      const redirectEventPromise = readSseUntil(sseResponse, (e) => e.data.type === "browser.redirect");

      const submitRes = await fetch(`${baseUrl}/__simulator/checkout/${clientSecret}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cardNumber: "9900000000000010", cardholderName: "Test Customer" }),
      });
      expect(submitRes.status).toBe(200);

      // success-immediate's browser.redirect step is 100ms after submission
      // (spec 12.5.1); the manual clock never advances on its own, so the
      // due action stays unclaimed until we advance it and tick again --
      // this mirrors exactly what POST /clock/advance does in real usage.
      (testApp.clock as ManualClock).advanceBy(150);
      await testApp.scheduler.tick();

      const redirectEvent = await redirectEventPromise;
      expect(redirectEvent.data.payload.status).toBe("success");
      const url = redirectEvent.data.payload.url as string;
      expect(url).toMatch(/^http:\/\/localhost:3000\/payment\/result\?/);
      const parsed = new URL(url);
      expect(parsed.searchParams.get("hmac")).toHaveLength(128);
      expect(parsed.searchParams.get("success")).toBe("true");

      // Acknowledge exactly as the checkout page does before navigating (spec 10.4 step 3).
      const ackRes = await fetch(
        `${baseUrl}/__simulator/checkout-sessions/${sessionId}/ack?ticket=${ticket}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ eventId: redirectEvent.id, outcome: "applied" }),
        },
      );
      expect(ackRes.status).toBe(200);

      const session = getCheckoutSession(testApp.opened.db, sessionId)!;
      const { browserEvents } = await import("../database/schema.js");
      const events = testApp.opened.db.select().from(browserEvents).all().filter((e) => e.checkoutSessionId === session.id);
      const ackedEvent = events.find((e) => e.eventSeq === redirectEvent.id);
      expect(ackedEvent?.ackedAt).not.toBeNull();
    },
    10_000,
  );

  it(
    "returns the current outcome (not a replayed navigation) when checkout is reopened after completion",
    async () => {
      await boot();

      const create = await testApp.app.inject({
        method: "POST",
        url: "/v1/intention/",
        headers: { authorization: "Token sk_sim_local", "content-type": "application/json" },
        payload: { amount: 10_000, currency: "EGP", payment_methods: [1001] },
      });
      const { client_secret: clientSecret } = create.json();

      await fetch(`${baseUrl}/__simulator/checkout/${clientSecret}/open`, { method: "POST" });
      await fetch(`${baseUrl}/__simulator/checkout/${clientSecret}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cardNumber: "9900000000000010", cardholderName: "Test Customer" }),
      });
      await testApp.scheduler.tick();

      // Reopen: a brand-new session with zero events of its own, but the
      // response must report the transaction's real current outcome.
      const reopenRes = await fetch(`${baseUrl}/__simulator/checkout/${clientSecret}/open`, { method: "POST" });
      const reopened = (await reopenRes.json()) as OpenSessionResponse;
      expect(reopened.currentStatus).toBe("success");

      // And that fresh session has no backlog events to replay.
      const sseResponse = await openSse(
        `${baseUrl}/__simulator/checkout-sessions/${reopened.sessionId}/events?ticket=${reopened.ticket}`,
      );
      const reader = sseResponse.body!.getReader();
      const raced = await Promise.race([
        reader.read().then(() => "got-data"),
        new Promise((resolve) => setTimeout(() => resolve("timeout"), 300)),
      ]);
      expect(raced).toBe("timeout");
      await reader.cancel().catch(() => undefined);
    },
    10_000,
  );

  it(
    "marks a due redirect as missed_no_active_browser when no SSE session is listening",
    async () => {
      await boot();

      const create = await testApp.app.inject({
        method: "POST",
        url: "/v1/intention/",
        headers: { authorization: "Token sk_sim_local", "content-type": "application/json" },
        payload: { amount: 10_000, currency: "EGP", payment_methods: [1001] },
      });
      const { client_secret: clientSecret } = create.json();

      // Deliberately skip /open -- no checkout session exists, simulating a
      // closed browser tab.
      const submitRes = await fetch(`${baseUrl}/__simulator/checkout/${clientSecret}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cardNumber: "9900000000000010", cardholderName: "Test Customer" }),
      });
      expect(submitRes.status).toBe(200);
      await testApp.scheduler.tick();

      const { transactions } = await import("../database/schema.js");
      const txn = testApp.opened.db.select().from(transactions).all()[0]!;
      expect(txn.state).toBe("succeeded");
    },
    10_000,
  );
});
