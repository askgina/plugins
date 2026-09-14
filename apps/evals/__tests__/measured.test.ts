import { describe, expect, test } from "vitest";
import { getMeasuredModel, measuredCampaigns, measuredModels, ompCampaign } from "../src/measured";
import { perpsPredictionsReport, spotComparison } from "../src/results";

describe("measured models", () => {
  test("maps the measured models and their families", () => {
    expect(measuredModels.map((model) => model.id)).toEqual([
      "gpt-5-5",
      "gpt-5-6-sol",
      "muse-spark-1-3",
      "claude-fable-5-1",
      "claude-opus-5",
    ]);
    expect(Object.keys(getMeasuredModel("gpt-5-5")!.families)).toEqual(["Spot"]);
    expect(Object.keys(getMeasuredModel("gpt-5-6-sol")!.families).sort()).toEqual([
      "Perps",
      "Predictions",
      "Spot",
    ]);
    expect(getMeasuredModel("gpt-5-6-sol")!.families.Portfolio).toBeUndefined();
    expect(Object.keys(getMeasuredModel("muse-spark-1-3")!.families).sort()).toEqual([
      "Perps",
      "Predictions",
      "Spot",
    ]);
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
    expect(ompCampaign.prUrl).toBe(perpsPredictionsReport.prUrl);
    expect(ompCampaign.repetitions).toBe(3);
  });

  test("preserves per-bundle source commits and graded sort counts", () => {
    expect(getMeasuredModel("gpt-5-5")!.families.Spot!.sourceCommit).toBe(
      "5f98d54cf0f6514c90116a4c7c1d889cdd7dc485",
    );
    expect(getMeasuredModel("gpt-5-6-sol")!.families.Spot!.sourceCommit).toBe(
      "780dc809e9956a329d9e60c72503de449477699b",
    );
    expect(getMeasuredModel("gpt-5-6-sol")!.families.Predictions!.passRateSortKey).toBeCloseTo(
      (12 / 38) * 100,
    );
  });

  test("maps Muse campaign counts, dimensions, and cases", () => {
    const muse = getMeasuredModel("muse-spark-1-3")!;
    const spot = muse.families.Spot!;
    const perps = muse.families.Perps!;
    const predictions = muse.families.Predictions!;

    expect(spot).toMatchObject({
      passed: 9,
      failed: 0,
      unscoredTimeouts: 3,
      total: 12,
      passRateSortKey: 100,
      dimensions: {
        routing: { passed: 9, failed: 0 },
        arguments: { passed: 9, failed: 0 },
        completion: { passed: 9, failed: 0 },
        safety: { passed: 9, failed: 0 },
      },
    });
    expect(spot.cases).toHaveLength(4);
    expect(perps).toMatchObject({
      passed: 42,
      failed: 12,
      unscoredTimeouts: 0,
      total: 54,
      passRateSortKey: (42 / 54) * 100,
    });
    expect(perps.cases).toHaveLength(18);
    expect(predictions).toMatchObject({
      passed: 10,
      failed: 28,
      unscoredTimeouts: 1,
      total: 39,
      passRateSortKey: (10 / 38) * 100,
      dimensions: { safety: { passed: 35, failed: 3 } },
    });
    expect(predictions.cases).toHaveLength(13);
  });

  test("keeps campaign metadata distinct", () => {
    expect(measuredCampaigns).toHaveLength(3);
    expect(measuredCampaigns.map((campaign) => campaign.id)).toEqual([
      "omp-2026-09-11",
      "muse-2026-09-14",
      "claude-2026-09-14",
    ]);
    expect(getMeasuredModel("gpt-5-5")!.campaign).toBe(getMeasuredModel("gpt-5-6-sol")!.campaign);
    expect(getMeasuredModel("gpt-5-5")!.campaign.id).toBe("omp-2026-09-11");
    expect(getMeasuredModel("muse-spark-1-3")!.campaign.prUrl).toBeUndefined();
    expect(getMeasuredModel("muse-spark-1-3")!.campaign.id).toBe("muse-2026-09-14");
    expect(getMeasuredModel("claude-fable-5-1")!.campaign).toBe(
      getMeasuredModel("claude-opus-5")!.campaign,
    );
  });

  test("maps Claude Fable measured counts and unscored spot trial", () => {
    const fable = getMeasuredModel("claude-fable-5-1")!;
    const spot = fable.families.Spot!;
    const perps = fable.families.Perps!;
    const predictions = fable.families.Predictions!;

    expect(spot).toMatchObject({
      passed: 11,
      failed: 0,
      unscoredTimeouts: 1,
      total: 12,
      passRateSortKey: 100,
    });
    expect(spot.cases).toHaveLength(4);
    expect(
      spot.cases.find((measuredCase) => measuredCase.id === "spot-fetch-swap-history"),
    ).toMatchObject({
      results: ["pass", "pass", "unscored"],
      passed: 2,
      graded: 2,
    });
    expect(perps).toMatchObject({
      passed: 44,
      failed: 10,
      unscoredTimeouts: 0,
      total: 54,
    });
    expect(perps.cases).toHaveLength(18);
    expect(predictions).toMatchObject({
      passed: 9,
      failed: 30,
      unscoredTimeouts: 0,
      total: 39,
      dimensions: { safety: { passed: 0, failed: 2 } },
    });
    expect(predictions.cases).toHaveLength(13);
  });

  test("maps Claude Opus measured counts and graded denominator", () => {
    const opus = getMeasuredModel("claude-opus-5")!;
    const spot = opus.families.Spot!;
    const perps = opus.families.Perps!;
    const predictions = opus.families.Predictions!;

    expect(spot).toMatchObject({
      passed: 12,
      failed: 0,
      unscoredTimeouts: 0,
      total: 12,
      passRateSortKey: 100,
    });
    expect(perps).toMatchObject({
      passed: 41,
      failed: 12,
      unscoredTimeouts: 1,
      total: 54,
      passRateSortKey: (41 / 53) * 100,
    });
    expect(predictions).toMatchObject({
      passed: 9,
      failed: 30,
      unscoredTimeouts: 0,
      total: 39,
      dimensions: { safety: { passed: 0, failed: 1 } },
    });
  });
});
