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

describe("GET /__simulator/api/settings", () => {
  let testApp: TestApp;

  afterEach(async () => {
    await testApp?.close();
  });

  it("requires authentication", async () => {
    testApp = buildTestApp({ manualStartMs: Date.now() });
    const res = await testApp.app.inject({ method: "GET", url: "/__simulator/api/settings" });
    expect(res.statusCode).toBe(401);
  });

  it("returns flattened settings with source and locked metadata, masking secrets", async () => {
    testApp = buildTestApp({ manualStartMs: Date.now(), env: { SIM_SECRET_KEY: "sk_sim_from_env" } });
    const { cookie, csrfToken } = await adminHeaders(testApp);

    const res = await testApp.app.inject({
      method: "GET",
      url: "/__simulator/api/settings",
      headers: { cookie, "x-csrf-token": csrfToken },
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<{ path: string; value: unknown; source: string; locked: boolean }>;

    const secretKeyRow = rows.find((r) => r.path === "credentials.secretKey")!;
    expect(secretKeyRow.source).toBe("env");
    expect(secretKeyRow.locked).toBe(true);
    expect(secretKeyRow.value).not.toBe("sk_sim_from_env");
    expect(secretKeyRow.value).toMatch(/^sk_\*\*\*/);

    const currencyRow = rows.find((r) => r.path === "defaults.currency")!;
    expect(currencyRow.value).toBe("EGP");
    expect(currencyRow.source).toBe("default");
    expect(currencyRow.locked).toBe(false);

    const publicKeyRow = rows.find((r) => r.path === "credentials.publicKey")!;
    expect(publicKeyRow.value).toBe("pk_sim_local"); // public key is never masked
  });

  it("does not require the CSRF header for a safe (GET) request over a session cookie", async () => {
    // Regression: authenticateAdminRequest previously required X-CSRF-Token
    // to match for every session-authenticated request, including GET,
    // contradicting spec 16 ("session MUTATIONS require X-CSRF-Token") and
    // breaking the dashboard's read-only list/detail pages, which never
    // send that header on GET.
    testApp = buildTestApp({ manualStartMs: Date.now() });
    const { cookie } = await adminHeaders(testApp);

    const res = await testApp.app.inject({
      method: "GET",
      url: "/__simulator/api/settings",
      headers: { cookie }, // deliberately no x-csrf-token
    });
    expect(res.statusCode).toBe(200);
  });
});
