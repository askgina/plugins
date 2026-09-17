import { describe, expect, test } from "vitest";
import {
  canonicalPublications,
  canonicalRuns,
  type CanonicalRun,
} from "../src/canonical/canonical";
import {
  benchmarkSummary,
  compareEligibility,
  measuredRepresentativeRuns,
  sortLeaderboardRows,
  summarizeTask,
  unifiedLeaderboardRows,
} from "../src/canonical/selectors";

const measured = canonicalRuns.filter((run) => run.origin === "measured");
const run = (id: string) => measured.find((entry) => entry.runId === id)!;
const replace = (id: string, patch: Partial<CanonicalRun>) =>
  measured.map((entry) => (entry.runId === id ? { ...entry, ...patch } : entry));

describe("unified leaderboard", () => {
  test("uses equal category weighting and keeps every measured model together", () => {
    const rows = sortLeaderboardRows(unifiedLeaderboardRows());
    expect(rows.map((row) => row.model.id)).toEqual([
      "gpt-sol",
      "claude-opus",
      "claude-fable",
      "muse-spark",
      "gpt-5.5",
    ]);
    expect(
      rows.map((row) => (row.overall === null ? null : (row.overall * 100).toFixed(1))),
    ).toEqual(["67.4", "66.3", "65.4", "59.5", null]);
    expect(rows[0]!.overall).toBeCloseTo((11 / 12 + 43 / 54 + 12 / 39) / 3, 12);
    expect(rows[4]!.coverageLabel).toBe("Spot only");
    expect(rows[4]!.averageTime.availability).toBe("unavailable");
    expect(rows[4]!.estimatedCost.availability).toBe("unavailable");
    expect(benchmarkSummary(rows)).toContain("35 tasks · 3 attempts per task");
    expect(benchmarkSummary(rows)).toContain("2026");
  });
  test("keeps timeouts and runtime failures in score denominators", () => {
    const rows = unifiedLeaderboardRows();
    expect(rows.find((row) => row.model.id === "muse-spark")!.scores.Spot).toBe(9 / 12);
    expect(rows.find((row) => row.model.id === "claude-opus")!.scores.Perps).toBe(41 / 54);
  });
  test("pools actual timings and token costs with their sample counts", () => {
    const rows = sortLeaderboardRows(unifiedLeaderboardRows());
    expect(rows[0]!.averageTime.availability).toBe("unavailable");
    const expected = [
      [1, 29833.31731, 104, 0.08723927884615384],
      [2, 31448.24038, 104, 0.017512096153846156],
      [3, 34846.56436, 101, 0.29261716831683166],
    ];
    for (const [index, time, samples, cost] of expected) {
      const row = rows[index!]!;
      expect(row.averageTime).toMatchObject({
        availability: "available",
        sampleCount: samples,
        excluded: 105 - samples!,
      });
      if (row.averageTime.availability === "available")
        expect(row.averageTime.value).toBeCloseTo(time!, 4);
      expect(row.estimatedCost).toMatchObject({ availability: "available", sampleCount: samples });
      if (row.estimatedCost.availability === "available")
        expect(row.estimatedCost.value).toBeCloseTo(cost!, 12);
    }
  });
  test("missing timings, token sample counts, or incompatible populations prevent pooling", () => {
    const muse = run("muse-spot-1");
    const withoutTimings = unifiedLeaderboardRows(
      replace(muse.runId, { attempts: { availability: "not_retained" } }),
    );
    expect(
      withoutTimings.find((row) => row.model.id === "muse-spark")!.averageTime.availability,
    ).toBe("unavailable");
    const tokens = muse.metrics.tokenUsage;
    if (tokens.availability !== "available") throw new Error("Expected tokens");
    const unknownSamples = unifiedLeaderboardRows(
      replace(muse.runId, {
        metrics: { ...muse.metrics, tokenUsage: { ...tokens, availability: "aggregate_only" } },
      }),
    );
    expect(
      unknownSamples.find((row) => row.model.id === "muse-spark")!.estimatedCost.availability,
    ).toBe("unavailable");
    const mixed = unifiedLeaderboardRows(
      replace(muse.runId, {
        metrics: { ...muse.metrics, tokenUsage: { ...tokens, population: "started" } },
      }),
    );
    expect(mixed.find((row) => row.model.id === "muse-spark")!.estimatedCost.availability).toBe(
      "unavailable",
    );
  });
  test("incomplete or unknown coverage does not produce category or overall scores", () => {
    for (const dispatchCoverage of ["incomplete", "unknown"] as const) {
      const sol = unifiedLeaderboardRows(replace("sol-perps-1", { dispatchCoverage })).find(
        (row) => row.model.id === "gpt-sol",
      )!;
      expect(sol.scores.Perps).toBeNull();
      expect(sol.overall).toBeNull();
      expect(sol.scores.Spot).toBe(11 / 12);
    }
  });
  test("does not pool incompatible benchmark settings or relax pairwise comparison", () => {
    const sol = run("sol-perps-1");
    const rows = unifiedLeaderboardRows(
      replace(sol.runId, { cohort: { ...sol.cohort, fixtureVersion: 99 } }),
    );
    expect(rows.find((row) => row.model.id === "gpt-sol")!.overall).toBeNull();
    expect(compareEligibility(run("sol-spot-1"), run("muse-spot-1")).eligible).toBe(false);
  });
  test("filters synthetic and withdrawn runs before choosing representatives, and deduplicates baselines", () => {
    const selected = measuredRepresentativeRuns();
    expect(selected).toHaveLength(13);
    expect(selected.every((entry) => entry.origin === "measured")).toBe(true);
    expect(selected.filter((entry) => entry.modelId === "gpt-sol")).toHaveLength(3);
    const withdrawn = canonicalPublications.map((p) =>
      p.runId === "sol-perps-1" ? { ...p, status: "withdrawn" as const } : p,
    );
    expect(
      measuredRepresentativeRuns(canonicalRuns, withdrawn).some(
        (entry) => entry.runId === "sol-perps-1",
      ),
    ).toBe(false);
    expect(
      unifiedLeaderboardRows(canonicalRuns, withdrawn).find((row) => row.model.id === "gpt-sol")!
        .overall,
    ).toBeNull();
  });
  test("picks the latest complete measured result, never the highest scoring result", () => {
    const original = run("sol-spot-1");
    const latest = {
      ...original,
      runId: "sol-new",
      startedAt: "2026-09-15T12:00:00Z",
      counts: { ...original.counts, passed: 0 },
    };
    const publication = {
      ...canonicalPublications.find((p) => p.runId === original.runId)!,
      runId: latest.runId,
    };
    const selected = measuredRepresentativeRuns(
      [...canonicalRuns, latest],
      [...canonicalPublications, publication],
    );
    expect(
      selected.find((entry) => entry.modelId === original.modelId && entry.family === "Spot")!
        .runId,
    ).toBe(latest.runId);
  });
  test("sorts full precision, with missing values last in both directions and names breaking ties", () => {
    const rows = unifiedLeaderboardRows();
    for (const direction of ["asc", "desc"] as const)
      expect(sortLeaderboardRows(rows, "overall", direction).at(-1)!.model.id).toBe("gpt-5.5");
    const a = { ...rows[0]!, overall: 0.50001 };
    const b = { ...rows[1]!, overall: 0.50002 };
    expect(sortLeaderboardRows([a, b])[0]).toBe(b);
    const tie = { ...b, overall: a.overall };
    expect(sortLeaderboardRows([tie, a]).map((row) => row.model.name)).toEqual(
      [a.model.name, tie.model.name].sort(),
    );
  });
});

