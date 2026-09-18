import { describe, expect, test } from "vitest";
import {
  SUITE_IDS,
  type CanonicalAttempt,
  type CanonicalModel,
  type CanonicalPublication,
  type CanonicalRun,
} from "../src/canonical/canonical";
import {
  compareEligibility,
  configurationLeaderboardRows,
  eligibilityText,
  measuredRepresentativeRuns,
  sortLeaderboardRows,
  summarizeTask,
  unifiedLeaderboardRows,
  type ScoredFamily,
} from "../src/canonical/selectors";

const model: CanonicalModel = {
  id: "controlled-model",
  name: "Controlled model",
  provider: "test",
  providerModel: "test-model",
  mark: "T",
  color: "test",
  origin: "measured",
};

type Outcome = CanonicalAttempt["verdict"] | "timed_out" | "runtime_failure";

function fixtureRun(
  family: ScoredFamily,
  outcomes: readonly Outcome[],
  durations = outcomes.map(() => 1000),
): CanonicalRun {
  const attempts: CanonicalAttempt[] = outcomes.map((outcome, index) => ({
    caseId: `${family}-task-${Math.floor(index / 3)}`,
    repetition: (index % 3) + 1,
    execution: outcome === "timed_out" || outcome === "runtime_failure" ? outcome : "completed",
    failureAttribution: outcome === "runtime_failure" ? "infrastructure" : null,
    verdict: outcome === "timed_out" || outcome === "runtime_failure" ? "not_graded" : outcome,
    checks: { availability: "not_recorded" },
    checkSource: "native",
    failureCategories: [],
    durationMs: { availability: "available", value: durations[index]! },
    wallDurationMs: { availability: "not_recorded" },
    tokenUsage: { availability: "not_recorded" },
    answer: { availability: "not_retained" },
    toolCalls: { availability: "not_retained" },
  }));
  const passed = outcomes.filter((outcome) => outcome === "pass").length;
  const failed = outcomes.filter((outcome) => outcome === "fail").length;
  const graded = passed + failed;
  const inputTokens = outcomes.length * { Spot: 1, Perps: 2, Predictions: 4 }[family] * 1_000_000;
  return {
    runId: `${family}-original`,
    origin: "measured",
    modelId: model.id,
    family,
    campaignId: "controlled-campaign",
    startedAt: "2026-01-01T00:00:00Z",
    pricing: { inputUsdPerMillion: 1, outputUsdPerMillion: 2, asOf: "2026-01-01", source: "test" },
    dispatchCoverage: "complete",
    gradingCoverage: graded === outcomes.length ? "complete" : "partial",
    coveragePlan: { planSource: "declared_plan", planSha256: null, statusSha256: null },
    caseBinding: "bound_by_suite",
    checkSource: "native",
    counts: {
      planned: outcomes.length,
      started: outcomes.length,
      completed: attempts.filter((attempt) => attempt.execution === "completed").length,
      timedOut: outcomes.filter((outcome) => outcome === "timed_out").length,
      runtimeFailure: outcomes.filter((outcome) => outcome === "runtime_failure").length,
      pending: 0,
      unstarted: 0,
      unknown: 0,
      passed,
      failed,
      graded,
      unscored: outcomes.length - graded,
    },
    cohort: {
      cohortId: `${family}-cohort`,
      suiteId: SUITE_IDS[family],
      suiteVersion: 1,
      fixtureVersion: 1,
      catalogSha: "controlled-catalog",
      target: "controlled-target",
      accountClass: "test",
      repetitions: 3,
      evidenceCategory: "conformance",
    },
    configuration: {
      configurationId: `${family}-configuration`,
      availability: "pinned",
      pinnedSha256: `${family}-pin`,
      candidate: "controlled-candidate",
      model: model.providerModel,
      reasoning: null,
    },
    metrics: {
      latencyMs: {
        availability: "available",
        p50: 999999,
        p95: 999999,
        max: 999999,
        sampleCount: outcomes.length,
        population: "completed",
      },
      tokenUsage: {
        availability: "available",
        inputTokens,
        outputTokens: 0,
        totalTokens: inputTokens,
        sampleCount: outcomes.length,
        population: "completed",
      },
      answerAccuracy: { availability: "no_declared_method" },
      usdCost: { availability: "not_recorded" },
      uncertainty: { availability: "not_recorded" },
    },
    dimensions: { availability: "not_recorded" },
    attempts: { availability: "available", value: attempts },
    withheldFields: [],
    provenance: { sourceArtifactSha256: null, sourceLabel: "test", sourceCommit: "test" },
    notes: [],
  };
}

