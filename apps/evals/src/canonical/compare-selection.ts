import type { CanonicalRun, PrototypeFamily } from "./canonical";
import { compareEligibility, scoringCoverageFor } from "./selectors";

function newestFirst(a: CanonicalRun, b: CanonicalRun): number {
  return (
    (b.recovery?.capturedAt ?? b.startedAt).localeCompare(a.recovery?.capturedAt ?? a.startedAt) ||
    a.runId.localeCompare(b.runId)
  );
}

/** Choose the latest evidence before considering grades or scores. */
function latestCompareRecordings(runs: readonly CanonicalRun[]): CanonicalRun[] {
  const latest = new Map<string, CanonicalRun>();
  for (const run of [...runs].sort(newestFirst)) {
    const key = JSON.stringify([
      run.origin,
      run.modelId,
      run.family,
      run.cohort.cohortId,
      run.configuration.reasoning,
    ]);
    if (!latest.has(key)) latest.set(key, run);
  }
  return [...latest.values()];
}

function isFullyGraded(run: CanonicalRun): boolean {
  return (
    run.origin === "measured" &&
    run.counts.planned > 0 &&
    scoringCoverageFor(run) === "complete" &&
    compareEligibility(run, run).eligible
  );
}

function passRate(run: CanonicalRun): number {
  return run.counts.passed / run.counts.planned;
}

function strongestFirst(a: CanonicalRun, b: CanonicalRun): number {
  return passRate(b) - passRate(a) || newestFirst(a, b);
}

/** Automatic model choices favor complete, matching evidence; explicit run choices stay intact. */
export function preferredCompareRun(
  runs: readonly CanonicalRun[],
  modelId: string,
  family: PrototypeFamily,
  reference?: CanonicalRun,
  reasoning = reference?.configuration.reasoning,
): CanonicalRun | undefined {
  return latestCompareRecordings(runs)
    .filter((run) => run.modelId === modelId && run.family === family)
    .sort(
      (a, b) =>
        Number(
          Boolean(reference && isFullyGraded(b) && compareEligibility(reference, b).eligible),
        ) -
          Number(
            Boolean(reference && isFullyGraded(a) && compareEligibility(reference, a).eligible),
          ) ||
        Number(b.cohort.cohortId === reference?.cohort.cohortId) -
          Number(a.cohort.cohortId === reference?.cohort.cohortId) ||
        Number(isFullyGraded(b)) - Number(isFullyGraded(a)) ||
        Number(b.configuration.reasoning === reasoning) -
          Number(a.configuration.reasoning === reasoning) ||
        newestFirst(a, b),
    )[0];
}

/** Category changes keep the chosen model, effort and client, regardless of score eligibility. */
export function compareRunForCategory(
  runs: readonly CanonicalRun[],
  selected: CanonicalRun,
  family: PrototypeFamily,
): CanonicalRun | undefined {
  if (selected.family === family) return selected;
  return runs
    .filter(
      (run) =>
        run.family === family &&
        run.modelId === selected.modelId &&
        run.origin === selected.origin &&
        run.configuration.reasoning === selected.configuration.reasoning &&
        run.cohort.target === selected.cohort.target,
    )
    .sort(
      (a, b) =>
        Number(b.campaignId === selected.campaignId) -
          Number(a.campaignId === selected.campaignId) ||
        Number(b.cohort.cohortId === selected.cohort.cohortId) -
          Number(a.cohort.cohortId === selected.cohort.cohortId) ||
        newestFirst(a, b),
    )[0];
}

export interface ComparePair {
  readonly left: CanonicalRun;
  readonly right: CanonicalRun;
}

/** Highest combined pass rate among fully graded, comparable, distinct models. */
export function recommendedComparePair(
  runs: readonly CanonicalRun[],
  family: PrototypeFamily,
): ComparePair | undefined {
  const candidates = latestCompareRecordings(runs)
    .filter((run) => run.family === family && isFullyGraded(run))
    .sort(strongestFirst);
  let best: ComparePair | undefined;
  let bestRate = -1;
  for (const [index, left] of candidates.entries()) {
    for (const right of candidates.slice(index + 1)) {
      if (left.modelId === right.modelId || !compareEligibility(left, right).eligible) continue;
      const rate = passRate(left) + passRate(right);
      if (rate > bestRate) {
        best = { left, right };
        bestRate = rate;
      }
    }
  }
  return best;
}

/** Fill only unspecified sides. Broken, withdrawn and incomplete links remain inspectable. */
export function resolveCompareSelection(
  runs: readonly CanonicalRun[],
  family: PrototypeFamily,
  left?: string,
  right?: string,
): { left?: string; right?: string } {
  if (left !== undefined && right !== undefined) return { left, right };
  if (left === undefined && right === undefined) {
    const pair = recommendedComparePair(runs, family);
    return { left: pair?.left.runId, right: pair?.right.runId };
  }
  const selected = runs.find((run) => run.runId === (left ?? right));
  if (!selected || selected.family !== family || !isFullyGraded(selected)) return { left, right };
  const opponent = latestCompareRecordings(runs)
    .filter(
      (run) =>
        run.family === family &&
        run.modelId !== selected.modelId &&
        isFullyGraded(run) &&
        compareEligibility(selected, run).eligible,
    )
    .sort(strongestFirst)[0];
  return {
    left: left ?? opponent?.runId,
    right: right ?? opponent?.runId,
  };
}
