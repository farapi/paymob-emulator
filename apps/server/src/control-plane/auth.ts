import { eq } from "drizzle-orm";
import type { AppDatabase } from "../database/connect.js";
import { adminSessions, bootstrapTokens } from "../database/schema.js";
import {
  constantTimeEqual,
  createNewSession,
  hashSessionToken,
  verifySecretToken,
} from "../security/admin-auth.js";
import type { Clock } from "../core/clock.js";

export const SESSION_COOKIE_NAME = "sim_session";

export interface AuthContext {
  db: AppDatabase;
  clock: Clock;
  adminTokenEnv: string | undefined;
}

export interface SessionInfo {
  sessionId: string;
  csrfToken: string;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
}

export async function bootstrapWithToken(
  ctx: AuthContext,
  providedToken: string,
): Promise<{ ok: true; session: SessionInfo; sessionToken: string } | { ok: false; reason: string }> {
  const row = ctx.db.select().from(bootstrapTokens).where(eq(bootstrapTokens.id, 1)).get();
  if (!row || row.consumed) return { ok: false, reason: "bootstrap_unavailable" };

  const valid = await verifySecretToken(providedToken, row.tokenHash);
  if (!valid) return { ok: false, reason: "invalid_token" };

  const now = ctx.clock.now();
  return ctx.db.transaction((tx) => {
    tx.update(bootstrapTokens).set({ consumed: true }).where(eq(bootstrapTokens.id, 1)).run();
    const session = createNewSession(now);
    tx.insert(adminSessions)
      .values({
        id: session.id,
        sessionTokenHash: session.sessionTokenHash,
        csrfToken: session.csrfToken,
        createdAt: session.createdAt.toISOString(),
        idleExpiresAt: session.idleExpiresAt.toISOString(),
        absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
      })
      .run();
    return {
      ok: true,
      session: {
        sessionId: session.id,
        csrfToken: session.csrfToken,
        idleExpiresAt: session.idleExpiresAt,
        absoluteExpiresAt: session.absoluteExpiresAt,
      },
      sessionToken: session.sessionToken,
    };
  });
}

export function loginWithRecoveryToken(
  ctx: AuthContext,
  providedToken: string,
): { ok: true; session: SessionInfo; sessionToken: string } | { ok: false; reason: string } {
  if (!ctx.adminTokenEnv || !constantTimeEqual(providedToken, ctx.adminTokenEnv)) {
    return { ok: false, reason: "invalid_token" };
  }

  const now = ctx.clock.now();
  const session = createNewSession(now);
  ctx.db
    .insert(adminSessions)
    .values({
      id: session.id,
      sessionTokenHash: session.sessionTokenHash,
      csrfToken: session.csrfToken,
      createdAt: session.createdAt.toISOString(),
      idleExpiresAt: session.idleExpiresAt.toISOString(),
      absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
    })
    .run();

  return {
    ok: true,
    session: {
      sessionId: session.id,
      csrfToken: session.csrfToken,
      idleExpiresAt: session.idleExpiresAt,
      absoluteExpiresAt: session.absoluteExpiresAt,
    },
    sessionToken: session.sessionToken,
  };
}

export function findValidSession(ctx: AuthContext, sessionToken: string) {
  const hash = hashSessionToken(sessionToken);
  const session = ctx.db.select().from(adminSessions).where(eq(adminSessions.sessionTokenHash, hash)).get();
  if (!session) return undefined;
  const now = ctx.clock.now();
  if (now > new Date(session.idleExpiresAt) || now > new Date(session.absoluteExpiresAt)) return undefined;
  return session;
}

export function touchSessionIdleExpiry(ctx: AuthContext, sessionId: string): void {
  const now = ctx.clock.now();
  const idleExpiresAt = new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString();
  ctx.db.update(adminSessions).set({ idleExpiresAt }).where(eq(adminSessions.id, sessionId)).run();
}

export function deleteSession(ctx: AuthContext, sessionToken: string): void {
  const hash = hashSessionToken(sessionToken);
  ctx.db.delete(adminSessions).where(eq(adminSessions.sessionTokenHash, hash)).run();
}

export type AdminAuthResult =
  | { ok: true; method: "bearer" }
  | { ok: true; method: "session"; sessionId: string }
  | { ok: false; status: 401 | 403; code: string };

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Authenticates a control-plane request: bearer token (no CSRF) or session
 * cookie. CSRF is only required for session mutations (spec 16: "Session
 * mutations require X-CSRF-Token...") -- a safe read-only method (GET/HEAD/
 * OPTIONS) authenticated via session cookie does not need it, matching the
 * standard CSRF threat model (a forged cross-site GET has no side effects
 * to protect against here).
 */
export function authenticateAdminRequest(
  ctx: AuthContext,
  headers: { authorization?: string | undefined; cookie?: string | undefined; "x-csrf-token"?: string | undefined },
  sessionTokenFromCookie: string | undefined,
  method = "GET",
): AdminAuthResult {
  const bearerMatch = /^Bearer\s+(.+)$/.exec(headers.authorization ?? "");
  if (bearerMatch && ctx.adminTokenEnv && constantTimeEqual(bearerMatch[1] as string, ctx.adminTokenEnv)) {
    return { ok: true, method: "bearer" };
  }

  if (!sessionTokenFromCookie) {
    return { ok: false, status: 401, code: "unauthenticated" };
  }
  const session = findValidSession(ctx, sessionTokenFromCookie);
  if (!session) {
    return { ok: false, status: 401, code: "unauthenticated" };
  }
  if (!SAFE_METHODS.has(method.toUpperCase()) && headers["x-csrf-token"] !== session.csrfToken) {
    return { ok: false, status: 403, code: "csrf_failed" };
  }
  return { ok: true, method: "session", sessionId: session.id };
}
