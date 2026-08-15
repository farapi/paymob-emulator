import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { parseDuration } from "@paymob-simulator/contracts";
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
import { ensureCredentialsSeeded, getActiveCredential, getCredentialByVersion } from "./core/credentials.js";
import { syncIntegrations } from "./database/integrations-repository.js";
import { syncBuiltInScenarios } from "./core/scenario-registry.js";
import { ensureBootstrapToken } from "./core/bootstrap.js";
import { SchedulerRunner } from "./core/scheduler-runner.js";
import { parseAllowlist } from "./security/allowlist.js";
import { nodeDnsResolver } from "./security/dns-pin.js";

async function main() {
  const runtime = readRuntimeEnv(process.env);
  const logger = createLogger(runtime.logLevel);

  const filePath = resolve(runtime.dataDir, "simulator.sqlite");
  const opened = openDatabase({ filePath });
  runMigrations(opened);
  ensureIdCounters(opened.raw);

  const databaseSettings = readSettingsRows(opened.db);
  const config = loadConfig({ env: process.env, databaseSettings });

  const nowIso = new Date().toISOString();
  ensureCredentialsSeeded(
    opened.db,
    {
      secret_key: config.values.credentials.secretKey,
      public_key: config.values.credentials.publicKey,
      api_key: config.values.credentials.apiKey,
      hmac_secret: config.values.credentials.hmacSecret,
    },
    nowIso,
  );
  syncIntegrations(opened.db, config.values.integrations, config.values.features.enableLegacy, nowIso);
  syncBuiltInScenarios(opened.db, nowIso);

  const bootstrapToken = await ensureBootstrapToken(opened.db, nowIso);
  if (bootstrapToken) {
    // Printed once, plaintext, per spec 8.4 step 1. Never logged through the
    // structured (redacted) logger since that would defeat "printed once".
    console.log("\n=================================================================");
    console.log(" Paymob Simulator first-run bootstrap token (shown only once):");
    console.log(` ${bootstrapToken}`);
    console.log(" Open the setup wizard and paste this token to continue.");
    console.log("=================================================================\n");
  }

  const clock = loadOrInitClock(
    opened.db,
    config.values.clock.mode,
    config.values.clock.manualStart,
    () => new Date().toISOString(),
  );

  const webhookAllowlist = parseAllowlist(config.values.security.allowedWebhookHosts);
  const retryIntervalsMs = config.values.delivery.retryIntervals.map((s) => parseDuration(s));
  const requestTimeoutMs = parseDuration(config.values.delivery.requestTimeout);
  const retryPolicy = {
    retryOnTransportError: config.values.delivery.retryOnTransportError,
    retryOnStatuses: config.values.delivery.retryOnStatuses,
    intervalsMs: retryIntervalsMs,
    maxAttempts: config.values.delivery.maxAttempts,
  };

  const scheduler = new SchedulerRunner({
    db: opened.db,
    raw: opened.raw,
    clock,
    workerOwnerId: randomUUID(),
    leaseDurationMs: 30_000,
    getHmacSecretForVersion: (version) =>
      getCredentialByVersion(opened.db, "hmac_secret", version) ?? getActiveCredential(opened.db, "hmac_secret").value,
    allowlist: webhookAllowlist,
    allowPrivateNetworks: config.values.security.allowPrivateNetworks,
    resolver: nodeDnsResolver,
    requestTimeoutMs,
    retryPolicy,
    defaultRedirectMode: config.values.defaults.redirectMode,
  });
  scheduler.start();

  const app = buildApp({
    db: opened.db,
    raw: opened.raw,
    dbHealthCheck: opened.healthCheck,
    config,
    clock,
    logger,
    scheduler,
    adminTokenEnv: process.env.SIM_ADMIN_TOKEN,
    resolver: nodeDnsResolver,
    retryPolicy,
    requestTimeoutMs,
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
    scheduler.stop();
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
