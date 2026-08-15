import { describe, expect, it } from "vitest";
import { BUILT_IN_SCENARIOS } from "./builtins.js";
import { scenarioDefinitionSchema, validateScenarioStructure } from "./schema.js";

describe("built-in scenarios", () => {
  it("has 16 authored scenarios (generic-selector has no timeline of its own)", () => {
    expect(BUILT_IN_SCENARIOS).toHaveLength(16);
  });

  it("has unique ids", () => {
    const ids = BUILT_IN_SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every built-in parses against the scenario schema", () => {
    for (const def of BUILT_IN_SCENARIOS) {
      expect(() => scenarioDefinitionSchema.parse(def)).not.toThrow();
    }
  });

  it("every built-in passes structural validation", () => {
    for (const def of BUILT_IN_SCENARIOS) {
      expect(() => validateScenarioStructure(def)).not.toThrow();
    }
  });
});
