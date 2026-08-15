import Fastify from "fastify";
import cookie from "@fastify/cookie";
import type { AppDatabase } from "./database/connect.js";
import type { Clock } from "./core/clock.js";
import type { AppLogger } from "./core/logger.js";
import type { EffectiveConfig } from "./config/loader.js";
import { parseAllowlist } from "./security/allowlist.js";
import { registerModernIntentionRoutes } from "./compatibility/modern/intention-routes.js";

export interface ReadinessState {
  ready: boolean;
  reason?: string;
}

export interface AppDependencies {
  db: AppDatabase;
  dbHealthCheck: () => boolean;
  config: EffectiveConfig;
  clock: Clock;
  logger: AppLogger;
  getReadiness: () => ReadinessState;
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

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    deps: AppDependencies;
  }
}
