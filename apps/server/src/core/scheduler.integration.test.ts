import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { buildTestApp, type TestApp } from "../test-helpers/build-test-app.js";
import { submitCheckout } from "./checkout-service.js";
import { runSchedulerTick } from "./scheduler.js";
import { getActiveCredential } from "./credentials.js";
import { parseAllowlist } from "../security/allowlist.js";
import type { DnsResolver } from "../security/dns-pin.js";
import { getTransactionById } from "./transaction-service.js";

interface CapturedRequest {
  url: string;
  body: string;
}

function startCaptureServer(): Promise<{ server: Server; port: number; requests: CapturedRequest[] }> {
  const requests: CapturedRequest[] = [];
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        requests.push({ url: req.url ?? "", body: Buffer.concat(chunks).toString("utf-8") });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ received: true }));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, port, requests });
    });
  });
}

const noopResolver: DnsResolver = {
  resolve4: async () => [],
  resolve6: async () => [],
};

describe("checkout submission + scheduler engine (end-to-end)", () => {
  let testApp: TestApp;
  let server: Server;

  afterEach(async () => {
    await testApp?.close();
    server?.close();
  });

  it("delivers a correctly signed success callback for the success-immediate built-in", async () => {
    const capture = await startCaptureServer();
    server = capture.server;

    testApp = buildTestApp({ manualStartMs: new Date("2026-08-14T12:00:00.000Z").getTime() });
    const notificationUrl = `http://127.0.0.1:${capture.port}/webhooks/paymob`;

    const createRes = await testApp.app.inject({
      method: "POST",
      url: "/v1/intention/",
      headers: { authorization: "Token sk_sim_local", "content-type": "application/json" },
      payload: {
        amount: 10_000,
        currency: "EGP",
        payment_methods: [1001],
        notification_url: notificationUrl,
      },
    });
    expect(createRes.statusCode).toBe(201);
    const { client_secret: clientSecret } = createRes.json();

    const hmacSecret = getActiveCredential(testApp.opened.db, "hmac_secret");
    const allowlist = parseAllowlist(["127.0.0.1"]);

    const submission = submitCheckout(
      {
        db: testApp.opened.db,
        raw: testApp.opened.raw,
        clock: testApp.clock,
        hmacSecretVersion: hmacSecret.version,
        clockMode: "manual",
        defaultIntegrationId: 1001,
      },
      { clientSecret, cardNumber: "9900000000000010", cardholderName: "Test Customer" },
    );
    expect(submission.ok).toBe(true);
    if (!submission.ok) throw new Error("expected success");

    const tickResult = await runSchedulerTick({
      db: testApp.opened.db,
      raw: testApp.opened.raw,
      clock: testApp.clock,
      workerOwnerId: "test-worker",
      leaseDurationMs: 30_000,
      getHmacSecretForVersion: () => hmacSecret.value,
      allowlist,
      allowPrivateNetworks: true,
      resolver: noopResolver,
      requestTimeoutMs: 5_000,
      retryPolicy: { retryOnTransportError: true, retryOnStatuses: [500], intervalsMs: [5_000, 30_000, 120_000], maxAttempts: 4 },
      defaultRedirectMode: "paymob_query_order",
    });
    expect(tickResult.executed).toBeGreaterThan(0);

    const txn = getTransactionById(testApp.opened.db, submission.transactionId);
    expect(txn?.state).toBe("succeeded");

    expect(capture.requests).toHaveLength(1);
    const received = capture.requests[0]!;
    expect(received.url).toContain("/webhooks/paymob?hmac=");
    const parsedBody = JSON.parse(received.body);
    expect(parsedBody.type).toBe("TRANSACTION");
    expect(parsedBody.obj.success).toBe(true);
    expect(parsedBody.obj.pending).toBe(false);

    const hmacFromUrl = new URL(`http://x${received.url}`).searchParams.get("hmac");
    expect(hmacFromUrl).toHaveLength(128);
  });

  it("rejects an unrecognized card number without creating a transaction", async () => {
    testApp = buildTestApp({ manualStartMs: Date.now() });
    const createRes = await testApp.app.inject({
      method: "POST",
      url: "/v1/intention/",
      headers: { authorization: "Token sk_sim_local", "content-type": "application/json" },
      payload: { amount: 10_000, currency: "EGP", payment_methods: [1001] },
    });
    const { client_secret: clientSecret } = createRes.json();

    const submission = submitCheckout(
      {
        db: testApp.opened.db,
        raw: testApp.opened.raw,
        clock: testApp.clock,
        hmacSecretVersion: 1,
        clockMode: "manual",
        defaultIntegrationId: 1001,
      },
      { clientSecret, cardNumber: "4111111111111111", cardholderName: "Nope" },
    );
    expect(submission.ok).toBe(false);
    if (submission.ok) throw new Error("expected rejection");
    expect(submission.reason).toBe("unrecognized_card");
  });
});
