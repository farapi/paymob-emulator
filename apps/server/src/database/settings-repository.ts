import type { AppDatabase } from "./connect.js";
import { settings } from "./schema.js";
import type { DatabaseSettingsRow } from "../config/loader.js";

/** Reads all dashboard-saved settings rows for the config loader (section 8.1 tier 4). */
export function readSettingsRows(db: AppDatabase): DatabaseSettingsRow[] {
  const rows = db.select().from(settings).all();
  return rows.map((row) => ({ path: row.key, value: row.value }));
}

export function writeSettingRow(db: AppDatabase, path: string, value: unknown, nowIso: string): void {
  db
    .insert(settings)
    .values({ key: path, value, updatedAt: nowIso })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: nowIso } })
    .run();
}
