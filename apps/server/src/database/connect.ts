import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

export type AppDatabase = ReturnType<typeof drizzle<typeof schema>>;

export interface OpenDatabaseOptions {
  filePath: string;
  busyTimeoutMs?: number;
}

export interface OpenedDatabase {
  raw: Database.Database;
  db: AppDatabase;
  close: () => void;
  healthCheck: () => boolean;
}

/** Opens SQLite in WAL mode with foreign keys enforced (spec section 18.3). */
export function openDatabase(opts: OpenDatabaseOptions): OpenedDatabase {
  if (opts.filePath !== ":memory:") {
    mkdirSync(dirname(opts.filePath), { recursive: true });
  }

  const raw = new Database(opts.filePath);
  raw.pragma("journal_mode = WAL");
  raw.pragma("foreign_keys = ON");
  raw.pragma(`busy_timeout = ${opts.busyTimeoutMs ?? 5_000}`);

  const db = drizzle(raw, { schema });

  return {
    raw,
    db,
    close: () => raw.close(),
    healthCheck: () => {
      try {
        return raw.prepare("select 1 as ok").get() !== undefined;
      } catch {
        return false;
      }
    },
  };
}
