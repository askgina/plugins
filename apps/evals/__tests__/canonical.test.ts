import { describe, expect, test } from "vitest";
import { canonicalCampaigns, canonicalRuns, type CanonicalRun } from "../src/canonical/canonical";
import {
  compareEligibility,
  derivedCostPerTask,
  gradedOnlyRate,
  headlineFor,
  headlineSortKey,
  runHistoryFor,
  runsForFamily,
  runsForModel,
  scoringCoverageFor,
} from "../src/canonical/selectors";
import { reasoningSweep, reasoningSweepClaude, reasoningSweepPublication } from "../src/results";

describe("scoring coverage", () => {
  test("distinguishes finished dispatch from score completeness", () => {
    expect(
      scoringCoverageFor({ dispatchCoverage: "complete", counts: { planned: 39, graded: 0 } }),
    ).toBe("none");
    expect(
      scoringCoverageFor({ dispatchCoverage: "complete", counts: { planned: 39, graded: 38 } }),
    ).toBe("partial");
    expect(
      scoringCoverageFor({ dispatchCoverage: "complete", counts: { planned: 39, graded: 39 } }),
    ).toBe("complete");
  });

  test("does not mark absent or uncertain evidence fully scored", () => {
    expect(
      scoringCoverageFor({ dispatchCoverage: "complete", counts: { planned: 0, graded: 0 } }),
    ).toBe("none");
    expect(
      scoringCoverageFor({ dispatchCoverage: "unknown", counts: { planned: 39, graded: 39 } }),
    ).toBe("unknown");
    expect(
      scoringCoverageFor({ dispatchCoverage: "incomplete", counts: { planned: 39, graded: 38 } }),
    ).toBe("partial");
  });

  test("ranks a fully graded zero-pass run above unscored runs and blocks their comparisons", () => {
    const base = canonicalRuns.find(
      (run) =>
        run.configuration.availability === "pinned" && scoringCoverageFor(run) === "complete",
    )!;
    const zeroPass: CanonicalRun = {
      ...base,
      counts: { ...base.counts, passed: 0, failed: base.counts.graded },
    };
    const partial: CanonicalRun = {
      ...base,
      counts: {
        ...base.counts,
        completed: base.counts.started - 1,
        graded: base.counts.started - 1,
        passed: base.counts.started - 1,
        failed: 0,
        timedOut: 0,
        runtimeFailure: 1,
        unscored: 1,
      },
    };
    const unscored: CanonicalRun = {
      ...partial,
      counts: {
        ...partial.counts,
        completed: 0,
        graded: 0,
        passed: 0,
        runtimeFailure: partial.counts.started,
        unscored: partial.counts.started,
      },
    };

    expect(headlineFor(zeroPass).kind).toBe("rate");
    expect(headlineSortKey(zeroPass)).toBe(0);
    expect(compareEligibility(zeroPass, base).eligible).toBe(true);
    expect(gradedOnlyRate(partial)).not.toBeNull();
    expect(gradedOnlyRate(unscored)).toBeNull();
    for (const run of [partial, unscored]) {
      expect(headlineFor(run)).toMatchObject({
        kind: "counts_only",
        reason: "incomplete_grading",
      });
      expect(headlineSortKey(run)).toBeLessThan(headlineSortKey(zeroPass));
      for (const pair of [
        [run, zeroPass],
        [zeroPass, run],
      ] as const) {
        expect(compareEligibility(...pair)).toMatchObject({
          eligible: false,
          reasons: ["incomplete_grading"],
        });
      }
    }
  });

  test("preserves dispatch precedence and existing comparison restrictions", () => {
    const base = canonicalRuns.find(
      (run) =>
        run.configuration.availability === "pinned" && scoringCoverageFor(run) === "complete",
    )!;
    for (const [dispatchCoverage, reason] of [
      ["incomplete", "incomplete_coverage"],
      ["unknown", "coverage_unknown"],
    ] as const) {
      const run: CanonicalRun = {
        ...base,
        dispatchCoverage,
        counts: { ...base.counts, graded: 0, passed: 0, failed: 0 },
      };
      expect(headlineFor(run)).toMatchObject({ kind: "counts_only", reason });
      expect(compareEligibility(base, run)).toMatchObject({ eligible: false, reasons: [reason] });
    }
    for (const [run, reason] of [
      [
        {
          ...base,
          cohort: {
            ...base.cohort,
            cohortId: "different-target-cohort",
            target: "different-target",
          },
        },
        "outside_selected_cohort",
      ],
      [
        {
          ...base,
          cohort: {
            ...base.cohort,
            cohortId: "different-evidence-cohort",
            evidenceCategory:
              base.cohort.evidenceCategory === "conformance" ? "answer_quality" : "conformance",
          },
        },
        "different_evidence_category",
      ],
      [
        { ...base, configuration: { ...base.configuration, availability: "labels_only" } },
        "labels_only_configuration",
      ],
    ] as const) {
      expect(compareEligibility(base, run)).toMatchObject({ eligible: false, reasons: [reason] });
    }
  });
});

