import { describe, expect, test } from "vitest";
import {
  canonicalCampaigns,
  canonicalModels,
  canonicalRuns,
  MODEL_PRICING,
} from "../src/canonical/canonical";
import {
  cohortLabel,
  derivedCostPerTask,
  headlineFor,
  runsForFamily,
  runsForModel,
} from "../src/canonical/selectors";
import { perpsPredictionsReport } from "../src/results";

describe("canonical models and runs", () => {
  test("maps the measured canonical models and their families", () => {
    const measuredModels = canonicalModels.filter((m) => m.origin === "measured");
    expect(measuredModels.map((model) => model.id)).toEqual([
      "gpt-5.5",
      "gpt-sol",
      "muse-spark",
      "claude-fable",
      "claude-opus",
    ]);

    expect(runsForModel("gpt-5.5").map((r) => r.family)).toEqual(["Spot"]);
    expect(
      [
        ...new Set(
          runsForModel("gpt-sol")
            .filter((r) => r.origin === "measured")
            .map((r) => r.family),
        ),
      ].sort(),
    ).toEqual(["Perps", "Predictions", "Spot"]);
    expect(
      runsForModel("muse-spark")
        .map((r) => r.family)
        .sort(),
    ).toEqual(["Perps", "Predictions", "Spot"]);
    expect(
      runsForModel("claude-fable")
        .map((r) => r.family)
        .sort(),
    ).toEqual(["Perps", "Predictions", "Spot"]);
    expect(
      runsForModel("claude-opus")
        .map((r) => r.family)
        .sort(),
    ).toEqual(["Perps", "Predictions", "Spot"]);
  });

  test("perps and predictions counts match exported counts", () => {
    const solPerps = runsForModel("gpt-sol").find((r) => r.family === "Perps")!;
    const perpsReport = perpsPredictionsReport.runs.find((run) => run.family === "perps")!;
    expect(solPerps.counts).toMatchObject({
      planned: perpsReport.dispatched,
      started: perpsReport.dispatched,
      passed: perpsReport.passed,
      failed: perpsReport.failed,
      timedOut: perpsReport.unscoredTimeouts,
    });

    for (const run of perpsPredictionsReport.runs) {
      expect(run.passed + run.failed + run.unscoredTimeouts).toBe(run.dispatched);
    }
  });

  test("spot measured runs carry 12 attempts across 4 cases", () => {
    const spotRuns = runsForFamily("Spot").filter((r) => r.origin === "measured");
    expect(spotRuns).toHaveLength(5);
    for (const run of spotRuns) {
      expect(run.counts.planned).toBe(12);
      expect(run.counts.started).toBe(12);
    }
  });

  test("campaign metadata is distinct and retained", () => {
    const measuredCampaigns = canonicalCampaigns.filter((c) => c.campaignId !== "synthetic-demo");
    expect(measuredCampaigns).toHaveLength(3);
    expect(measuredCampaigns.map((c) => c.campaignId)).toEqual([
      "omp-2026-09-11",
      "muse-2026-09-14",
      "claude-2026-09-14",
    ]);

    const omp = canonicalCampaigns.find((c) => c.campaignId === "omp-2026-09-11")!;
    expect(omp.prUrl).toBe(perpsPredictionsReport.prUrl);
    expect(omp.repetitions).toBe(3);
  });

  test("derived cost calculates per task with price metadata", () => {
    const solSpot = canonicalRuns.find((r) => r.runId === "sol-spot-1")!;
    const cost = derivedCostPerTask(solSpot);
    expect(cost.availability).toBe("available");
    if (cost.availability === "available") {
      expect(cost.usdPerTask).toBeGreaterThan(0);
      expect(cost.priceSource).toBe("openrouter");
      expect(cost.population).toBe("completed");
    }

    expect(MODEL_PRICING["gpt-5.5"]).toBeDefined();
    expect(MODEL_PRICING["claude-opus"]).toBeDefined();
  });

  test("cohort labels format family, target, and repetition details", () => {
    const solSpot = canonicalRuns.find((r) => r.runId === "sol-spot-1")!;
    const label = cohortLabel(solSpot.cohort);
    expect(label).toContain("Spot");
    expect(label).toContain("omp_harness");
    expect(label).toContain("3 reps");
  });

  test("headline calculates rates correctly", () => {
    const solSpot = canonicalRuns.find((r) => r.runId === "sol-spot-1")!;
    const headline = headlineFor(solSpot);
    expect(headline.kind).toBe("rate");
    if (headline.kind === "rate") {
      expect(headline.started).toBe(12);
    }
  });
});
