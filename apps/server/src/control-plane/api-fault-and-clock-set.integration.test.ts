import { afterEach, describe, expect, it } from "vitest";
import { buildTestApp, type TestApp } from "../test-helpers/build-test-app.js";
import { ensureBootstrapToken } from "../core/bootstrap.js";

async function adminHeaders(app: TestApp) {
  const token = await ensureBootstrapToken(app.opened.db, new Date().toISOString());
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

describe("API-fault expectations", () => {
  let testApp: TestApp;

  afterEach(async () => {
    testApp?.app.server.closeAllConnections?.();
    await testApp?.close();
  });

  it("injects a configured status/body fault into intention.create, matched by special_reference", async () => {
    testApp = buildTestApp({ manualStartMs: new Date("2026-08-14T12:00:00.000Z").getTime() });
    const { cookie, csrfToken } = await adminHeaders(testApp);

    const expRes = await testApp.app.inject({
      method: "POST",
      url: "/__simulator/api/expectations",
      headers: { cookie, "x-csrf-token": csrfToken, "content-type": "application/json" },
      payload: {
        match: { operation: "intention.create", specialReference: "E2E-API-FAIL" },
        response: { status: 500, body: { detail: "Simulated provider failure" } },
        times: 1,
      },
    });
    expect(expRes.statusCode).toBe(201);

    const createRes = await testApp.app.inject({
      method: "POST",
      url: "/v1/intention/",
      headers: { authorization: "Token sk_sim_local", "content-type": "application/json" },
      payload: {
        amount: 10_000,
        currency: "EGP",
        payment_methods: [1001],
        special_reference: "E2E-API-FAIL",
      },
    });
    expect(createRes.statusCode).toBe(500);
    expect(createRes.json()).toEqual({ detail: "Simulated provider failure" });

    // The expectation is single-use: a second identical request proceeds normally.
    const secondRes = await testApp.app.inject({
      method: "POST",
      url: "/v1/intention/",
      headers: { authorization: "Token sk_sim_local", "content-type": "application/json" },
      payload: {
        amount: 10_000,
        currency: "EGP",
        payment_methods: [1001],
        special_reference: "E2E-API-FAIL",
      },
    });
    expect(secondRes.statusCode).toBe(201);
  });

  it("never triggers for a request without the matching special_reference", async () => {
    testApp = buildTestApp({ manualStartMs: Date.now() });
    const { cookie, csrfToken } = await adminHeaders(testApp);

    await testApp.app.inject({
      method: "POST",
      url: "/__simulator/api/expectations",
      headers: { cookie, "x-csrf-token": csrfToken, "content-type": "application/json" },
      payload: {
        match: { operation: "intention.create", specialReference: "ONLY-THIS-ONE" },
        response: { status: 503 },
      },
    });

    const res = await testApp.app.inject({
      method: "POST",
      url: "/v1/intention/",
      headers: { authorization: "Token sk_sim_local", "content-type": "application/json" },
      payload: { amount: 10_000, currency: "EGP", payment_methods: [1001], special_reference: "SOMETHING-ELSE" },
    });
    expect(res.statusCode).toBe(201);
  });

  it("applies a fault to intention.update matched by the intention's existing special_reference", async () => {
    testApp = buildTestApp({ manualStartMs: Date.now() });
    const { cookie, csrfToken } = await adminHeaders(testApp);

    const create = await testApp.app.inject({
      method: "POST",
      url: "/v1/intention/",
      headers: { authorization: "Token sk_sim_local", "content-type": "application/json" },
      payload: { amount: 10_000, currency: "EGP", payment_methods: [1001], special_reference: "UPDATE-FAULT-1" },
    });
    const { client_secret: clientSecret } = create.json();

    await testApp.app.inject({
      method: "POST",
      url: "/__simulator/api/expectations",
      headers: { cookie, "x-csrf-token": csrfToken, "content-type": "application/json" },
      payload: {
        match: { operation: "intention.update", specialReference: "UPDATE-FAULT-1" },
        response: { status: 502, body: { detail: "Bad gateway" } },
      },
    });

    const updateRes = await testApp.app.inject({
      method: "PUT",
      url: `/v1/intention/${clientSecret}`,
      headers: { authorization: "Token sk_sim_local", "content-type": "application/json" },
      payload: { amount: 20_000 },
    });
    expect(updateRes.statusCode).toBe(502);
  });
});

describe("manual clock POST /clock/set", () => {
  let testApp: TestApp;

  afterEach(async () => {
    testApp?.app.server.closeAllConnections?.();
    await testApp?.close();
  });

  it("sets the clock forward and drains due scheduled actions", async () => {
    testApp = buildTestApp({ manualStartMs: new Date("2026-08-14T12:00:00.000Z").getTime() });
    const { cookie, csrfToken } = await adminHeaders(testApp);

    const setRes = await testApp.app.inject({
      method: "POST",
      url: "/__simulator/api/clock/set",
      headers: { cookie, "x-csrf-token": csrfToken, "content-type": "application/json" },
      payload: { to: "2026-08-14T12:05:00.000Z" },
    });
    expect(setRes.statusCode).toBe(200);
    expect(setRes.json().old).toBe("2026-08-14T12:00:00.000Z");
    expect(setRes.json().new).toBe("2026-08-14T12:05:00.000Z");
  });

  it("rejects moving the clock backward with 409", async () => {
    testApp = buildTestApp({ manualStartMs: new Date("2026-08-14T12:00:00.000Z").getTime() });
    const { cookie, csrfToken } = await adminHeaders(testApp);

    const res = await testApp.app.inject({
      method: "POST",
      url: "/__simulator/api/clock/set",
      headers: { cookie, "x-csrf-token": csrfToken, "content-type": "application/json" },
      payload: { to: "2026-08-14T11:00:00.000Z" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("clock_would_move_backward");
  });

  it("rejects clock/set entirely when running in real-clock mode", async () => {
    testApp = buildTestApp({}); // no manualStartMs -> RealClock
    const { cookie, csrfToken } = await adminHeaders(testApp);

    const res = await testApp.app.inject({
      method: "POST",
      url: "/__simulator/api/clock/set",
      headers: { cookie, "x-csrf-token": csrfToken, "content-type": "application/json" },
      payload: { to: new Date(Date.now() + 60_000).toISOString() },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("clock_mode_not_manual");
  });
});
