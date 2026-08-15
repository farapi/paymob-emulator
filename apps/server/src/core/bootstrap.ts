import { eq } from "drizzle-orm";
import type { AppDatabase } from "../database/connect.js";
import { bootstrapTokens } from "../database/schema.js";
import { generateRandomToken, hashSecretToken } from "../security/admin-auth.js";

/**
 * First-run bootstrap token (spec 8.4): generated once, only its Argon2id
 * hash is persisted, and the plaintext is returned so the caller can print
 * it to the terminal exactly once. Returns undefined if a bootstrap token
 * row already exists (already generated on an earlier boot).
 */
export async function ensureBootstrapToken(db: AppDatabase, nowIso: string): Promise<string | undefined> {
  const existing = db.select().from(bootstrapTokens).where(eq(bootstrapTokens.id, 1)).get();
  if (existing) return undefined;

  const token = generateRandomToken(32);
  const hash = await hashSecretToken(token);
  db.insert(bootstrapTokens).values({ id: 1, tokenHash: hash, consumed: false, createdAt: nowIso }).run();
  return token;
}