describe("task summaries", () => {
  test("keeps timeouts visible while counting only passes in the numerator", () => {
    const result = summarizeTask(run("sol-predictions-1"), "predictions-multi-series-no-render");
    expect(result.status).toBe("available");
    expect(result.started).toBe(3);
    expect(result.slots[1]!.execution).toBe("timed_out");
  });
  test("missing run, missing evidence, and missing repetition are distinct from zero passes", () => {
    expect(summarizeTask(undefined, "spot-simple-price").status).toBe("not_evaluated");
    const original = run("sol-spot-1");
    expect(
      summarizeTask(
        { ...original, attempts: { availability: "withheld", reason: "privacy_review" } },
        "spot-simple-price",
      ),
    ).toMatchObject({ status: "unavailable", reason: "withheld · privacy_review" });
    if (original.attempts.availability !== "available") throw new Error("Expected attempts");
    const missing = {
      ...original,
      attempts: {
        availability: "available" as const,
        value: original.attempts.value.filter((entry) => entry.repetition !== 2),
      },
    };
    expect(summarizeTask(missing, "spot-simple-price").status).toBe("incomplete");
    const failed = {
      ...original,
      attempts: {
        availability: "available" as const,
        value: original.attempts.value.map((entry) => ({ ...entry, verdict: "fail" as const })),
      },
    };
    expect(summarizeTask(failed, "spot-simple-price")).toMatchObject({
      status: "available",
      passed: 0,
      started: 3,
    });
  });
});
