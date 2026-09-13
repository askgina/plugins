import { describe, expect, test } from "vitest";
import { getMeasuredModel, measuredModels, measuredRun } from "../src/measured";
import { perpsPredictionsReport, spotComparison } from "../src/results";

describe("measured models", () => {
  test("maps the two measured models and their families", () => {
    expect(measuredModels.map((model) => model.id)).toEqual(["gpt-5-5", "gpt-5-6-sol"]);
    expect(Object.keys(getMeasuredModel("gpt-5-5")!.families)).toEqual(["Spot"]);
    expect(Object.keys(getMeasuredModel("gpt-5-6-sol")!.families).sort()).toEqual([
      "Perps",
      "Predictions",
      "Spot",
    ]);
    expect(getMeasuredModel("gpt-5-6-sol")!.families.Portfolio).toBeUndefined();
  });

  test("perps and predictions counts are the exported counts", () => {
    const sol = getMeasuredModel("gpt-5-6-sol")!;
    const perps = perpsPredictionsReport.runs.find((run) => run.family === "perps")!;
    expect(sol.families.Perps).toMatchObject({
      runId: perps.runId,
      passed: perps.passed,
      failed: perps.failed,
      unscoredTimeouts: perps.unscoredTimeouts,
      total: perps.dispatched,
    });
    expect(sol.families.Perps!.cases).toHaveLength(perps.cases.length);
    for (const run of perpsPredictionsReport.runs) {
      expect(run.passed + run.failed + run.unscoredTimeouts).toBe(run.dispatched);
    }
  });

  test("spot cases carry three attempts per model with prompts", () => {
    for (const model of measuredModels) {
      const spot = model.families.Spot!;
      expect(spot.total).toBe(12);
      expect(spot.cases).toHaveLength(4);
      for (const measuredCase of spot.cases) {
        expect(measuredCase.attempts).toHaveLength(3);
        expect(measuredCase.prompt).toBe(
          spotComparison.casePrompts[measuredCase.id as keyof typeof spotComparison.casePrompts],
        );
      }
    }
  });

  test("run metadata is passed through", () => {
    expect(measuredRun.prUrl).toBe(perpsPredictionsReport.prUrl);
    expect(measuredRun.repetitions).toBe(3);
  });
});
