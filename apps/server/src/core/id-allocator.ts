import type Database from "better-sqlite3";

// Monotonic numeric id allocation from configured fixture bases (spec
// section 14.2: transaction/order/owner/integration/token ids allocated
// monotonically from 900001, 700001, 500001, 1001, 800001).

export const ID_COUNTER_BASES = {
  transaction: 900_001,
  order: 700_001,
  owner_profile: 500_001,
  integration: 1_001,
  card_token: 800_001,
} as const;

export type IdCounterKey = keyof typeof ID_COUNTER_BASES;

/**
 * `profile_id`/`owner` identify the simulator's single merchant profile, not
 * a per-transaction counter -- the golden fixture (spec 14.2) uses the same
 * value (500001) for both across every transaction. Only one merchant
 * profile exists per simulator instance, so this is a fixed constant rather
 * than an allocateId() call.
 */
export const SIMULATOR_PROFILE_ID = ID_COUNTER_BASES.owner_profile;

export function ensureIdCounters(raw: Database.Database): void {
  const insert = raw.prepare(
    "insert into id_counters (key, next_value) values (?, ?) on conflict(key) do nothing",
  );
  for (const [key, base] of Object.entries(ID_COUNTER_BASES)) {
    insert.run(key, base);
  }
}

/** Atomically allocates and returns the next id for the given counter. */
export function allocateId(raw: Database.Database, key: IdCounterKey): number {
  const row = raw
    .prepare(
      "update id_counters set next_value = next_value + 1 where key = ? returning next_value - 1 as allocated",
    )
    .get(key) as { allocated: number } | undefined;
  if (!row) {
    throw new Error(`unknown id counter key "${key}"`);
  }
  return row.allocated;
}
