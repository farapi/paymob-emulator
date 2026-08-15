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

describe("checkout HTTP routes", () => {
  let testApp: TestApp;
  let server: Server | undefined;

  afterEach(async () => {
    await testApp?.close();
    server?.close();
  });

  it("opens a checkout session and submits a payment through the HTTP surface", async () => {
    const capture = await startCaptureServer();
    server = capture.server;
    testApp = buildTestApp({ manualStartMs: new Date("2026-08-14T12:00:00.000Z").getTime(), resolver: noopResolver });

    const notificationUrl = `http://127.0.0.1:${capture.port}/webhooks/paymob`;
    const create = await testApp.app.inject({
      method: "POST",
      url: "/v1/intention/",
      headers: { authorization: "Token sk_sim_local", "content-type": "application/json" },
      payload: { amount: 10_000, currency: "EGP", payment_methods: [1001], notification_url: notificationUrl },
    });
    const { client_secret: clientSecret } = create.json();

    const openRes = await testApp.app.inject({
      method: "POST",
      url: `/__simulator/checkout/${clientSecret}/open`,
    });
    expect(openRes.statusCode).toBe(201);
    expect(openRes.json().sessionId).toBeTruthy();

    const submitRes = await testApp.app.inject({
      method: "POST",
      url: `/__simulator/checkout/${clientSecret}/submit`,
      headers: { "content-type": "application/json" },
      payload: { cardNumber: "9900000000000010", cardholderName: "Test Customer" },
    });
    expect(submitRes.statusCode).toBe(200);
    expect(submitRes.json().transactionId).toBeTruthy();

    expect(capture.requests.some((u) => u.includes("/webhooks/paymob"))).toBe(true);
  });

  it("rejects submission against an unknown client secret", async () => {
    testApp = buildTestApp({ manualStartMs: Date.now() });
    const res = await testApp.app.inject({
      method: "POST",
      url: "/__simulator/checkout/csk_test_sim_doesnotexist/submit",
      headers: { "content-type": "application/json" },
      payload: { cardNumber: "9900000000000010", cardholderName: "x" },
    });
    expect(res.statusCode).toBe(404);
  });
});
