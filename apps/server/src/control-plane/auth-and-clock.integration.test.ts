import { afterEach, describe, expect, it } from "vitest";
import { buildTestApp, type TestApp } from "../test-helpers/build-test-app.js";
import { ensureBootstrapToken } from "../core/bootstrap.js";

describe("admin auth + clock control routes", () => {
  let testApp: TestApp;

  afterEach(async () => {
    await testApp?.close();
  });

  it("rejects clock advance without authentication", async () => {
    testApp = buildTestApp({ manualStartMs: Date.now() });
    const res = await testApp.app.inject({
      method: "POST",
      url: "/__simulator/api/clock/advance",
      payload: { by: "2m" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("authenticates a bearer token and advances the manual clock", async () => {
    testApp = buildTestApp({ manualStartMs: new Date("2026-01-01T00:00:00.000Z").getTime(), adminTokenEnv: "sim_admin_test" });
    const res = await testApp.app.inject({
      method: "POST",
      url: "/__simulator/api/clock/advance",
      headers: { authorization: "Bearer sim_admin_test", "content-type": "application/json" },
      payload: { by: "2m", drain: true },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.old).toBe("2026-01-01T00:00:00.000Z");
    expect(body.new).toBe("2026-01-01T00:02:00.000Z");
  });

  it("rejects a bearer token that doesn't match", async () => {
    testApp = buildTestApp({ manualStartMs: Date.now(), adminTokenEnv: "sim_admin_test" });
    const res = await testApp.app.inject({
      method: "POST",
      url: "/__simulator/api/clock/advance",
      headers: { authorization: "Bearer wrong-token", "content-type": "application/json" },
      payload: { by: "2m" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("bootstraps a session via the terminal token, then authenticates control-plane routes with cookie + CSRF", async () => {
    testApp = buildTestApp({ manualStartMs: Date.now() });
    const token = await ensureBootstrapToken(testApp.opened.db, new Date().toISOString());
    expect(token).toBeTruthy();

    const bootstrapRes = await testApp.app.inject({
      method: "POST",
      url: "/__simulator/api/auth/bootstrap",
      headers: { "content-type": "application/json" },
      payload: { token },
    });
    expect(bootstrapRes.statusCode).toBe(200);
    const { csrfToken } = bootstrapRes.json();
    const setCookieHeader = bootstrapRes.headers["set-cookie"];
    expect(setCookieHeader).toBeDefined();
    const cookieValue = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
    const sessionCookie = (cookieValue as string).split(";")[0];

    // Without CSRF header, session-cookie mutation fails.
    const noCsrf = await testApp.app.inject({
      method: "POST",
      url: "/__simulator/api/clock/advance",
      headers: { cookie: sessionCookie, "content-type": "application/json" },
      payload: { by: "1m" },
    });
    expect(noCsrf.statusCode).toBe(403);

    const withCsrf = await testApp.app.inject({
      method: "POST",
      url: "/__simulator/api/clock/advance",
      headers: { cookie: sessionCookie, "x-csrf-token": csrfToken, "content-type": "application/json" },
      payload: { by: "1m" },
    });
    expect(withCsrf.statusCode).toBe(200);

    // The bootstrap token cannot be reused.
    const secondBootstrap = await testApp.app.inject({
      method: "POST",
      url: "/__simulator/api/auth/bootstrap",
      headers: { "content-type": "application/json" },
      payload: { token },
    });
    expect(secondBootstrap.statusCode).toBe(401);
  });

  it("reports session info via GET /auth/session and clears it on logout", async () => {
    testApp = buildTestApp({ manualStartMs: Date.now() });
    const token = await ensureBootstrapToken(testApp.opened.db, new Date().toISOString());
    const bootstrapRes = await testApp.app.inject({
      method: "POST",
      url: "/__simulator/api/auth/bootstrap",
      headers: { "content-type": "application/json" },
      payload: { token },
    });
    const cookieValue = bootstrapRes.headers["set-cookie"];
    const sessionCookie = (Array.isArray(cookieValue) ? cookieValue[0] : cookieValue) as string;
    const cookieHeader = sessionCookie.split(";")[0];

    const sessionRes = await testApp.app.inject({
      method: "GET",
      url: "/__simulator/api/auth/session",
      headers: { cookie: cookieHeader },
    });
    expect(sessionRes.json().authenticated).toBe(true);

    await testApp.app.inject({
      method: "POST",
      url: "/__simulator/api/auth/logout",
      headers: { cookie: cookieHeader },
    });

    const afterLogout = await testApp.app.inject({
      method: "GET",
      url: "/__simulator/api/auth/session",
      headers: { cookie: cookieHeader },
    });
    expect(afterLogout.json().authenticated).toBe(false);
  });
});
