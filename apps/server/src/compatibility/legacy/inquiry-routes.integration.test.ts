import { afterEach, describe, expect, it } from "vitest";
import { buildTestApp, type TestApp } from "../../test-helpers/build-test-app.js";
import { submitCheckout } from "../../core/checkout-service.js";
import { getActiveCredential } from "../../core/credentials.js";
import { getTransactionById } from "../../core/transaction-service.js";

describe("legacy auth-token + transaction inquiry", () => {
  let testApp: TestApp;

  afterEach(async () => {
    await testApp?.close();
  });

  it("issues an auth token and returns the normalized transaction via inquiry", async () => {
    testApp = buildTestApp({ manualStartMs: new Date("2026-08-14T12:00:00.000Z").getTime() });

    const create = await testApp.app.inject({
      method: "POST",
      url: "/v1/intention/",
      headers: { authorization: "Token sk_sim_local", "content-type": "application/json" },
      payload: { amount: 10_000, currency: "EGP", payment_methods: [1001] },
    });
    const { client_secret: clientSecret } = create.json();

    const hmacSecret = getActiveCredential(testApp.opened.db, "hmac_secret");
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
    await testApp.scheduler.tick();

    const authRes = await testApp.app.inject({
      method: "POST",
      url: "/api/auth/tokens",
      headers: { "content-type": "application/json" },
      payload: { api_key: "api_sim_local" },
    });
    expect(authRes.statusCode).toBe(201);
    const { token } = authRes.json();

    const txn = getTransactionById(testApp.opened.db, submission.transactionId)!;

    const inquiryRes = await testApp.app.inject({
      method: "GET",
      url: `/api/acceptance/transactions/${txn.providerNumericId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(inquiryRes.statusCode).toBe(200);
    const body = inquiryRes.json();
    expect(body.success).toBe(true);
    expect(body.pending).toBe(false);
    expect(body.id).toBe(txn.providerNumericId);
  });

  it("rejects an invalid api_key with 401 and unknown transaction with 404", async () => {
    testApp = buildTestApp({ manualStartMs: Date.now() });
    const badAuth = await testApp.app.inject({
      method: "POST",
      url: "/api/auth/tokens",
      headers: { "content-type": "application/json" },
      payload: { api_key: "wrong" },
    });
    expect(badAuth.statusCode).toBe(401);

    const authRes = await testApp.app.inject({
      method: "POST",
      url: "/api/auth/tokens",
      headers: { "content-type": "application/json" },
      payload: { api_key: "api_sim_local" },
    });
    const { token } = authRes.json();

    const missing = await testApp.app.inject({
      method: "GET",
      url: "/api/acceptance/transactions/999999",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(missing.statusCode).toBe(404);
  });
});
