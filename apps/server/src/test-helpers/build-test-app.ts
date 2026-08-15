import { parseDuration } from "@paymob-simulator/contracts";
import { buildApp } from "../app.js";
import { loadConfig, type EffectiveConfig } from "../config/loader.js";
import { openDatabase, type OpenedDatabase } from "../database/connect.js";
import { runMigrations } from "../database/migrate.js";
import { ensureIdCounters } from "../core/id-allocator.js";
import { ensureCredentialsSeeded, getActiveCredential, getCredentialByVersion } from "../core/credentials.js";
import { syncIntegrations } from "../database/integrations-repository.js";
import { syncBuiltInScenarios } from "../core/scenario-registry.js";
import { RealClock, ManualClock, type Clock } from "../core/clock.js";
import { createLogger } from "../core/logger.js";
import { SchedulerRunner } from "../core/scheduler-runner.js";
import { parseAllowlist } from "../security/allowlist.js";
import type { DnsResolver } from "../security/dns-pin.js";

export interface TestApp {
  app: ReturnType<typeof buildApp>;
  opened: OpenedDatabase;
  config: EffectiveConfig;
  clock: Clock;
  scheduler: SchedulerRunner;
  close: () => Promise<void>;
}

export interface BuildTestAppOptions {
  env?: NodeJS.ProcessEnv;
  manualStartMs?: number;
  ready?: boolean;
  adminTokenEnv?: string;
  resolver?: DnsResolver;
}

const noopResolver: DnsResolver = {
  resolve4: async () => [],
  resolve6: async () => [],
};

/** Boots a fully-seeded in-memory app (credentials + integrations + scenarios) for route-level integration tests. */
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
  syncBuiltInScenarios(opened.db, nowIso);

  const clock: Clock = opts.manualStartMs !== undefined ? new ManualClock(opts.manualStartMs) : new RealClock();
  const resolver = opts.resolver ?? noopResolver;
  const retryPolicy = {
    retryOnTransportError: config.values.delivery.retryOnTransportError,
    retryOnStatuses: config.values.delivery.retryOnStatuses,
    intervalsMs: config.values.delivery.retryIntervals.map((s) => parseDuration(s)),
    maxAttempts: config.values.delivery.maxAttempts,
  };
  const requestTimeoutMs = parseDuration(config.values.delivery.requestTimeout);

  const scheduler = new SchedulerRunner({
    db: opened.db,
    raw: opened.raw,
    clock,
    workerOwnerId: "test-worker",
    leaseDurationMs: 30_000,
    getHmacSecretForVersion: (version) =>
      getCredentialByVersion(opened.db, "hmac_secret", version) ?? getActiveCredential(opened.db, "hmac_secret").value,
    allowlist: parseAllowlist(config.values.security.allowedWebhookHosts),
    allowPrivateNetworks: config.values.security.allowPrivateNetworks,
    resolver,
    requestTimeoutMs,
    retryPolicy,
    defaultRedirectMode: config.values.defaults.redirectMode,
  });

  const app = buildApp({
    db: opened.db,
    raw: opened.raw,
    dbHealthCheck: opened.healthCheck,
    config,
    clock,
    logger: createLogger("silent"),
    scheduler,
    adminTokenEnv: opts.adminTokenEnv,
    resolver,
    retryPolicy,
    requestTimeoutMs,
    getReadiness: () => ({ ready: opts.ready ?? true }),
  });

  return {
    app,
    opened,
    config,
    clock,
    scheduler,
    close: async () => {
      scheduler.stop();
      await app.close();
      opened.close();
    },
  };
}
