import type { EffectiveConfig } from "../config/loader.js";
import type { AuthContext } from "./auth.js";
import { requireAdmin } from "./require-admin.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFastifyInstance = import("fastify").FastifyInstance<any, any, any, any, any>;

export interface SettingsRouteDeps {
  auth: AuthContext;
  config: EffectiveConfig;
}

const SECRET_LEAF_PATHS = new Set([
  "credentials.secretKey",
  "credentials.apiKey",
  "credentials.hmacSecret",
  "security.adminToken",
]);

function maskIfSecret(path: string, value: unknown): unknown {
  if (!SECRET_LEAF_PATHS.has(path) || typeof value !== "string" || value.length === 0) return value;
  return `${value.slice(0, 3)}***${value.slice(-2)}`;
}

/** Flattens the effective config into {path, value, source, locked} leaves for the settings UI (spec 8.1). */
function flattenWithSources(deps: SettingsRouteDeps): Array<{
  path: string;
  value: unknown;
  source: string;
  locked: boolean;
}> {
  const out: Array<{ path: string; value: unknown; source: string; locked: boolean }> = [];

  function walk(node: unknown, prefix: string) {
    if (node === null || typeof node !== "object" || Array.isArray(node)) {
      out.push({
        path: prefix,
        value: maskIfSecret(prefix, node),
        source: deps.config.leafSources.get(prefix) ?? "default",
        locked: deps.config.lockedPaths.has(prefix),
      });
      return;
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      walk(value, prefix ? `${prefix}.${key}` : key);
    }
  }

  walk(deps.config.values, "");
  return out;
}

export function registerSettingsRoutes(app: AnyFastifyInstance, deps: SettingsRouteDeps): void {
  app.get("/__simulator/api/settings", { preHandler: requireAdmin(deps.auth) }, async (_req, reply) => {
    return reply.code(200).send({ data: flattenWithSources(deps) });
  });
}
