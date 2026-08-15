import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp, type TestApp } from "./test-helpers/build-test-app.js";

describe("buildApp", () => {
  let testApp: TestApp;

  beforeEach(() => {
    testApp = buildTestApp({ ready: false });
  });

  afterEach(async () => {
    await testApp.close();
  });

  it("reports healthy once the database is reachable", async () => {
    const res = await testApp.app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("reports not ready before setup", async () => {
    const res = await testApp.app.inject({ method: "GET", url: "/readyz" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ready: false, reason: "not_ready" });
  });

  it("tags unknown routes with the simulator diagnostic header and never proxies", async () => {
    const res = await testApp.app.inject({ method: "GET", url: "/does/not/exist" });
    expect(res.statusCode).toBe(404);
    expect(res.headers["x-paymob-simulator"]).toBe("unsupported-route");
  });
});