function publications(runs: readonly CanonicalRun[]): CanonicalPublication[] {
  return runs.map((run) => ({
    publicationId: `${run.runId}-publication`,
    runId: run.runId,
    dataOrigin: run.origin,
    status: "current",
    currentRevisionId: "test-revision",
    review: { status: "synthetic_preview" },
    revisions: [],
  }));
}

function suite(): CanonicalRun[] {
  return [
    fixtureRun("Spot", ["pass", "pass", "pass"], [100, 200, 300]),
    fixtureRun("Perps", ["pass", "pass", "pass", "fail", "fail", "fail"]),
    fixtureRun("Predictions", Array<Outcome>(9).fill("fail"), Array<number>(9).fill(2000)),
  ];
}

const rowFor = (runs: readonly CanonicalRun[]) =>
  unifiedLeaderboardRows(runs, publications(runs), [model])[0]!;

function retainedAttempts(run: CanonicalRun): readonly CanonicalAttempt[] {
  if (run.attempts.availability !== "available")
    throw new Error("Fixture requires retained attempts");
  return run.attempts.value;
}

describe("unified leaderboard", () => {
  test("weights categories equally and includes fully graded zero-pass categories", () => {
    const row = rowFor(suite());
    expect(row.scores).toEqual({ Spot: 1, Perps: 0.5, Predictions: 0 });
    expect(row.overall).toBe(0.5);
    const missing = rowFor(suite().slice(0, 2));
    expect(missing.scores.Predictions).toBeNull();
    expect(missing.overall).toBeNull();
    expect(missing.averageTime.availability).toBe("unavailable");
    expect(missing.estimatedCost).toMatchObject({ availability: "available", sampleCount: 9 });
    expect(missing.coverageLabel).toBe("Spot + Perps only");
  });

  test("pools individual timings and token costs by their actual sample counts", () => {
    const row = rowFor(suite());
    expect(row.averageTime).toEqual({
      availability: "available",
      value: 24600 / 18,
      sampleCount: 18,
      excluded: 0,
    });
    expect(row.estimatedCost).toEqual({
      availability: "available",
      value: 51 / 18,
      sampleCount: 18,
      excluded: 0,
      detail: "Estimate from recorded tokens and published token rates; not billed spend.",
    });
    const runs = suite();
    const spot = runs[0]!;
    runs[0] = {
      ...spot,
      metrics: {
        ...spot.metrics,
        tokenUsage: {
          availability: "available",
          inputTokens: 1_000_000,
          outputTokens: 0,
          totalTokens: 1_000_000,
          sampleCount: 1,
          population: "completed",
        },
      },
    };
    expect(rowFor(runs).estimatedCost).toEqual({
      availability: "available",
      value: 49 / 16,
      sampleCount: 16,
      excluded: 2,
      detail: "Estimate from recorded tokens and published token rates; not billed spend.",
    });
  });

  test("does not replace absent individual timings with aggregate latency", () => {
    const runs = suite();
    const spot = runs[0]!;
    const attempts = retainedAttempts(spot);
    const missingTimings: CanonicalRun["attempts"][] = [
      { availability: "not_retained" },
      { availability: "available", value: attempts.slice(1) },
      {
        availability: "available",
        value: attempts.map((attempt, index) =>
          index === 0 ? { ...attempt, durationMs: { availability: "not_recorded" } } : attempt,
        ),
      },
    ];
    for (const evidence of missingTimings) {
      const row = rowFor([{ ...spot, attempts: evidence }, ...runs.slice(1)]);
      expect(row.averageTime.availability).toBe("unavailable");
      expect(row.estimatedCost.availability).toBe("available");
      expect(row.overall).toBe(0.5);
    }
  });

  test("requires prices, token samples, and compatible populations for pooled cost", () => {
    const runs = suite();
    const spot = runs[0]!;
    const tokens = spot.metrics.tokenUsage;
    if (tokens.availability !== "available") throw new Error("Fixture requires token samples");
    const variants: CanonicalRun[] = [
      { ...spot, pricing: null },
      { ...spot, metrics: { ...spot.metrics, tokenUsage: { availability: "not_recorded" } } },
      {
        ...spot,
        metrics: {
          ...spot.metrics,
          tokenUsage: {
            availability: "aggregate_only",
            inputTokens: tokens.inputTokens,
            outputTokens: tokens.outputTokens,
            totalTokens: tokens.totalTokens,
            population: tokens.population,
          },
        },
      },
      { ...spot, metrics: { ...spot.metrics, tokenUsage: { ...tokens, population: "started" } } },
    ];
    for (const variant of variants) {
      const row = rowFor([variant, ...runs.slice(1)]);
      expect(row.estimatedCost.availability).toBe("unavailable");
      expect(row.averageTime.availability).toBe("available");
    }
    const graded = {
      ...spot,
      metrics: { ...spot.metrics, tokenUsage: { ...tokens, population: "graded" as const } },
    };
    expect(rowFor([graded, ...runs.slice(1)]).estimatedCost).toEqual(rowFor(runs).estimatedCost);
  });

  test("keeps incomplete dispatch and incompatible settings out of overall scores", () => {
    const runs = suite();
    const spot = runs[0]!;
    for (const dispatchCoverage of ["incomplete", "unknown"] as const) {
      const row = rowFor([{ ...spot, dispatchCoverage }, ...runs.slice(1)]);
      expect(row.scores.Spot).toBeNull();
      expect(row.scores.Perps).toBe(0.5);
      expect(row.overall).toBeNull();
    }
    const incompatible = {
      ...spot,
      cohort: { ...spot.cohort, cohortId: "other-cohort", fixtureVersion: 2 },
    };
    const row = rowFor([incompatible, ...runs.slice(1)]);
    expect(row.scores.Spot).toBe(1);
    expect(row.overall).toBeNull();
    expect(row.averageTime.availability).toBe("unavailable");
    expect(row.estimatedCost.availability).toBe("unavailable");
    expect(compareEligibility(spot, incompatible).eligible).toBe(false);
  });

  test("filters synthetic, withdrawn, and unpublished candidates before selection", () => {
    const original = suite()[0]!;
    const withdrawn: CanonicalRun = {
      ...original,
      runId: "withdrawn",
      startedAt: "2026-02-01T00:00:00Z",
    };
    const synthetic: CanonicalRun = {
      ...original,
      runId: "synthetic",
      origin: "synthetic",
      startedAt: "2026-03-01T00:00:00Z",
    };
    const unpublished = { ...original, runId: "unpublished", startedAt: "2026-04-01T00:00:00Z" };
    const records = publications([original, withdrawn, synthetic]).map((publication) =>
      publication.runId === withdrawn.runId
        ? { ...publication, status: "withdrawn" as const }
        : publication,
    );
    expect(
      measuredRepresentativeRuns([unpublished, synthetic, withdrawn, original], records),
    ).toEqual([original]);
    expect(measuredRepresentativeRuns([unpublished, synthetic, withdrawn], records)).toEqual([]);
  });

  test("selects newest dispatch-complete results without cherry-picking graded or better scores", () => {
    const originals = suite();
    for (const outcomes of [
      ["fail", "fail", "fail"],
      ["pass", "timed_out", "runtime_failure"],
      ["runtime_failure", "runtime_failure", "runtime_failure"],
    ] satisfies Outcome[][]) {
      const latest = {
        ...fixtureRun("Spot", outcomes),
        runId: "latest",
        startedAt: "2026-02-01T00:00:00Z",
      };
      const laterIncomplete: CanonicalRun = {
        ...latest,
        runId: "dispatch-incomplete",
        startedAt: "2026-03-01T00:00:00Z",
        dispatchCoverage: "incomplete",
      };
      const row = rowFor([...originals, latest, laterIncomplete]);
      expect(row.runs.Spot).toBe(latest);
      if (latest.counts.graded === latest.counts.planned) {
        expect(row.scores.Spot).toBe(0);
        expect(row.overall).toBeCloseTo(0.5 / 3);
      } else {
        expect(row.scores.Spot).toBeNull();
        expect(row.overall).toBeNull();
        const completed = outcomes.filter((outcome) => outcome === "pass").length;
        expect(row.averageTime).toEqual({
          availability: "available",
          value: (24000 + completed * 1000) / (15 + completed),
          sampleCount: 15 + completed,
          excluded: 3 - completed,
        });
        expect(row.estimatedCost.availability).toBe("available");
        expect(compareEligibility(originals[0]!, latest).eligible).toBe(false);
      }
    }
  });

  test("keeps fully graded configurations alongside later incomplete reasoning settings", () => {
    const low = suite().map((run) => ({
      ...run,
      configuration: { ...run.configuration, reasoning: "low", candidate: "low-candidate" },
    }));
    const max = low.map((run) => ({
      ...fixtureRun(run.family as ScoredFamily, ["pass", "timed_out", "runtime_failure"]),
      runId: `${run.family}-max`,
      startedAt: "2026-02-01T00:00:00Z",
      configuration: { ...run.configuration, reasoning: "max", candidate: "max-candidate" },
    }));
    const runs = [...low, ...max];
    const rows = configurationLeaderboardRows(runs, publications(runs), [model]);
    expect(rows).toHaveLength(2);
    const complete = rows.find((row) => row.runs.Spot?.configuration.reasoning === "low")!;
    const partial = rows.find((row) => row.runs.Spot?.configuration.reasoning === "max")!;
    expect(complete.overall).toBe(0.5);
    expect(partial.overall).toBeNull();
    expect(partial.runs.Perps?.counts).toMatchObject({ passed: 1, timedOut: 1, runtimeFailure: 1 });
    expect(partial.averageTime).toEqual({
      availability: "available",
      value: 1000,
      sampleCount: 3,
      excluded: 6,
    });
    expect(new Set(rows.map((row) => row.rowId)).size).toBe(2);
    expect(
      rows
        .flatMap((row) => Object.values(row.runs))
        .map((run) => run.runId)
        .sort(),
    ).toEqual(runs.map((run) => run.runId).sort());
  });

  test("sorts full precision and keeps unavailable values below genuine zero in both directions", () => {
    const rated = rowFor(
      suite().map((run) =>
        fixtureRun(run.family as ScoredFamily, Array<Outcome>(run.counts.planned).fill("fail")),
      ),
    );
    const missing = rowFor([
      {
        ...fixtureRun("Spot", ["runtime_failure", "runtime_failure", "runtime_failure"]),
        pricing: null,
      },
    ]);
    expect(rated.overall).toBe(0);
    for (const direction of ["asc", "desc"] as const) {
      for (const metric of ["overall", "Spot", "time", "cost"] as const) {
        expect(sortLeaderboardRows([missing, rated], metric, direction)).toEqual([rated, missing]);
      }
    }
    const a = { ...rated, model: { ...model, id: "a", name: "Alpha" }, overall: 0.50001 };
    const b = { ...rated, model: { ...model, id: "b", name: "Beta" }, overall: 0.50002 };
    expect(sortLeaderboardRows([a, b])).toEqual([b, a]);
    const tie = { ...b, overall: a.overall };
    expect(sortLeaderboardRows([tie, a])).toEqual([a, tie]);
  });
});

