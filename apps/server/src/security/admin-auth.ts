import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import argon2 from "argon2";

// Admin authentication primitives (spec sections 8.4, 16, 20.1). The
// bootstrap/recovery token is a manually-typed, infrequently-checked secret,
// so it is hashed with Argon2id. Session/CSRF tokens are high-entropy random
// values checked on every admin request, so they use a fast SHA-256 hash
// instead -- Argon2id there would be needless CPU cost with no security
// benefit for an already-unguessable random token.

export function generateRandomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export async function hashSecretToken(token: string): Promise<string> {
  return argon2.hash(token, { type: argon2.argon2id });
}

export async function verifySecretToken(token: string, hash: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, token);
  } catch {
    return false;
  }
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 24 * 60 * 60 * 1000;

export interface NewSession {
  id: string;
  sessionToken: string;
  sessionTokenHash: string;
  csrfToken: string;
  createdAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
}

export function createNewSession(now: Date): NewSession {
  const sessionToken = generateRandomToken(32);
  return {
    id: generateRandomToken(16),
    sessionToken,
    sessionTokenHash: hashSessionToken(sessionToken),
    csrfToken: generateRandomToken(32),
    createdAt: now,
    idleExpiresAt: new Date(now.getTime() + SESSION_IDLE_MS),
    absoluteExpiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_MS),
  };
}
