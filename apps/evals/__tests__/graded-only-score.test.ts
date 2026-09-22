import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { gradedOnlyScore, modelProfileRows, sortLeaderboardRows } from "../src/canonical/selectors";
import { RecordedResult } from "../src/components/leaderboard-results";

const low = modelProfileRows("grok-4-7").find(
  (row) => row.campaignId === "grok47-low-recovery-20260922",
)!;
const runs = Object.values(low.runs);

test("provisional Overall averages graded category rates and leaves the ranking score unavailable", () => {
  expect(gradedOnlyScore(runs, true)).toBeCloseTo((11 / 12 + 36 / 47 + 23 / 33) / 3);
  expect(gradedOnlyScore(runs, true)).not.toBeCloseTo(70 / 92);
  expect(gradedOnlyScore([low.runs.Perps!])).toBeCloseTo(36 / 47);
  expect(gradedOnlyScore([low.runs.Predictions!])).toBeCloseTo(23 / 33);
  expect(low.overall).toBeNull();
  const astra = modelProfileRows("astra").find((row) => row.overall !== null)!;
  expect(sortLeaderboardRows([low, astra])[0]).toBe(astra);
  expect(sortLeaderboardRows([low, astra], "overall", "asc")[0]).toBe(astra);
});

test("fully graded Astra keeps its final percentage without a provisional label", () => {
  const astra = modelProfileRows("astra").find(
    (row) => row.runs.Spot?.configuration.reasoning === "max",
  )!;
  const runs = Object.values(astra.runs);
  expect(gradedOnlyScore(runs, true)).toBeNull();
  const html = renderToStaticMarkup(
    createElement(RecordedResult, { runs, score: astra.overall, overall: true }),
  );
  expect(html).toContain(">80.4%</span>");
  expect(html).toContain("Completed · 105/105 processed");
  expect(html).not.toContain("graded-only");
});

test("zero passes produces a real zero but missing verdicts cannot produce a percentage", () => {
  expect(
    gradedOnlyScore(
      runs.map((run) => ({
        ...run,
        counts: { ...run.counts, passed: 0, failed: run.counts.graded },
      })),
      true,
    ),
  ).toBe(0);
  const perps = low.runs.Perps!;
  expect(
    gradedOnlyScore([{ ...perps, counts: { ...perps.counts, passed: 0, failed: 0, graded: 0 } }]),
  ).toBeNull();
  expect(
    gradedOnlyScore([{ ...perps, counts: { ...perps.counts, runtimeFailure: 6, pending: 1 } }]),
  ).toBeNull();
});

test("provisional Overall requires all three categories from compatible measured runs", () => {
  expect(gradedOnlyScore(runs.slice(1), true)).toBeNull();
  expect(gradedOnlyScore([runs[0]!, runs[0]!, runs[2]!], true)).toBeNull();
  expect(gradedOnlyScore([], true)).toBeNull();
  expect(
    gradedOnlyScore([{ ...runs[0]!, campaignId: "another-campaign" }, ...runs.slice(1)], true),
  ).toBeNull();
  expect(
    gradedOnlyScore(
      [
        { ...runs[0]!, configuration: { ...runs[0]!.configuration, reasoning: "high" } },
        ...runs.slice(1),
      ],
      true,
    ),
  ).toBeNull();
  expect(
    gradedOnlyScore([{ ...runs[0]!, origin: "synthetic" }, ...runs.slice(1)], true),
  ).toBeNull();
});
