import Fastify from "fastify";
import cookie from "@fastify/cookie";
import type Database from "better-sqlite3";
import type { AppDatabase } from "./database/connect.js";
import type { Clock } from "./core/clock.js";
import type { AppLogger } from "./core/logger.js";
import type { EffectiveConfig } from "./config/loader.js";
import { parseAllowlist } from "./security/allowlist.js";
import { registerModernIntentionRoutes } from "./compatibility/modern/intention-routes.js";
import { registerInquiryRoutes } from "./compatibility/legacy/inquiry-routes.js";
import { registerCheckoutRoutes } from "./checkout/checkout-routes.js";
import { registerStaticCheckoutRoutes } from "./checkout/static-routes.js";
import { registerAuthRoutes } from "./control-plane/auth-routes.js";
import { registerClockRoutes } from "./control-plane/clock-routes.js";
import type { SchedulerRunner } from "./core/scheduler-runner.js";

export interface ReadinessState {
  ready: boolean;
  reason?: string;
}

export interface AppDependencies {
  db: AppDatabase;
  raw: Database.Database;
  dbHealthCheck: () => boolean;
  config: EffectiveConfig;
  clock: Clock;
  logger: AppLogger;
  getReadiness: () => ReadinessState;
  scheduler: SchedulerRunner;
  adminTokenEnv: string | undefined;
}

export function buildApp(deps: AppDependencies) {
  const app = Fastify({
    loggerInstance: deps.logger,
    routerOptions: { ignoreTrailingSlash: true },
    bodyLimit: 256 * 1024,
  });

  app.decorate("deps", deps);

  app.register(cookie);

  app.get("/healthz", async (_req, reply) => {
    const alive = deps.dbHealthCheck();
    if (!alive) {
      return reply.code(503).send({ status: "error", database: "unreachable" });
    }
    return reply.code(200).send({ status: "ok" });
  });

  app.get("/readyz", async (_req, reply) => {
    const readiness = deps.getReadiness();
    if (!readiness.ready) {
      return reply.code(503).send({ ready: false, reason: readiness.reason ?? "not_ready" });
    }
    return reply.code(200).send({ ready: true });
  });

  app.setNotFoundHandler((req, reply) => {
    reply.header("X-Paymob-Simulator", "unsupported-route");
    reply.code(404).send({ detail: "Not Found" });
  });

  const webhookAllowlist = parseAllowlist(deps.config.values.security.allowedWebhookHosts);
  registerModernIntentionRoutes(app, {
    db: deps.db,
    clock: deps.clock,
    config: deps.config,
    webhookAllowlist,
    publicUrl: deps.config.values.server.publicUrl,
  });

  registerInquiryRoutes(app, { db: deps.db, clock: deps.clock });

  const defaultIntegrationId = deps.config.values.integrations[0]?.id ?? 1001;
  registerCheckoutRoutes(app, {
    db: deps.db,
    raw: deps.raw,
    clock: deps.clock,
    clockMode: deps.config.values.clock.mode,
    defaultIntegrationId,
    scheduler: deps.scheduler,
  });

  const authContext = { db: deps.db, clock: deps.clock, adminTokenEnv: deps.adminTokenEnv };
  registerAuthRoutes(app, {
    db: deps.db,
    clock: deps.clock,
    adminTokenEnv: deps.adminTokenEnv,
    secureCookies: deps.config.values.server.publicUrl.startsWith("https://"),
  });
  registerClockRoutes(app, { auth: authContext, clock: deps.clock, scheduler: deps.scheduler });

  registerStaticCheckoutRoutes(app, { allowedFrameAncestors: deps.config.values.browser.allowedFrameAncestors });

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    deps: AppDependencies;
  }
}
