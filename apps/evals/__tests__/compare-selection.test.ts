import { expect, test } from "vitest";
import { canonicalRuns } from "../src/canonical/canonical";
import { preferredCompareRun } from "../src/canonical/compare-selection";
import { compareEligibility, getRun } from "../src/canonical/selectors";

const base = getRun("astra-high-perps-1")!;

test("model selection prefers matching test conditions over a newer incompatible recording", () => {
  const newer = {
    ...base,
    runId: "different-conditions",
    startedAt: "2099-01-01T00:00:00Z",
    cohort: { ...base.cohort, cohortId: "different-test-setup" },
  };
  expect(preferredCompareRun([newer, base], base.modelId, base.family, base)).toBe(base);
});

test("defaults never replace a newer incomplete recording with an older high score", () => {
  const newer = {
    ...base,
    runId: "newer-incomplete",
    startedAt: "2099-01-01T00:00:00Z",
    counts: { ...base.counts, graded: 0, passed: 0, failed: 0 },
  };
  expect(preferredCompareRun([base, newer], base.modelId, base.family, base)).toBe(newer);
});

test("category changes preserve reasoning when available and never substitute another category", () => {
  const next = preferredCompareRun(canonicalRuns, "astra", "Predictions", undefined, "high")!;
  expect(next.family).toBe("Predictions");
  expect(next.configuration.reasoning).toBe("high");
  expect(preferredCompareRun(canonicalRuns, "gpt-5.5", "Perps")).toBeUndefined();
});

test("starter comparisons use retained compatible recordings", () => {
  for (const rightId of ["grok-low-perps-1", "astra-medium-perps-1"]) {
    const right = getRun(rightId)!;
    expect(right.origin).toBe("measured");
    expect(compareEligibility(base, right).eligible).toBe(true);
  }
});
