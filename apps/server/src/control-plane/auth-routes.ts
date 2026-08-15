import { z } from "zod";
import type { AppDatabase } from "../database/connect.js";
import type { Clock } from "../core/clock.js";
import {
  SESSION_COOKIE_NAME,
  bootstrapWithToken,
  deleteSession,
  findValidSession,
  loginWithRecoveryToken,
  touchSessionIdleExpiry,
  type AuthContext,
} from "./auth.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFastifyInstance = import("fastify").FastifyInstance<any, any, any, any, any>;

export interface AuthRouteDeps {
  db: AppDatabase;
  clock: Clock;
  adminTokenEnv: string | undefined;
  secureCookies: boolean;
}

const tokenBodySchema = z.object({ token: z.string().min(1) });

function authCtx(deps: AuthRouteDeps): AuthContext {
  return { db: deps.db, clock: deps.clock, adminTokenEnv: deps.adminTokenEnv };
}

export function registerAuthRoutes(app: AnyFastifyInstance, deps: AuthRouteDeps): void {
  app.post("/__simulator/api/auth/bootstrap", async (req, reply) => {
    const parsed = tokenBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(422).send({ error: { code: "invalid_body", message: "token is required" } });
    }

    const result = await bootstrapWithToken(authCtx(deps), parsed.data.token);
    if (!result.ok) {
      return reply.code(401).send({ error: { code: result.reason, message: "bootstrap failed" } });
    }

    reply.setCookie(SESSION_COOKIE_NAME, result.sessionToken, {
      httpOnly: true,
      sameSite: "strict",
      secure: deps.secureCookies,
      path: "/",
      expires: result.session.absoluteExpiresAt,
    });
    return reply.code(200).send({
      authenticated: true,
      csrfToken: result.session.csrfToken,
      expiresAt: result.session.idleExpiresAt.toISOString(),
    });
  });

  app.post("/__simulator/api/auth/login", async (req, reply) => {
    const parsed = tokenBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(422).send({ error: { code: "invalid_body", message: "token is required" } });
    }

    const result = loginWithRecoveryToken(authCtx(deps), parsed.data.token);
    if (!result.ok) {
      return reply.code(401).send({ error: { code: result.reason, message: "login failed" } });
    }

    reply.setCookie(SESSION_COOKIE_NAME, result.sessionToken, {
      httpOnly: true,
      sameSite: "strict",
      secure: deps.secureCookies,
      path: "/",
      expires: result.session.absoluteExpiresAt,
    });
    return reply.code(200).send({
      authenticated: true,
      csrfToken: result.session.csrfToken,
      expiresAt: result.session.idleExpiresAt.toISOString(),
    });
  });

  app.get("/__simulator/api/auth/session", async (req, reply) => {
    const sessionToken = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE_NAME];
    if (!sessionToken) return reply.code(200).send({ authenticated: false });

    const session = findValidSession(authCtx(deps), sessionToken);
    if (!session) return reply.code(200).send({ authenticated: false });

    touchSessionIdleExpiry(authCtx(deps), session.id);
    return reply.code(200).send({
      authenticated: true,
      csrfToken: session.csrfToken,
      expiresAt: session.idleExpiresAt,
    });
  });

  app.post("/__simulator/api/auth/logout", async (req, reply) => {
    const sessionToken = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE_NAME];
    if (sessionToken) deleteSession(authCtx(deps), sessionToken);
    reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
    return reply.code(200).send({ authenticated: false });
  });
}
