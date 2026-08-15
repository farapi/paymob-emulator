import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { buildTestApp, type TestApp } from "../test-helpers/build-test-app.js";
import type { DnsResolver } from "../security/dns-pin.js";

function startCaptureServer(): Promise<{ server: Server; port: number; requests: string[] }> {
  const requests: string[] = [];
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      requests.push(req.url ?? "");
      res.writeHead(200);
      res.end("{}");
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, port, requests });
    });
  });
}

const noopResolver: DnsResolver = { resolve4: async () => [], resolve6: async () => [] };

describe("payment operations (refund/void/capture)", () => {
  let testApp: TestApp;
  let server: Server | undefined;

  afterEach(async () => {
    await testApp?.close();
    server?.close();
  });

  async function adminHeaders(app: TestApp) {
    const bootstrap = await import("../core/bootstrap.js");
    const token = await bootstrap.ensureBootstrapToken(app.opened.db, new Date().toISOString());
    const res = await app.app.inject({
      method: "POST",
      url: "/__simulator/api/auth/bootstrap",
      headers: { "content-type": "application/json" },
      payload: { token },
    });
    const setCookie = res.headers["set-cookie"];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie) as string;
    return { cookie: cookie.split(";")[0] as string, csrfToken: res.json().csrfToken as string };
  }

  it("refunds a succeeded transaction, delivers the child callback, and updates the aggregate", async () => {
    const capture = await startCaptureServer();
    server = capture.server;
    testApp = buildTestApp({ manualStartMs: new Date("2026-08-14T12:00:00.000Z").getTime(), resolver: noopResolver });
    const { cookie, csrfToken } = await adminHeaders(testApp);

    const notificationUrl = `http://127.0.0.1:${capture.port}/webhooks/paymob`;
    const create = await testApp.app.inject({
      method: "POST",
      url: "/v1/intention/",
      headers: { authorization: "Token sk_sim_local", "content-type": "application/json" },
      payload: { amount: 10_000, currency: "EGP", payment_methods: [1001], notification_url: notificationUrl },
    });
    const { client_secret: clientSecret } = create.json();

    const submitRes = await testApp.app.inject({
      method: "POST",
      url: `/__simulator/checkout/${clientSecret}/submit`,
      headers: { "content-type": "application/json" },
      payload: { cardNumber: "9900000000000010", cardholderName: "Test Customer" },
    });
    const transactionId = submitRes.json().transactionId as string;

    const refundRes = await testApp.app.inject({
      method: "POST",
      url: `/__simulator/api/transactions/${transactionId}/refund`,
      headers: { cookie, "x-csrf-token": csrfToken, "content-type": "application/json" },
      payload: { amountCents: 4_000 },
    });
    expect(refundRes.statusCode).toBe(201);
    const child = refundRes.json();
    expect(child.success).toBe(true);
    expect(child.is_refund).toBe(true);
    expect(child.amount_cents).toBe(4_000);
    expect(child.has_parent_transaction).toBe(true);
    expect(child.data.message).toBe("Refunded");

    const originalRes = await testApp.app.inject({
      method: "GET",
      url: `/__simulator/api/transactions/${transactionId}`,
      headers: { cookie, "x-csrf-token": csrfToken },
    });
    expect(originalRes.json().state).toBe("partially_refunded");
    expect(originalRes.json().refundedAmountCents).toBe(4_000);

    // Full refund of the remainder should transition to fully refunded.
    const fullRefundRes = await testApp.app.inject({
      method: "POST",
      url: `/__simulator/api/transactions/${transactionId}/refund`,
      headers: { cookie, "x-csrf-token": csrfToken, "content-type": "application/json" },
      payload: { amountCents: 6_000 },
    });
    expect(fullRefundRes.statusCode).toBe(201);

    const finalRes = await testApp.app.inject({
      method: "GET",
      url: `/__simulator/api/transactions/${transactionId}`,
      headers: { cookie, "x-csrf-token": csrfToken },
    });
    expect(finalRes.json().state).toBe("refunded");

    // Two child callbacks delivered (one per refund), plus the original success callback.
    expect(capture.requests.filter((u) => u.includes("webhooks/paymob")).length).toBe(3);
  });

  it("rejects a refund exceeding the remaining refundable total with 409", async () => {
    testApp = buildTestApp({ manualStartMs: new Date("2026-08-14T12:00:00.000Z").getTime() });
    const { cookie, csrfToken } = await adminHeaders(testApp);

    const create = await testApp.app.inject({
      method: "POST",
      url: "/v1/intention/",
      headers: { authorization: "Token sk_sim_local", "content-type": "application/json" },
      payload: { amount: 10_000, currency: "EGP", payment_methods: [1001] },
    });
    const { client_secret: clientSecret } = create.json();
    const submitRes = await testApp.app.inject({
      method: "POST",
      url: `/__simulator/checkout/${clientSecret}/submit`,
      headers: { "content-type": "application/json" },
      payload: { cardNumber: "9900000000000010", cardholderName: "Test Customer" },
    });
    const transactionId = submitRes.json().transactionId as string;

    const res = await testApp.app.inject({
      method: "POST",
      url: `/__simulator/api/transactions/${transactionId}/refund`,
      headers: { cookie, "x-csrf-token": csrfToken, "content-type": "application/json" },
      payload: { amountCents: 20_000 },
    });
    expect(res.statusCode).toBe(409);
  });

  it("voids a succeeded transaction and rejects a second void", async () => {
    testApp = buildTestApp({ manualStartMs: new Date("2026-08-14T12:00:00.000Z").getTime() });
    const { cookie, csrfToken } = await adminHeaders(testApp);

    const create = await testApp.app.inject({
      method: "POST",
      url: "/v1/intention/",
      headers: { authorization: "Token sk_sim_local", "content-type": "application/json" },
      payload: { amount: 10_000, currency: "EGP", payment_methods: [1001] },
    });
    const { client_secret: clientSecret } = create.json();
    const submitRes = await testApp.app.inject({
      method: "POST",
      url: `/__simulator/checkout/${clientSecret}/submit`,
      headers: { "content-type": "application/json" },
      payload: { cardNumber: "9900000000000010", cardholderName: "Test Customer" },
    });
    const transactionId = submitRes.json().transactionId as string;

    const voidRes = await testApp.app.inject({
      method: "POST",
      url: `/__simulator/api/transactions/${transactionId}/void`,
      headers: { cookie, "x-csrf-token": csrfToken },
    });
    expect(voidRes.statusCode).toBe(201);
    expect(voidRes.json().is_void).toBe(true);
    expect(voidRes.json().data.message).toBe("Voided");

    const secondVoid = await testApp.app.inject({
      method: "POST",
      url: `/__simulator/api/transactions/${transactionId}/void`,
      headers: { cookie, "x-csrf-token": csrfToken },
    });
    expect(secondVoid.statusCode).toBe(409);
  });
});
