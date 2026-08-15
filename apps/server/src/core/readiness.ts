import { eq } from "drizzle-orm";
import type { AppDatabase } from "../database/connect.js";
import { bootstrapTokens } from "../database/schema.js";
import type { ReadinessState } from "../app.js";

export interface ReadinessInputs {
  db: AppDatabase;
  adminTokenConfiguredViaEnv: boolean;
  scenarioRegistryValid: boolean;
  scenarioRegistryError?: string;
}

/**
 * Setup is complete once admin authentication is established -- either a
 * bootstrap token has been consumed through the setup wizard, or the
 * instance was configured headlessly via SIM_ADMIN_TOKEN (spec 8.4). Invalid
 * mounted scenario YAML also holds /readyz at 503 (8.4).
 */
export function computeReadiness(inputs: ReadinessInputs): ReadinessState {
  if (!inputs.scenarioRegistryValid) {
    return { ready: false, reason: inputs.scenarioRegistryError ?? "invalid_scenario_registry" };
  }

  if (inputs.adminTokenConfiguredViaEnv) {
    return { ready: true };
  }

  const consumed = inputs.db
    .select()
    .from(bootstrapTokens)
    .where(eq(bootstrapTokens.consumed, true))
    .get();

  if (!consumed) {
    return { ready: false, reason: "setup_required" };
  }

  return { ready: true };
}
