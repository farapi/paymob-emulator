import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import staticPlugin from "@fastify/static";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFastifyInstance = import("fastify").FastifyInstance<any, any, any, any, any>;

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_DIST = resolve(HERE, "../../../web/dist");

export interface StaticCheckoutDeps {
  allowedFrameAncestors: readonly string[];
}

function checkoutCsp(allowedFrameAncestors: readonly string[]): string {
  const ancestors = allowedFrameAncestors.length > 0 ? allowedFrameAncestors.join(" ") : "'none'";
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "font-src 'self'",
    `frame-ancestors ${ancestors}`,
    "base-uri 'none'",
  ].join("; ");
}

/**
 * Serves the built Unified Checkout SPA under /unifiedcheckout/ with the
 * restrictive checkout-surface CSP from spec 20.5 (no external fonts,
 * analytics, images, or scripts; frame-ancestors limited to configured
 * merchant origins; no-referrer).
 */
export function registerStaticCheckoutRoutes(app: AnyFastifyInstance, deps: StaticCheckoutDeps): void {
  if (!existsSync(WEB_DIST)) {
    app.log.warn(`apps/web is not built (missing ${WEB_DIST}); /unifiedcheckout/ will 404 until "pnpm build" runs`);
    return;
  }

  app.register(staticPlugin, {
    root: WEB_DIST,
    prefix: "/unifiedcheckout/",
    index: false,
    decorateReply: false,
  });

  const indexHtml = readFileSync(resolve(WEB_DIST, "index.html"), "utf-8");
  app.get("/unifiedcheckout/", async (_req, reply) => {
    return reply.type("text/html").send(indexHtml);
  });

  app.addHook("onSend", async (req, reply, payload) => {
    if (req.url.startsWith("/unifiedcheckout/") || req.url.startsWith("/embed/")) {
      reply.header("Content-Security-Policy", checkoutCsp(deps.allowedFrameAncestors));
      reply.header("Referrer-Policy", "no-referrer");
      reply.header("X-Content-Type-Options", "nosniff");
    }
    return payload;
  });
}
