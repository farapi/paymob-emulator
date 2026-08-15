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

// Admin pages must never be embeddable, regardless of the checkout
// frame-ancestors allowlist (spec 17.2, 20.1).
const ADMIN_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join("; ");

/**
 * Serves the built React SPA (checkout under /unifiedcheckout/, admin
 * dashboard under /__simulator/dashboard/) with the restrictive per-surface
 * CSPs from spec 20.5/17.2/20.1. Vite's `base: "/"` means both entry pages
 * reference the same root-relative /assets/*, served once here.
 */
export function registerStaticCheckoutRoutes(app: AnyFastifyInstance, deps: StaticCheckoutDeps): void {
  if (!existsSync(WEB_DIST)) {
    app.log.warn(`apps/web is not built (missing ${WEB_DIST}); the checkout page and dashboard will 404 until "pnpm build" runs`);
    return;
  }

  app.register(staticPlugin, {
    root: resolve(WEB_DIST, "assets"),
    prefix: "/assets/",
    decorateReply: false,
  });

  const indexHtml = readFileSync(resolve(WEB_DIST, "index.html"), "utf-8");
  const serveSpa = async (_req: unknown, reply: { type: (t: string) => { send: (b: string) => unknown } }) =>
    reply.type("text/html").send(indexHtml);

  app.get("/unifiedcheckout/", serveSpa);
  app.get("/unifiedcheckout/*", serveSpa);
  app.get("/__simulator/dashboard/", serveSpa);
  app.get("/__simulator/dashboard/*", serveSpa);

  app.addHook("onSend", async (req, reply, payload) => {
    if (req.url.startsWith("/unifiedcheckout/") || req.url.startsWith("/embed/")) {
      reply.header("Content-Security-Policy", checkoutCsp(deps.allowedFrameAncestors));
      reply.header("Referrer-Policy", "no-referrer");
      reply.header("X-Content-Type-Options", "nosniff");
    } else if (req.url.startsWith("/__simulator/dashboard/")) {
      reply.header("Content-Security-Policy", ADMIN_CSP);
      reply.header("Referrer-Policy", "no-referrer");
      reply.header("X-Content-Type-Options", "nosniff");
      reply.header("X-Frame-Options", "DENY");
    }
    return payload;
  });
}
