import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "../database/connect.js";
import { credentialVersions } from "../database/schema.js";
import { constantTimeEqual } from "../security/admin-auth.js";

export type CredentialKind = "secret_key" | "public_key" | "api_key" | "hmac_secret";

export interface ActiveCredential {
  value: string;
  version: number;
}

/** Seeds version 1 of every credential kind from config if none is active yet. */
export function ensureCredentialsSeeded(
  db: AppDatabase,
  values: Record<CredentialKind, string>,
  nowIso: string,
): void {
  for (const kind of Object.keys(values) as CredentialKind[]) {
    const existing = db
      .select()
      .from(credentialVersions)
      .where(and(eq(credentialVersions.kind, kind), eq(credentialVersions.active, true)))
      .get();
    if (!existing) {
      db.insert(credentialVersions)
        .values({ kind, version: 1, value: values[kind], active: true, createdAt: nowIso })
        .run();
    }
  }
}

export function getActiveCredential(db: AppDatabase, kind: CredentialKind): ActiveCredential {
  const row = db
    .select()
    .from(credentialVersions)
    .where(and(eq(credentialVersions.kind, kind), eq(credentialVersions.active, true)))
    .get();
  if (!row) throw new Error(`no active credential for kind "${kind}"`);
  return { value: row.value, version: row.version };
}

export function getCredentialByVersion(
  db: AppDatabase,
  kind: CredentialKind,
  version: number,
): string | undefined {
  const row = db
    .select()
    .from(credentialVersions)
    .where(and(eq(credentialVersions.kind, kind), eq(credentialVersions.version, version)))
    .get();
  return row?.value;
}

/** Deactivates the current active credential and activates a new version (spec 16.1: rotation). */
export function rotateCredential(
  db: AppDatabase,
  kind: CredentialKind,
  newValue: string,
  nowIso: string,
): number {
  return db.transaction((tx) => {
    const current = tx
      .select()
      .from(credentialVersions)
      .where(and(eq(credentialVersions.kind, kind), eq(credentialVersions.active, true)))
      .get();
    const nextVersion = (current?.version ?? 0) + 1;
    if (current) {
      tx.update(credentialVersions).set({ active: false }).where(eq(credentialVersions.id, current.id)).run();
    }
    tx.insert(credentialVersions)
      .values({ kind, version: nextVersion, value: newValue, active: true, createdAt: nowIso })
      .run();
    return nextVersion;
  });
}

/** Only the currently active secret/API key authenticates new provider requests (spec 16.1). */
export function verifyActiveCredential(db: AppDatabase, kind: CredentialKind, provided: string): boolean {
  try {
    const active = getActiveCredential(db, kind);
    return constantTimeEqual(active.value, provided);
  } catch {
    return false;
  }
}

const REALISTIC_LIVE_KEY_PATTERN = /^(sk|pk|api)_live_/;

export function isDisallowedLiveCredential(value: string): boolean {
  return REALISTIC_LIVE_KEY_PATTERN.test(value);
}
