import { describe, expect, it } from "vitest";
import { findBuiltInScenario } from "./builtins.js";
import { compileScenario } from "./compiler.js";

describe("compileScenario", () => {
  it("resolves fixed offsets relative to checkout submission", () => {
    const def = findBuiltInScenario("success-immediate")!;
    const submittedAt = new Date("2026-08-14T12:00:00.000Z");
    const run = compileScenario(def, {
      intentionId: "pi_sim_1",
      scenarioRevisionId: "success-immediate@1",
      submittedAt,
    });

    const transition = run.actions.find((a) => a.actionId === "transition")!;
    const redirect = run.actions.find((a) => a.actionId === "redirect")!;
    expect(transition.offsetMs).toBe(0);
    expect(transition.dueAt.getTime()).toBe(submittedAt.getTime());
    expect(redirect.offsetMs).toBe(100);
    expect(redirect.dueAt.getTime()).toBe(submittedAt.getTime() + 100);
  });

  it("resolves the 2-minute delayed-success timeline", () => {
    const def = findBuiltInScenario("success-delayed-2m")!;
    const submittedAt = new Date("2026-08-14T12:00:00.000Z");
    const run = compileScenario(def, {
      intentionId: "pi_sim_2",
      scenarioRevisionId: "success-delayed-2m@1",
      submittedAt,
    });
    const successTransition = run.actions.find((a) => a.actionId === "success-transition")!;
    expect(successTransition.offsetMs).toBe(120_000);
  });

  it("applies one shared seeded delay to every 'seeded' action in a run", () => {
    const def = findBuiltInScenario("random-delay-success")!;
    const submittedAt = new Date("2026-08-14T12:00:00.000Z");
    const run = compileScenario(def, {
      intentionId: "pi_sim_3",
      scenarioRevisionId: "random-delay-success@1",
      submittedAt,
    });
    const transition = run.actions.find((a) => a.actionId === "success-transition")!;
    const webhook = run.actions.find((a) => a.actionId === "success-webhook")!;
    expect(transition.offsetMs).toBe(webhook.offsetMs);
    expect(transition.offsetMs).toBeGreaterThanOrEqual(1000);
    expect(transition.offsetMs).toBeLessThanOrEqual(120_000);
  });

  it("is fully deterministic for the same intention id and revision", () => {
    const def = findBuiltInScenario("random-delay-success")!;
    const submittedAt = new Date("2026-08-14T12:00:00.000Z");
    const ctx = {
      intentionId: "pi_sim_4",
      scenarioRevisionId: "random-delay-success@1",
      submittedAt,
    };
    const runA = compileScenario(def, ctx);
    const runB = compileScenario(def, ctx);
    expect(runA.actions.map((a) => a.offsetMs)).toEqual(runB.actions.map((a) => a.offsetMs));
    expect(runA.seed).toBe(runB.seed);
  });
});
