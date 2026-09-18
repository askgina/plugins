import { describe, expect, test } from "vitest";
import { canonicalRuns } from "../src/canonical/canonical";
import {
  configurationLeaderboardRows,
  derivedCostPerTask,
  unifiedLeaderboardRows,
} from "../src/canonical/selectors";
import { publishedNativeCosts, recordedSweepCost } from "../src/lib/recorded-costs";
import projection from "../src/results/2026-09-16/reasoning-sweep/native-cost-estimates.json";

describe("retained native cost estimates", () => {
  test("every displayed model has a cost while partial-suite coverage remains explicit", () => {
    const rows = unifiedLeaderboardRows();
    expect(rows).toHaveLength(10);
    expect(rows.every((row) => row.estimatedCost.availability === "available")).toBe(true);
    const partial = rows.find((row) => row.model.id === "gpt-5.5")!;
    expect(partial.overall).toBeNull();
    expect(partial.coverageLabel).toBe("Spot only");
    expect(partial.estimatedCost).toMatchObject({ availability: "available", sampleCount: 12 });
  });
  test("prices every configuration from the recorded completed population", () => {
    const rows = configurationLeaderboardRows().filter(
      (row) => row.campaignId === "reasoning-sweep-2026-09-16",
    );
    const available = rows.filter((row) => row.estimatedCost.availability === "available");
    expect(available).toHaveLength(35);
    expect(
      available.reduce(
        (sum, row) =>
          sum +
          (row.estimatedCost.availability === "available" ? row.estimatedCost.sampleCount : 0),
        0,
      ),
    ).toBe(2930);
    for (const row of available) {
      const runs = Object.values(row.runs);
      const estimate = row.estimatedCost;
      if (estimate.availability !== "available") throw new Error("Expected cost estimate");
      expect(estimate.sampleCount).toBe(runs.reduce((sum, run) => sum + run.counts.completed, 0));
      expect(estimate.excluded).toBe(105 - estimate.sampleCount);
      const totals = runs.map((run) => run.recordedCostEstimate);
      const usdTotal = totals.reduce(
        (sum, cost) => sum + (cost?.availability === "available" ? cost.usdTotal : 0),
        0,
      );
      expect(estimate.value).toBeCloseTo(usdTotal / estimate.sampleCount, 10);
    }
    expect(rows.filter((row) => row.estimatedCost.availability === "unavailable")).toHaveLength(0);
  });

  test("does not turn an empty category into a free task or hide retained costs", () => {
    const run = canonicalRuns.find((entry) => entry.runId === "astra-max-predictions-1")!;
    expect(run.counts.completed).toBe(0);
    expect(derivedCostPerTask(run).availability).not.toBe("available");
    const row = configurationLeaderboardRows().find(
      (entry) => entry.runs.Predictions?.runId === run.runId,
    )!;
    expect(row.estimatedCost).toMatchObject({
      availability: "available",
      sampleCount: 32,
      excluded: 73,
    });
  });

  test("refuses stale source bindings and never falls back to a legacy price", () => {
    const entry = {
      rowId: "test-low",
      family: "spot",
      model: "test/model",
      target: "omp_harness",
      method: "recorded_client_estimate",
      rateSource: "omp_native_usage",
      rateSourceSha256: null,
      priceAsOf: "2026-09-16",
      rateCard: null,
      sourceSummarySha256: "a".repeat(64),
      sourceEvidenceSha256: "b".repeat(64),
      sampleCount: 3,
      population: "completed",
      recordedAt: "2026-09-16",
      usdTotal: 0.75,
      inputTokens: 30,
      outputTokens: 15,
      cacheReadTokens: 200,
      cacheWriteTokens: 100,
    };
    const row = { ...entry, target: "omp_harness" };
    const run = { family: entry.family, graded: entry.sampleCount };
    expect(recordedSweepCost(row, run, [entry]).availability).toBe("available");
    for (const changed of [
      { ...row, sourceSummarySha256: "0".repeat(64) },
      { ...row, model: "other/model" },
      { ...row, rowId: "missing-row" },
      { ...row, target: "devin_cli" },
    ]) {
      expect(recordedSweepCost(changed, run, [entry]).availability).toBe("not_recorded");
    }
    expect(recordedSweepCost(row, { ...run, graded: run.graded + 1 }, [entry]).availability).toBe(
      "not_recorded",
    );
  });

  test("contains only reviewed numeric aggregates and public provenance", () => {
    expect(Object.keys(projection).sort()).toEqual([
      "billingReceipt",
      "includesCache",
      "runs",
      "schemaVersion",
      "source",
    ]);
    expect(projection.billingReceipt).toBe(false);
    expect(projection.includesCache).toBe(true);
    expect(publishedNativeCosts).toHaveLength(105);
    for (const entry of publishedNativeCosts) {
      expect(Object.keys(entry).sort()).toEqual([
        "cacheReadTokens",
        "cacheWriteTokens",
        "family",
        "inputTokens",
        "method",
        "model",
        "outputTokens",
        "population",
        "priceAsOf",
        "rateCard",
        "rateSource",
        "rateSourceSha256",
        "recordedAt",
        "rowId",
        "sampleCount",
        "sourceEvidenceSha256",
        "sourceSummarySha256",
        "target",
        "usdTotal",
      ]);
      expect(entry.sourceEvidenceSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(entry.sourceSummarySha256).toMatch(/^[a-f0-9]{64}$/);
      expect(entry.population).toBe("completed");
      expect(entry.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      for (const value of [
        entry.inputTokens,
        entry.outputTokens,
        entry.cacheReadTokens,
        entry.cacheWriteTokens,
        entry.usdTotal,
        entry.sampleCount,
      ]) {
        expect(Number.isFinite(value) && value >= 0).toBe(true);
      }
    }
  });

  test("permits a zero-dollar estimate only for the documented free tier", () => {
    const entry = publishedNativeCosts.find((record) => record.method === "catalogue_free_tier")!;
    const run = { family: entry.family, graded: entry.sampleCount };
    expect(recordedSweepCost(entry, run, [entry])).toMatchObject({
      availability: "available",
      basis: "catalogue_free_tier",
      usdTotal: 0,
    });
    expect(
      recordedSweepCost(entry, run, [{ ...entry, method: "recorded_client_estimate" }])
        .availability,
    ).toBe("not_recorded");
    expect(recordedSweepCost(entry, run, [{ ...entry, rateSourceSha256: null }]).availability).toBe(
      "not_recorded",
    );
  });
});
