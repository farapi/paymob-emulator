import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { openDatabase, type OpenedDatabase } from "./connect.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_FOLDER = resolve(HERE, "../../../../migrations");

export function runMigrations(opened: OpenedDatabase): void {
  migrate(opened.db, { migrationsFolder: MIGRATIONS_FOLDER });
}

async function main() {
  const filePath = process.env.SIM_DATA_DIR
    ? resolve(process.env.SIM_DATA_DIR, "simulator.sqlite")
    : resolve(HERE, "../../../../.data/simulator.sqlite");
  const opened = openDatabase({ filePath });
  runMigrations(opened);
  console.log(`[migrate] applied migrations to ${filePath}`);
  opened.close();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
