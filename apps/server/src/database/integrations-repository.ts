import { eq } from "drizzle-orm";
import type { AppDatabase } from "./connect.js";
import { integrations } from "./schema.js";
import type { IntegrationConfig } from "../config/schema.js";

export type IntegrationRow = typeof integrations.$inferSelect;

/** Upserts the configured integrations into the database on every boot. */
export function syncIntegrations(
  db: AppDatabase,
  configured: readonly IntegrationConfig[],
  legacyEnabled: boolean,
  nowIso: string,
): void {
  for (const integration of configured) {
    const existing = db.select().from(integrations).where(eq(integrations.id, integration.id)).get();
    const values = {
      id: integration.id,
      iframeId: integration.iframeId ?? null,
      name: integration.name,
      paymentMethod: integration.paymentMethod,
      sourceSubtype: integration.sourceSubtype,
      iframeCompletionMode: integration.iframeCompletionMode,
      notificationUrl: integration.notificationUrl ?? null,
      redirectionUrl: integration.redirectionUrl ?? null,
      legacyEnabled,
      updatedAt: nowIso,
    };
    if (existing) {
      db.update(integrations).set(values).where(eq(integrations.id, integration.id)).run();
    } else {
      db.insert(integrations)
        .values({ ...values, createdAt: nowIso })
        .run();
    }
  }
}

export function getIntegration(db: AppDatabase, id: number): IntegrationRow | undefined {
  return db.select().from(integrations).where(eq(integrations.id, id)).get();
}

export function listIntegrations(db: AppDatabase): IntegrationRow[] {
  return db.select().from(integrations).all();
}

export function getConfiguredIntegrationIds(db: AppDatabase): Set<number> {
  return new Set(listIntegrations(db).map((i) => i.id));
}
