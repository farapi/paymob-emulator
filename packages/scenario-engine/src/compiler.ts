import { parseDuration } from "@paymob-simulator/contracts";
import { deriveSeed, Xorshift32 } from "./random.js";
import { validateScenarioStructure, type ScenarioDefinition, type TimelineAction } from "./schema.js";

export interface ScenarioRunContext {
  intentionId: string;
  /** Identifies the exact immutable scenario revision this run is pinned to. */
  scenarioRevisionId: string;
  /** Clock time at the atomic checkout submission (section 12.1: "every
   * relative after duration is measured from successful checkout
   * submission, not intention creation"). */
  submittedAt: Date;
}

export interface ResolvedTimelineAction {
  actionId: string;
  action: TimelineAction["action"];
  params: TimelineAction["params"];
  offsetMs: number;
  dueAt: Date;
}

export interface CompiledScenarioRun {
  scenarioId: string;
  seed: number;
  actions: readonly ResolvedTimelineAction[];
}

const SEEDED_DELAY_TOKEN = "seeded";

interface SeededRangeMetadata {
  seededRangeMs?: [number, number];
}

function getSeededRange(def: ScenarioDefinition): [number, number] {
  const meta = def.metadata as SeededRangeMetadata | undefined;
  return meta?.seededRangeMs ?? [1000, 120_000];
}

/**
 * Resolves a scenario definition's authored timeline into concrete
 * (offsetMs, dueAt) pairs for one run, given the run's deterministic seed
 * (spec 12.5). All `after: "seeded"` markers in one run share a single draw
 * so a transition and its webhook fire at the same resolved instant.
 */
export function compileScenario(
  def: ScenarioDefinition,
  ctx: ScenarioRunContext,
): CompiledScenarioRun {
  validateScenarioStructure(def);

  const seed = deriveSeed(ctx.intentionId, ctx.scenarioRevisionId);
  const rng = new Xorshift32(seed);
  const [rangeMin, rangeMax] = getSeededRange(def);
  let seededDelayMs: number | undefined;

  const actions: ResolvedTimelineAction[] = def.timeline.map((step) => {
    let offsetMs: number;
    if (step.after === SEEDED_DELAY_TOKEN) {
      seededDelayMs ??= rng.nextIntInRange(rangeMin, rangeMax);
      offsetMs = seededDelayMs;
    } else {
      offsetMs = parseDuration(step.after);
    }
    return {
      actionId: step.id,
      action: step.action,
      params: step.params,
      offsetMs,
      dueAt: new Date(ctx.submittedAt.getTime() + offsetMs),
    };
  });

  return { scenarioId: def.id, seed, actions };
}
