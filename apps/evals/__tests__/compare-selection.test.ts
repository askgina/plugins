import { afterEach, expect, test, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { canonicalRuns, MEASURED_FAMILIES, type CanonicalRun } from "../src/canonical/canonical";
import {
  preferredCompareRun,
  recommendedComparePair,
  resolveCompareSelection,
} from "../src/canonical/compare-selection";
import { ComparePage } from "../src/canonical/pages/compare";
import { compareEligibility, getRun } from "../src/canonical/selectors";

const base = getRun("astra-high-perps-1")!;
afterEach(() => vi.unstubAllGlobals());

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

test("every measured category opens with two distinct, fully graded, compatible models", () => {
  for (const family of MEASURED_FAMILIES) {
    const pair = recommendedComparePair(canonicalRuns, family)!;
    expect(pair).toBeDefined();
    expect(pair.left.modelId).not.toBe(pair.right.modelId);
    expect(compareEligibility(pair.left, pair.right).eligible).toBe(true);
    for (const run of [pair.left, pair.right]) {
      expect(run.origin).toBe("measured");
      expect(run.family).toBe(family);
      expect(run.counts.planned).toBeGreaterThan(0);
      expect(run.counts.graded).toBe(run.counts.planned);
    }
  }
});

test("recommendations find the strongest compatible pair rather than incompatible leaders", () => {
  const row = (modelId: string, passed: number): CanonicalRun => ({
    ...base,
    modelId,
    runId: modelId,
    counts: { ...base.counts, passed, failed: base.counts.planned - passed },
  });
  const first = row("first", 54);
  const otherConditions = {
    ...row("other-conditions", 54),
    cohort: { ...base.cohort, cohortId: "another-cohort" },
  };
  const second = row("second", 45);
  const third = row("third", 20);
  const runs = [otherConditions, third, first, second];
  expect(recommendedComparePair(runs, "Perps")).toEqual({ left: first, right: second });
  expect(recommendedComparePair([...runs].reverse(), "Perps")).toEqual({
    left: first,
    right: second,
  });
});

test("recommendations do not resurrect an older favorable result when its latest recording is incomplete", () => {
  const newest = {
    ...base,
    runId: "newest-incomplete",
    startedAt: "2099-01-01T00:00:00Z",
    counts: { ...base.counts, graded: 0, passed: 0, failed: 0 },
  };
  const opponent = getRun("sol-low-perps-1")!;
  expect(recommendedComparePair([base, newest, opponent], "Perps")).toBeUndefined();
  expect(resolveCompareSelection([base, newest, opponent], "Perps")).toEqual({
    left: undefined,
    right: undefined,
  });
});

test("suggestions exclude synthetic, incomplete and unpinned evidence and never compare a model to itself", () => {
  const invalid: CanonicalRun[] = [
    { ...base, modelId: "demo", runId: "demo", origin: "synthetic" },
    { ...base, modelId: "partial", runId: "partial", dispatchCoverage: "incomplete" },
    {
      ...base,
      modelId: "ungraded",
      runId: "ungraded",
      counts: { ...base.counts, graded: base.counts.planned - 1 },
    },
    {
      ...base,
      modelId: "empty",
      runId: "empty",
      counts: { ...base.counts, planned: 0, graded: 0 },
    },
    {
      ...base,
      modelId: "unpinned",
      runId: "unpinned",
      configuration: { ...base.configuration, availability: "labels_only", pinnedSha256: null },
    },
  ];
  expect(recommendedComparePair([base, ...invalid], "Perps")).toBeUndefined();
  expect(recommendedComparePair([base, getRun("astra-low-perps-1")!], "Perps")).toBeUndefined();
});

test("a one-sided link keeps the exact requested run and fills a compatible fully graded opponent", () => {
  const selection = resolveCompareSelection(canonicalRuns, "Perps", "recovery-astra-max-perps-1");
  expect(selection).toEqual({
    left: "recovery-astra-max-perps-1",
    right: "recovery-grok-low-perps-1",
  });
  expect(resolveCompareSelection(canonicalRuns, "Perps", undefined, selection.left)).toEqual({
    left: selection.right,
    right: selection.left,
  });
  expect(compareEligibility(getRun(selection.left!)!, getRun(selection.right!)!).eligible).toBe(
    true,
  );
});

test("explicit incomplete, unknown and incompatible selections are never replaced", () => {
  const left = "astra-max-perps-1";
  const right = "devin-swe2-max-perps-1";
  expect(resolveCompareSelection(canonicalRuns, "Perps", left, right)).toEqual({ left, right });
  expect(resolveCompareSelection(canonicalRuns, "Perps", left)).toEqual({ left, right: undefined });
  expect(resolveCompareSelection(canonicalRuns, "Perps", "unknown-run")).toEqual({
    left: "unknown-run",
    right: undefined,
  });
});

test("model changes prefer a fully graded matching setting over an incomplete effort match", () => {
  const reference = getRun("sol-low-perps-1")!;
  const selected = preferredCompareRun(canonicalRuns, "astra", "Perps", reference, "max")!;
  expect(selected.counts.graded).toBe(selected.counts.planned);
  expect(compareEligibility(reference, selected).eligible).toBe(true);
});

test("the bare Compare page is populated without query parameters", () => {
  vi.stubGlobal("window", { location: { hash: "#/compare" } });
  const html = renderToStaticMarkup(createElement(ComparePage));
  expect(html).toContain('value="astra-high-perps-1" selected=""');
  expect(html).toContain('value="sol-low-perps-1" selected=""');
  expect(html.match(/class="eval-compare-run-card"/gu)).toHaveLength(2);
  expect(html).toContain("Task outcomes");
  expect(html).toContain("Matching test conditions.");
  expect(html).not.toContain("Choose a model above to see its recorded results.");
  expect(html).not.toContain("Results shown separately");
});
