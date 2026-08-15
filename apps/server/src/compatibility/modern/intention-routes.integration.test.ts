import { afterEach, describe, expect, it } from "vitest";
import { buildTestApp, type TestApp } from "../../test-helpers/build-test-app.js";

describe("modern intention routes", () => {
  let testApp: TestApp;

  afterEach(async () => {
    await testApp?.close();
  });

  it("creates an intention with valid credentials and the documented minimal shape", async () => {
    testApp = buildTestApp();
    const res = await testApp.app.inject({
      method: "POST",
      url: "/v1/intention/",
      headers: { authorization: "Token sk_sim_local", "content-type": "application/json" },
      payload: { amount: 10_000, currency: "EGP", payment_methods: [1001] },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toMatch(/^pi_sim_/);
    expect(body.client_secret).toMatch(/^csk_test_sim_/);
    expect(body.intention_detail).toEqual({ amount: 10_000, currency: "EGP" });
    expect(res.headers["x-paymob-simulator-checkout-url"]).toContain("/unifiedcheckout/?publicKey=");
  });

  it("rejects an absent/invalid Authorization header with 401", async () => {
    testApp = buildTestApp();
    const res = await testApp.app.inject({
      method: "POST",
      url: "/v1/intention/",
      headers: { "content-type": "application/json" },
      payload: { amount: 10_000, currency: "EGP", payment_methods: [1001] },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ detail: "incorrect credentials" });

    const wrongKey = await testApp.app.inject({
      method: "POST",
      url: "/v1/intention/",
      headers: { authorization: "Token sk_wrong", "content-type": "application/json" },
      payload: { amount: 10_000, currency: "EGP", payment_methods: [1001] },
    });
    expect(wrongKey.statusCode).toBe(401);
  });

  it("supports GET :id retrieval and GET element without leaking billing/callback data", async () => {
    testApp = buildTestApp();
    const create = await testApp.app.inject({
      method: "POST",
      url: "/v1/intention/",
      headers: { authorization: "Token sk_sim_local", "content-type": "application/json" },
      payload: {
        amount: 10_000,
        currency: "EGP",
        payment_methods: [1001],
        notification_url: "http://backend:3000/webhooks/paymob",
        billing_data: { first_name: "Test" },
      },
    });
    const { id, client_secret: clientSecret } = create.json();

    const getById = await testApp.app.inject({
      method: "GET",
      url: `/v1/intention/${id}`,
      headers: { authorization: "Token sk_sim_local" },
    });
    expect(getById.statusCode).toBe(200);
    expect(getById.json().status).toBe("intended");
    expect(getById.json().client_secret).not.toContain(clientSecret);

    const element = await testApp.app.inject({
      method: "GET",
      url: `/v1/intention/element/${testApp.config.values.credentials.publicKey}/${clientSecret}`,
    });
    expect(element.statusCode).toBe(200);
    const elementBody = element.json();
    expect(elementBody).toEqual({
      id,
      amount: 10_000,
      currency: "EGP",
      status: "intended",
      expires_at: expect.any(String),
      payment_methods: [1001],
    });
    expect(elementBody.notification_url).toBeUndefined();
    expect(elementBody.billing_data).toBeUndefined();
  });

  it("updates an intention via PUT and revalidates the merged object's item totals", async () => {
    testApp = buildTestApp();
    const create = await testApp.app.inject({
      method: "POST",
      url: "/v1/intention/",
      headers: { authorization: "Token sk_sim_local", "content-type": "application/json" },
      payload: { amount: 10_000, currency: "EGP", payment_methods: [1001] },
    });
    const { client_secret: clientSecret } = create.json();

    const okUpdate = await testApp.app.inject({
      method: "PUT",
      url: `/v1/intention/${clientSecret}`,
      headers: { authorization: "Token sk_sim_local", "content-type": "application/json" },
      payload: { amount: 20_000 },
    });
    expect(okUpdate.statusCode).toBe(200);
    expect(okUpdate.json().intention_detail.amount).toBe(20_000);

    const badUpdate = await testApp.app.inject({
      method: "PUT",
      url: `/v1/intention/${clientSecret}`,
      headers: { authorization: "Token sk_sim_local", "content-type": "application/json" },
      payload: { items: [{ name: "x", amount: 5_000, quantity: 1 }] },
    });
    expect(badUpdate.statusCode).toBe(406);
  });

  it("returns 404 for an unknown intention id or client secret", async () => {
    testApp = buildTestApp();
    const res = await testApp.app.inject({
      method: "GET",
      url: "/v1/intention/pi_sim_doesnotexist",
      headers: { authorization: "Token sk_sim_local" },
    });
    expect(res.statusCode).toBe(404);
  });
});
