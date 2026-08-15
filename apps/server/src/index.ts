import { resolve } from "node:path";
import { buildApp } from "./app.js";
import { loadConfig } from "./config/loader.js";
import { openDatabase } from "./database/connect.js";
import { runMigrations } from "./database/migrate.js";
import { readSettingsRows } from "./database/settings-repository.js";
import { ensureIdCounters } from "./core/id-allocator.js";
import { loadOrInitClock } from "./core/clock-repository.js";
import { createLogger } from "./core/logger.js";
import { computeReadiness } from "./core/readiness.js";
import { readRuntimeEnv } from "./config/env.js";

async function main() {
  const runtime = readRuntimeEnv(process.env);
  const logger = createLogger(runtime.logLevel);

  const filePath = resolve(runtime.dataDir, "simulator.sqlite");
  const opened = openDatabase({ filePath });
  runMigrations(opened);
  ensureIdCounters(opened.raw);

  const databaseSettings = readSettingsRows(opened.db);
  const config = loadConfig({ env: process.env, databaseSettings });

  const clock = loadOrInitClock(
    opened.db,
    config.values.clock.mode,
    config.values.clock.manualStart,
    () => new Date().toISOString(),
  );

  const app = buildApp({
    db: opened.db,
    dbHealthCheck: opened.healthCheck,
    config,
    clock,
    logger,
    getReadiness: () =>
      computeReadiness({
        db: opened.db,
        adminTokenConfiguredViaEnv: Boolean(process.env.SIM_ADMIN_TOKEN),
        scenarioRegistryValid: true,
      }),
  });

  const port = config.values.server.port;
  await app.listen({ port, host: "0.0.0.0" });
  logger.info({ port }, "paymob-simulator listening");

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down");
    await app.close();
    opened.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
