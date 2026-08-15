import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { openDatabase, type OpenedDatabase } from "./database/connect.js";
import { runMigrations } from "./database/migrate.js";
import { RealClock } from "./core/clock.js";
import { createLogger } from "./core/logger.js";
import { loadConfig } from "./config/loader.js";

describe("buildApp", () => {
  let opened: OpenedDatabase;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    opened = openDatabase({ filePath: ":memory:" });
    runMigrations(opened);
    app = buildApp({
      db: opened.db,
      dbHealthCheck: opened.healthCheck,
      config: loadConfig({ env: {} }),
      clock: new RealClock(),
      logger: createLogger("silent"),
      getReadiness: () => ({ ready: false, reason: "setup_required" }),
    });
  });

  afterEach(async () => {
    await app.close();
    opened.close();
  });

  it("reports healthy once the database is reachable", async () => {
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("reports not ready with the setup_required reason before setup", async () => {
    const res = await app.inject({ method: "GET", url: "/readyz" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ready: false, reason: "setup_required" });
  });

  it("tags unknown routes with the simulator diagnostic header and never proxies", async () => {
    const res = await app.inject({ method: "GET", url: "/does/not/exist" });
    expect(res.statusCode).toBe(404);
    expect(res.headers["x-paymob-simulator"]).toBe("unsupported-route");
  });
});
