import type { AppDatabase } from "../database/connect.js";
import { clockState } from "../database/schema.js";
import { ManualClock, RealClock, type Clock } from "./clock.js";
import type { ClockMode } from "@paymob-simulator/contracts";

export function loadOrInitClock(
  db: AppDatabase,
  defaultMode: ClockMode,
  manualStartIso: string | undefined,
  nowIso: () => string,
): Clock {
  const existing = db.select().from(clockState).get();
  if (existing) {
    return existing.mode === "manual"
      ? new ManualClock(existing.manualTimeMs ?? Date.now())
      : new RealClock();
  }

  const startMs = manualStartIso ? new Date(manualStartIso).getTime() : Date.now();
  db
    .insert(clockState)
    .values({ id: 1, mode: defaultMode, manualTimeMs: defaultMode === "manual" ? startMs : null, updatedAt: nowIso() })
    .run();

  return defaultMode === "manual" ? new ManualClock(startMs) : new RealClock();
}