describe("canonical models and runs", () => {
  test("retains measured family coverage across legacy and sweep campaigns", () => {
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
    for (const modelId of [
      "muse-spark",
      "claude-fable",
      "claude-opus",
      "gpt-terra",
      "astra",
      "grok",
      "gemini",
      "swe-2",
    ]) {
      expect([...new Set(runsForModel(modelId).map((run) => run.family))].sort()).toEqual([
        "Perps",
        "Predictions",
        "Spot",
      ]);
    }
  });

  test("orders model-wide Fable history newest first while retaining family filters and stable ties", () => {
    const history = runHistoryFor("claude-fable");
    expect([...new Set(history.map((run) => run.family))].sort()).toEqual([
      "Perps",
      "Predictions",
      "Spot",
    ]);
    expect(history.every((run) => run.modelId === "claude-fable")).toBe(true);
    expect(
      history
        .filter((run) => run.runId === "fable-low-spot-1" || run.runId === "fable-spot-1")
        .map((run) => run.runId),
    ).toEqual(["fable-low-spot-1", "fable-spot-1"]);

    for (const family of ["Spot", "Perps", "Predictions"] as const) {
      expect(runHistoryFor("claude-fable", family)).toEqual(
        history.filter((run) => run.family === family),
      );
    }

    for (const startedAt of new Set(history.map((run) => run.startedAt))) {
      expect(history.filter((run) => run.startedAt === startedAt).map((run) => run.runId)).toEqual(
        canonicalRuns
          .filter((run) => run.modelId === "claude-fable" && run.startedAt === startedAt)
          .map((run) => run.runId),
      );
    }
  });

  test("spot measured runs carry 12 attempts across 4 cases", () => {
    const spotRuns = runsForFamily("Spot").filter(
      (r) => r.origin === "measured" && r.campaignId !== "reasoning-sweep-2026-09-16",
    );
    expect(spotRuns).toHaveLength(5);
    for (const run of spotRuns) {
      expect(run.counts.planned).toBe(12);
      expect(run.counts.started).toBe(12);
    }
  });
});

