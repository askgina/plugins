import { expect, test } from "vitest";
import { canonicalRuns } from "../src/canonical/canonical";
import {
  endToEndSuccessRate,
  headlineSortKey,
  modelProfileRows,
  scoringCoverageFor,
  sortLeaderboardRows,
} from "../src/canonical/selectors";

const low = modelProfileRows("grok-4-7").find(
  (row) => row.campaignId === "grok47-low-recovery-20260922",
)!;
const perps = low.runs.Perps!;

test("Grok scores keep every planned trial in the denominator with equal category weights", () => {
  expect(low.scores).toEqual({ Spot: 11 / 12, Perps: 36 / 54, Predictions: 23 / 39 });
  expect(low.overall).toBeCloseTo((11 / 12 + 36 / 54 + 23 / 39) / 3);
  expect(low.overall).not.toBeCloseTo((11 / 12 + 36 / 47 + 23 / 33) / 3);
  expect(low.overall).not.toBeCloseTo(70 / 105);
  const xhigh = modelProfileRows("grok-4-7").find(
    (row) => row.runs.Spot?.configuration.reasoning === "xhigh",
  )!;
  expect(xhigh.overall).toBeCloseTo((11 / 12 + 33 / 54 + 21 / 39) / 3);
  expect(xhigh.overall).toBeCloseTo(0.6887464387);
});

test("replacing a failed verdict with a process error or timeout never improves a score", () => {
  for (const error of ["runtimeFailure", "timedOut"] as const) {
    const failed = { ...perps, counts: { ...perps.counts } };
    const errored = {
      ...perps,
      counts: {
        ...perps.counts,
        completed: perps.counts.completed - 1,
        graded: perps.counts.graded - 1,
        failed: perps.counts.failed - 1,
        [error]: perps.counts[error] + 1,
      },
    };
    expect(endToEndSuccessRate(errored)).toBe(endToEndSuccessRate(failed));
    expect(errored.counts.graded).toBe(failed.counts.graded - 1);
  }
});

test("all-error completed runs score zero without inventing failed grades", () => {
  const run = {
    ...perps,
    counts: {
      ...perps.counts,
      completed: 0,
      graded: 0,
      passed: 0,
      failed: 0,
      timedOut: 20,
      runtimeFailure: perps.counts.planned - 20,
    },
  };
  expect(endToEndSuccessRate(run)).toBe(0);
  expect(run.counts.failed).toBe(0);
  expect(run.counts.graded).toBe(0);
});

test("withholds scores for uncertain dispatch or inconsistent verdict totals", () => {
  for (const dispatchCoverage of ["incomplete", "unknown"] as const)
    expect(endToEndSuccessRate({ ...perps, dispatchCoverage })).toBeNull();
  expect(
    endToEndSuccessRate({
      ...perps,
      counts: { ...perps.counts, graded: perps.counts.graded - 1 },
    }),
  ).toBeNull();
  expect(
    endToEndSuccessRate({
      ...perps,
      counts: {
        ...perps.counts,
        completed: perps.counts.completed - 1,
        runtimeFailure: perps.counts.runtimeFailure + 1,
      },
    }),
  ).toBeNull();
});

test.each(["pending", "unstarted", "unknown"] as const)(
  "%s outcomes withhold a final score instead of being silently penalized",
  (state) => {
    const run = {
      ...perps,
      counts: {
        ...perps.counts,
        started: state === "unstarted" ? perps.counts.started - 1 : perps.counts.started,
        runtimeFailure: perps.counts.runtimeFailure - 1,
        [state]: 1,
      },
    };
    expect(endToEndSuccessRate(run)).toBeNull();
  },
);

test("every fully graded historical score is unchanged", () => {
  const complete = canonicalRuns.filter((run) => scoringCoverageFor(run) === "complete");
  expect(complete.length).toBeGreaterThan(50);
  for (const run of complete) expect(endToEndSuccessRate(run)).toBe(headlineSortKey(run));
  const astra = modelProfileRows("astra");
  expect(
    astra.find((row) => row.runs.Spot?.configuration.reasoning === "high")!.overall,
  ).toBeCloseTo(0.8660968661);
  expect(
    astra.find((row) => row.runs.Spot?.configuration.reasoning === "max")!.overall,
  ).toBeCloseTo(0.804368471);
});

test("sorting uses penalized percentages in both directions", () => {
  const high = modelProfileRows("grok-4-7").find(
    (row) => row.runs.Spot?.configuration.reasoning === "high",
  )!;
  const astra = modelProfileRows("astra").find(
    (row) => row.runs.Spot?.configuration.reasoning === "max",
  )!;
  expect(sortLeaderboardRows([low, astra, high])).toEqual([astra, low, high]);
  expect(sortLeaderboardRows([low, astra, high], "overall", "asc")).toEqual([high, low, astra]);
  expect(sortLeaderboardRows([low, astra], "Perps")).toEqual([astra, low]);
  expect(sortLeaderboardRows([low, astra], "Perps", "asc")).toEqual([low, astra]);
});
