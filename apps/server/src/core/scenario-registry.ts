import { eq } from "drizzle-orm";
import { BUILT_IN_SCENARIOS, type ScenarioDefinition } from "@paymob-simulator/scenario-engine";
import type { AppDatabase } from "../database/connect.js";
import { scenarioDefinitions } from "../database/schema.js";

/** Loads the built-in scenario catalog into scenario_definitions on every boot (spec 12.6). */
export function syncBuiltInScenarios(db: AppDatabase, nowIso: string): void {
  for (const def of BUILT_IN_SCENARIOS) {
    const existing = db.select().from(scenarioDefinitions).where(eq(scenarioDefinitions.id, def.id)).get();
    if (existing && existing.source === "builtin") {
      db.update(scenarioDefinitions)
        .set({ definitionJson: def, displayName: def.displayName, classification: def.classification, updatedAt: nowIso })
        .where(eq(scenarioDefinitions.id, def.id))
        .run();
      continue;
    }
    if (!existing) {
      db.insert(scenarioDefinitions)
        .values({
          id: def.id,
          source: "builtin",
          displayName: def.displayName,
          classification: def.classification,
          definitionJson: def,
          writable: false,
          createdAt: nowIso,
          updatedAt: nowIso,
        })
        .run();
    }
  }
}

export function getScenarioDefinition(db: AppDatabase, id: string): ScenarioDefinition | undefined {
  const row = db.select().from(scenarioDefinitions).where(eq(scenarioDefinitions.id, id)).get();
  return row?.definitionJson as ScenarioDefinition | undefined;
}

export interface ScenarioSummary {
  id: string;
  source: string;
  displayName: string;
  classification: string;
  writable: boolean;
}

export function listScenarios(db: AppDatabase): ScenarioSummary[] {
  return db
    .select({
      id: scenarioDefinitions.id,
      source: scenarioDefinitions.source,
      displayName: scenarioDefinitions.displayName,
      classification: scenarioDefinitions.classification,
      writable: scenarioDefinitions.writable,
    })
    .from(scenarioDefinitions)
    .all();
}
