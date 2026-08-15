import { buildApp } from "../app.js";
import { loadConfig, type EffectiveConfig } from "../config/loader.js";
import { openDatabase, type OpenedDatabase } from "../database/connect.js";
import { runMigrations } from "../database/migrate.js";
import { ensureIdCounters } from "../core/id-allocator.js";
import { ensureCredentialsSeeded } from "../core/credentials.js";
import { syncIntegrations } from "../database/integrations-repository.js";
import { RealClock, ManualClock, type Clock } from "../core/clock.js";
import { createLogger } from "../core/logger.js";

export interface TestApp {
  app: ReturnType<typeof buildApp>;
  opened: OpenedDatabase;
  config: EffectiveConfig;
  clock: Clock;
  close: () => Promise<void>;
}

export interface BuildTestAppOptions {
  env?: NodeJS.ProcessEnv;
  manualStartMs?: number;
  ready?: boolean;
}

/** Boots a fully-seeded in-memory app (credentials + integrations) for route-level integration tests. */
export function buildTestApp(opts: BuildTestAppOptions = {}): TestApp {
  const opened = openDatabase({ filePath: ":memory:" });
  runMigrations(opened);
  ensureIdCounters(opened.raw);

  const config = loadConfig({ env: opts.env ?? {} });
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

  const clock: Clock = opts.manualStartMs !== undefined ? new ManualClock(opts.manualStartMs) : new RealClock();

  const app = buildApp({
    db: opened.db,
    dbHealthCheck: opened.healthCheck,
    config,
    clock,
    logger: createLogger("silent"),
    getReadiness: () => ({ ready: opts.ready ?? true }),
  });

  return {
    app,
    opened,
    config,
    clock,
    close: async () => {
      await app.close();
      opened.close();
    },
  };
}