describe("task summaries", () => {
  const caseId = "Spot-task-0";

  test("retains timeout and runtime-failure attempts without advertising a quality result", () => {
    for (const outcomes of [
      ["pass", "timed_out", "runtime_failure"],
      ["runtime_failure", "runtime_failure", "runtime_failure"],
      ["timed_out", "timed_out", "timed_out"],
      ["not_graded", "not_graded", "not_graded"],
    ] satisfies Outcome[][]) {
      const run = fixtureRun("Spot", outcomes);
      const summary = summarizeTask(run, caseId);
      expect(summary.status).toBe("incomplete");
      expect(summary.passed).toBe(outcomes.filter((outcome) => outcome === "pass").length);
      expect(summary.started).toBe(3);
      expect(summary.slots).toEqual(retainedAttempts(run));
      expect(summary.reason).toBe(eligibilityText("incomplete_grading"));
    }
  });

  test("does not rank a fully graded task inside an incompletely graded run", () => {
    const run = fixtureRun("Spot", ["pass", "pass", "pass", "pass", "pass", "timed_out"]);
    expect(summarizeTask(run, caseId)).toMatchObject({
      status: "incomplete",
      passed: 3,
      started: 3,
      reason: eligibilityText("incomplete_grading"),
    });
    for (const [dispatchCoverage, reason] of [
      ["incomplete", "incomplete_coverage"],
      ["unknown", "coverage_unknown"],
    ] as const) {
      expect(summarizeTask({ ...run, dispatchCoverage }, caseId).reason).toBe(
        eligibilityText(reason),
      );
    }
  });

  test("checks task slots even when run totals claim complete grading", () => {
    const run = fixtureRun("Spot", ["pass", "pass", "pass"]);
    for (const outcome of ["timed_out", "runtime_failure", "not_graded"] as const) {
      const evidence = fixtureRun("Spot", ["pass", "pass", outcome]).attempts;
      expect(summarizeTask({ ...run, attempts: evidence }, caseId).status).toBe("incomplete");
    }
    const attempts = retainedAttempts(run);
    for (const incomplete of [
      attempts.filter((attempt) => attempt.repetition !== 2),
      [attempts[0]!, attempts[0]!, attempts[2]!],
      [...attempts, { ...attempts[0]!, repetition: 4 }],
    ]) {
      const summary = summarizeTask(
        { ...run, attempts: { availability: "available", value: incomplete } },
        caseId,
      );
      expect(summary.status).toBe("incomplete");
      expect(summary.started).toBe(incomplete.length);
    }
    expect(
      summarizeTask(
        { ...run, attempts: { availability: "available", value: [attempts[0]!, attempts[2]!] } },
        caseId,
      ).slots,
    ).toEqual([attempts[0], undefined, attempts[2]]);
  });

  test("distinguishes absent evidence and missing tasks from a fully graded zero-pass task", () => {
    const run = fixtureRun("Spot", ["fail", "fail", "fail"]);
    expect(summarizeTask(undefined, caseId).status).toBe("not_evaluated");
    expect(
      summarizeTask(
        { ...run, attempts: { availability: "withheld", reason: "privacy_review" } },
        caseId,
      ).status,
    ).toBe("unavailable");
    expect(summarizeTask(run, "absent-task").status).toBe("incomplete");
    expect(summarizeTask(run, caseId)).toMatchObject({
      status: "available",
      passed: 0,
      started: 3,
      reason: null,
    });
  });
});
