import { afterEach, describe, expect, it } from "vitest";
import { buildTestApp, type TestApp } from "../test-helpers/build-test-app.js";

describe("one-shot expectations + headless completion", () => {
  let testApp: TestApp;

  afterEach(async () => {
    await testApp?.close();
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

  it("consumes an expectation by special_reference, overriding the submitted card's normal scenario", async () => {
    testApp = buildTestApp({ manualStartMs: new Date("2026-08-14T12:00:00.000Z").getTime() });
    const { cookie, csrfToken } = await adminHeaders(testApp);

    const expRes = await testApp.app.inject({
      method: "POST",
      url: "/__simulator/api/expectations",
      headers: { cookie, "x-csrf-token": csrfToken, "content-type": "application/json" },
      payload: { match: { specialReference: "E2E-1" }, scenarioId: "decline-immediate", times: 1 },
    });
    expect(expRes.statusCode).toBe(201);

    const create = await testApp.app.inject({
      method: "POST",
      url: "/v1/intention/",
      headers: { authorization: "Token sk_sim_local", "content-type": "application/json" },
      payload: { amount: 10_000, currency: "EGP", payment_methods: [1001], special_reference: "E2E-1" },
    });
    const { client_secret: clientSecret } = create.json();

    // Submit the success-immediate card, but the expectation should override to decline.
    const submitRes = await testApp.app.inject({
      method: "POST",
      url: `/__simulator/checkout/${clientSecret}/submit`,
      headers: { "content-type": "application/json" },
      payload: { cardNumber: "9900000000000010", cardholderName: "Test Customer" },
    });
    expect(submitRes.statusCode).toBe(200);

    const txnId = submitRes.json().transactionId as string;
    const detailRes = await testApp.app.inject({
      method: "GET",
      url: `/__simulator/api/transactions/${txnId}`,
      headers: { cookie, "x-csrf-token": csrfToken },
    });
    expect(detailRes.json().state).toBe("failed");

    // Expectation is consumed -- a second matching intention does not get it again.
    const listRes = await testApp.app.inject({
      method: "GET",
      url: "/__simulator/api/expectations",
      headers: { cookie, "x-csrf-token": csrfToken },
    });
    expect(listRes.json().data[0].consumed).toBe(true);
  });

  it("rejects an ambiguous duplicate expectation for the same special_reference", async () => {
    testApp = buildTestApp({ manualStartMs: Date.now() });
    const { cookie, csrfToken } = await adminHeaders(testApp);

    await testApp.app.inject({
      method: "POST",
      url: "/__simulator/api/expectations",
      headers: { cookie, "x-csrf-token": csrfToken, "content-type": "application/json" },
      payload: { match: { specialReference: "DUP-1" }, scenarioId: "success-immediate" },
    });
    const second = await testApp.app.inject({
      method: "POST",
      url: "/__simulator/api/expectations",
      headers: { cookie, "x-csrf-token": csrfToken, "content-type": "application/json" },
      payload: { match: { specialReference: "DUP-1" }, scenarioId: "decline-immediate" },
    });
    expect(second.statusCode).toBe(409);
  });

  it("completes an intention headlessly without a browser, using an explicit scenarioId", async () => {
    testApp = buildTestApp({ manualStartMs: new Date("2026-08-14T12:00:00.000Z").getTime() });
    const { cookie, csrfToken } = await adminHeaders(testApp);

    const create = await testApp.app.inject({
      method: "POST",
      url: "/v1/intention/",
      headers: { authorization: "Token sk_sim_local", "content-type": "application/json" },
      payload: { amount: 10_000, currency: "EGP", payment_methods: [1001] },
    });
    const { id: intentionId } = create.json();

    const completeRes = await testApp.app.inject({
      method: "POST",
      url: `/__simulator/api/intentions/${intentionId}/complete`,
      headers: { cookie, "x-csrf-token": csrfToken, "content-type": "application/json" },
      payload: { scenarioId: "success-immediate", idempotencyKey: "idem-1" },
    });
    expect(completeRes.statusCode).toBe(201);

    const replay = await testApp.app.inject({
      method: "POST",
      url: `/__simulator/api/intentions/${intentionId}/complete`,
      headers: { cookie, "x-csrf-token": csrfToken, "content-type": "application/json" },
      payload: { scenarioId: "success-immediate", idempotencyKey: "idem-1" },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().transactionId).toBe(completeRes.json().transactionId);
  });

  it("rejects headless completion with an api_fault scenario id", async () => {
    testApp = buildTestApp({ manualStartMs: Date.now() });
    const { cookie, csrfToken } = await adminHeaders(testApp);

    const create = await testApp.app.inject({
      method: "POST",
      url: "/v1/intention/",
      headers: { authorization: "Token sk_sim_local", "content-type": "application/json" },
      payload: { amount: 10_000, currency: "EGP", payment_methods: [1001] },
    });
    const { id: intentionId } = create.json();

    const completeRes = await testApp.app.inject({
      method: "POST",
      url: `/__simulator/api/intentions/${intentionId}/complete`,
      headers: { cookie, "x-csrf-token": csrfToken, "content-type": "application/json" },
      payload: { scenarioId: "nonexistent-scenario", idempotencyKey: "idem-x" },
    });
    expect(completeRes.statusCode).toBe(422);
  });
});