describe("reasoning sweep runs", () => {
  const rows = [...reasoningSweep.models, ...reasoningSweepClaude.models];
  const runs = canonicalRuns.filter((run) => run.campaignId === "reasoning-sweep-2026-09-16");

  test("retains every published row and slot of the declared sweep without collapsing configurations", () => {
    for (const artifact of [reasoningSweep, reasoningSweepClaude]) {
      expect(artifact.methodology.plannedRows).toBe(35);
      expect(artifact.methodology.plannedSlots).toBe(3675);
      expect(artifact.planned).toBe(artifact.models.reduce((sum, row) => sum + row.planned, 0));
    }
    expect(reasoningSweepPublication).toEqual({
      publishedRows: 34,
      publishedSlots: 3570,
      plannedRows: 35,
      plannedSlots: 3675,
    });
    expect(rows).toHaveLength(34);
    expect(new Set(rows.map((row) => row.rowId)).size).toBe(rows.length);
    expect(runs).toHaveLength(rows.length * 3);
    expect(runs.reduce((sum, run) => sum + run.counts.planned, 0)).toBe(
      reasoningSweepPublication.publishedSlots,
    );
    for (const row of rows) {
      expect(row.runs.map((run) => run.family).sort()).toEqual(["perps", "predictions", "spot"]);
      expect(row.runs.reduce((sum, run) => sum + run.planned, 0)).toBe(row.planned);
      for (const source of row.runs) {
        const run = runs.find((entry) => entry.runId === `${row.rowId}-${source.family}-1`)!;
        expect(run).toBeDefined();
        expect(run.family.toLowerCase()).toBe(source.family);
        expect(run.counts.planned).toBe(source.planned);
        expect(run.configuration.model).toBe(row.model);
        expect(run.configuration.reasoning).toBe(row.reasoning);
        expect(run.configuration.pinnedSha256).toBe(source.configuration.pinnedSha256);
      }
    }
    expect(new Set(runs.map((run) => run.runId)).size).toBe(runs.length);
    expect(new Set(runs.map((run) => run.configuration.pinnedSha256)).size).toBe(runs.length);
    expect(
      runs.filter((run) => run.family === "Spot").every((run) => run.counts.planned === 12),
    ).toBe(true);
  });

  test("partitions planned slots without turning runtime failures into failed grades", () => {
    for (const run of runs) {
      const counts = run.counts;
      expect(counts.passed + counts.failed).toBe(counts.graded);
      expect(counts.timedOut + counts.runtimeFailure).toBe(counts.unscored);
      expect(counts.graded + counts.unscored! + counts.pending).toBe(counts.started);
      expect(counts.started + counts.unstarted).toBe(counts.planned);
      expect(run.attempts.availability).toBe("available");
      if (run.attempts.availability === "available") {
        expect(
          run.attempts.value.filter((attempt) => attempt.execution === "timed_out"),
        ).toHaveLength(counts.timedOut);
        expect(
          run.attempts.value.filter((attempt) => attempt.verdict === "not_graded"),
        ).toHaveLength(counts.unscored!);
      }
    }
  });

  test("keeps the exact Fable and Opus identities on their native OAuth route", () => {
    const fableRuns = runs.filter((run) => run.modelId === "claude-fable");
    const opusRuns = runs.filter((run) => run.modelId === "claude-opus");
    expect(fableRuns).toHaveLength(9);
    expect(opusRuns).toHaveLength(12);
    expect([...new Set(fableRuns.map((run) => run.configuration.reasoning))].sort()).toEqual([
      "high",
      "low",
      "medium",
    ]);
    expect(
      fableRuns.every(
        (run) =>
          run.cohort.target === "omp_harness" &&
          run.configuration.model === "anthropic/claude-fable-5-1",
      ),
    ).toBe(true);
    expect(
      opusRuns.every(
        (run) =>
          run.cohort.target === "omp_harness" &&
          run.configuration.model === "anthropic/claude-opus-5",
      ),
    ).toBe(true);
  });

  test("keeps route budgets and source provenance distinct", () => {
    const campaign = canonicalCampaigns.find(
      (entry) => entry.campaignId === "reasoning-sweep-2026-09-16",
    )!;
    expect(campaign.timeoutMs).toBeNull();
    expect(campaign.sourceCommit).toBeNull();
    for (const run of runs) {
      expect(run.timeoutMs).toBe(run.cohort.target === "devin_cli" ? 300000 : 120000);
      if (run.cohort.target === "omp_harness") {
        expect(run.provenance.sourceCommit).toMatch(/^[a-f0-9]{40}$/);
        expect(run.provenance.sourceKind).toBe("git_checkout");
      } else {
        expect(run.provenance.sourceKind).toBe("extracted_snapshot");
      }
    }
  });

  test("does not borrow a legacy route price for the sweep", () => {
    const legacy = canonicalRuns.find((run) => run.runId === "sol-spot-1")!;
    expect(derivedCostPerTask(legacy).availability).toBe("available");
    for (const run of runs) {
      expect(derivedCostPerTask(run).availability).not.toBe("available");
    }
  });

  test("does not fabricate numeric usage when a family has no recorded token samples", () => {
    for (const row of rows) {
      for (const source of row.runs) {
        if (source.tokenUsage.observations !== 0) continue;
        const run = runs.find((entry) => entry.runId === `${row.rowId}-${source.family}-1`)!;
        expect(run.metrics.tokenUsage.availability).toBe("not_recorded");
        if (run.attempts.availability === "available") {
          for (const attempt of run.attempts.value) {
            expect(attempt.tokenUsage.availability).not.toBe("available");
          }
        }
      }
    }
  });
});
