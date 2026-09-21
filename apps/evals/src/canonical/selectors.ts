// Data rules for the prototype pages — the single home for every derivation.
//
// Page components must not reimplement any of these rules:
// - headline availability (passes/started only when dispatch and grading are
//   complete; otherwise counts-only with the reason, without quality ranking)
// - representative-run selection per model × family × configuration group
// - eligibility-reason derivation + display text
// - configuration grouping by exact pinnedSha256 (labels-only stands alone)
// - cohort filtering and comparison eligibility (equal cohorts + both pinned)
// - baseline dedup (Sol runs import once from September 11; Muse sol blocks
//   are baselineRunId references, not second runs)
// - family/case lookup

import {
  canonicalCaseDefinitions,
  canonicalCohorts,
  canonicalModels,
  canonicalPublications,
  canonicalRuns,
  MODEL_PRICING,
  SUITE_IDS,
  withdrawnRuns,
  type CanonicalAttempt,
  type CanonicalCaseDefinition,
  type CanonicalCohort,
  type CanonicalModel,
  type CanonicalPublication,
  type CanonicalRun,
  type CanonicalRunCounts,
  type CostEstimateBasis,
  type DispatchCoverage,
  type EligibilityReason,
  type Evidence,
  type MetricUnavailable,
  type PrototypeFamily,
  type StatisticPopulation,
  type WithdrawnRunRef,
} from "./canonical";

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

const runById = new Map(canonicalRuns.map((run) => [run.runId, run]));
const modelById = new Map(canonicalModels.map((model) => [model.id, model]));
const withdrawnById = new Map(withdrawnRuns.map((run) => [run.runId, run]));
const publicationByRunId = new Map(
  canonicalPublications.map((publication) => [publication.runId, publication]),
);
const caseById = new Map(
  canonicalCaseDefinitions.map((definition) => [definition.caseId, definition]),
);

export function getRun(runId: string): CanonicalRun | undefined {
  return runById.get(runId);
}

export function getWithdrawnRun(runId: string): WithdrawnRunRef | undefined {
  return withdrawnById.get(runId);
}

/** Model directory order: newest public release first; unknown dates last. */
export function modelsByReleaseDate(): readonly CanonicalModel[] {
  return canonicalModels
    .filter((model) => model.origin === "measured")
    .sort(
      (a, b) =>
        (b.release?.date ?? "").localeCompare(a.release?.date ?? "") ||
        a.name.localeCompare(b.name),
    );
}

export function getModel(modelId: string): CanonicalModel | undefined {
  return modelById.get(modelId);
}

export function getPublication(runId: string): CanonicalPublication | undefined {
  return publicationByRunId.get(runId);
}

export function getCaseDefinition(caseId: string): CanonicalCaseDefinition | undefined {
  return caseById.get(caseId);
}

export function caseDefinitionsForFamily(
  family: PrototypeFamily,
): readonly CanonicalCaseDefinition[] {
  return canonicalCaseDefinitions.filter((definition) => definition.family === family);
}

export function runsForModel(modelId: string): readonly CanonicalRun[] {
  return canonicalRuns.filter((run) => run.modelId === modelId);
}

export function runsForFamily(family: PrototypeFamily): readonly CanonicalRun[] {
  return canonicalRuns.filter((run) => run.family === family);
}

export function publicationFor(run: CanonicalRun): CanonicalPublication | undefined {
  return publicationByRunId.get(run.runId);
}

// ---------------------------------------------------------------------------
// Baseline dedup — Sol appears inside the Muse report as a baseline, but the
// canonical copy imports once from the September 11 sources. Callers that see
// a `baselineRunId` resolve it to the canonical run.
// ---------------------------------------------------------------------------

/** Artifact runIds -> canonical runIds for runs that appear as embedded baselines. */
const BASELINE_ARTIFACT_RUN_IDS: Record<string, string> = {
  "spot-openai-oauth-sol-20260911T142646Z": "sol-spot-1",
  "perps-openai-oauth-sol-20260911T152450Z": "sol-perps-1",
  "predictions-openai-oauth-sol-durable-20260911T161134Z": "sol-predictions-1",
};

export function resolveBaselineRun(run: CanonicalRun): CanonicalRun | undefined {
  const baselineRunId = run.provenance.baselineRunId;
  if (baselineRunId === undefined) return undefined;
  const canonicalId = BASELINE_ARTIFACT_RUN_IDS[baselineRunId];
  return canonicalId === undefined ? undefined : runById.get(canonicalId);
}

// ---------------------------------------------------------------------------
// Headline — passes/started is a quality sort key only when dispatch and grading
// are complete. Dispatch reasons take precedence over incomplete grading;
// otherwise show counts only, without treating unscored starts as failures.
// ---------------------------------------------------------------------------

export type Headline =
  | { readonly kind: "rate"; readonly passed: number; readonly started: number }
  | {
      readonly kind: "counts_only";
      readonly reason: "incomplete_coverage" | "coverage_unknown" | "incomplete_grading";
      readonly passed: number;
      readonly started: number;
    };

export function headlineFor(run: CanonicalRun): Headline {
  if (run.dispatchCoverage === "incomplete") {
    return {
      kind: "counts_only",
      reason: "incomplete_coverage",
      passed: run.counts.passed,
      started: run.counts.started,
    };
  }
  if (run.dispatchCoverage === "unknown") {
    return {
      kind: "counts_only",
      reason: "coverage_unknown",
      passed: run.counts.passed,
      started: run.counts.started,
    };
  }
  if (scoringCoverageFor(run) !== "complete") {
    return {
      kind: "counts_only",
      reason: "incomplete_grading",
      passed: run.counts.passed,
      started: run.counts.started,
    };
  }
  return {
    kind: "rate",
    passed: run.counts.passed,
    started: run.counts.started,
  };
}

/** Numeric sort key; counts-only rows sort below every rated row. */
export function headlineSortKey(run: CanonicalRun): number {
  const headline = headlineFor(run);
  if (headline.kind === "counts_only" || headline.started === 0) return -1;
  return headline.passed / headline.started;
}

// ---------------------------------------------------------------------------
// Configuration grouping — exact pinnedSha256 identity; labels_only and
// unpinned configurations never merge into a pinned group.
// ---------------------------------------------------------------------------

export function configurationGroupKey(run: CanonicalRun): string {
  return run.configuration.availability === "pinned" && run.configuration.pinnedSha256 !== null
    ? `pin:${run.configuration.pinnedSha256}`
    : `labels:${run.configuration.configurationId}`;
}

/** Human-visible difference between two configurations in one cohort. */
export function configurationDifferences(
  left: CanonicalRun,
  right: CanonicalRun,
): readonly string[] {
  const differences: string[] = [];
  if (left.configuration.reasoning !== right.configuration.reasoning) {
    differences.push(
      `reasoning differs (${left.configuration.reasoning ?? "unset"} vs ${right.configuration.reasoning ?? "unset"})`,
    );
  }
  if (left.configuration.candidate !== right.configuration.candidate) {
    differences.push(
      `candidate differs (${left.configuration.candidate} vs ${right.configuration.candidate})`,
    );
  }
  if (left.checkSource !== right.checkSource) {
    differences.push(
      `check source differs (${left.checkSource} vs ${right.checkSource}) — a visible condition difference, not a block`,
    );
  }
  if (left.configuration.pinnedSha256 !== right.configuration.pinnedSha256) {
    differences.push("different pinned configurations");
  }
  return differences;
}

// ---------------------------------------------------------------------------
// Cohorts — equal cohort ids mean equal cohort tuples.
// ---------------------------------------------------------------------------

export function sameCohort(left: CanonicalCohort, right: CanonicalCohort): boolean {
  return left.cohortId === right.cohortId;
}

/**
 * The leaderboard default cohort for a family: the cohort containing the
 * September 11 OMP-harness runs (`target: "omp_harness"`). Muse runs form
 * their own cohort per family and are outside it.
 */
export function defaultLeaderboardCohort(family: PrototypeFamily): CanonicalCohort {
  const match = canonicalCohorts.find(
    (cohort) => cohort.suiteId === suiteIdForFamily(family) && cohort.target === "omp_harness",
  );
  if (match === undefined) {
    throw new Error(`No default cohort for family ${family}`);
  }
  return match;
}

function suiteIdForFamily(family: PrototypeFamily): string {
  const definition = canonicalCaseDefinitions.find((entry) => entry.family === family);
  if (definition === undefined) {
    throw new Error(`No suite for family ${family}`);
  }
  return definition.suiteId;
}

export function inCohort(run: CanonicalRun, cohort: CanonicalCohort): boolean {
  return run.cohort.cohortId === cohort.cohortId;
}

// ---------------------------------------------------------------------------
// Eligibility — display text derives from reason codes, never free text.
// ---------------------------------------------------------------------------

const ELIGIBILITY_TEXT: Record<EligibilityReason, string> = {
  pilot: "Pilot run — excluded from comparisons",
  synthetic: "Synthetic demonstration row — no measured evidence",
  incomplete_coverage: "Dispatch coverage incomplete — showing counts, not a rate",
  coverage_unknown: "Dispatch coverage unknown — showing counts, not a rate",
  incomplete_grading:
    "Grading incomplete: unscored attempts are not quality failures; showing counts, not a rate",
  missing_pinned_configuration: "No pinned configuration declared",
  labels_only_configuration: "Labels-only configuration — cannot match a pinned configuration",
  different_evidence_category: "Different evidence category — not the same measure",
  outside_selected_cohort: "Outside the selected cohort",
  no_declared_method: "No declared method produces this value",
};

export function eligibilityText(reason: EligibilityReason): string {
  return ELIGIBILITY_TEXT[reason];
}

/** Why two runs cannot be compared. */
export function compareEligibility(
  left: CanonicalRun,
  right: CanonicalRun,
): {
  readonly eligible: boolean;
  readonly reasons: readonly EligibilityReason[];
  readonly conditions: readonly string[];
} {
  const reasons: EligibilityReason[] = [];
  const conditions: string[] = [];
  // Synthetic origin is a visible condition difference, not a block on its own.
  if (left.origin !== right.origin) {
    conditions.push("data origin differs (measured vs synthetic)");
  } else if (left.origin === "synthetic") {
    conditions.push("both rows are synthetic demonstrations");
  }
  if (!sameCohort(left.cohort, right.cohort)) {
    if (left.cohort.evidenceCategory !== right.cohort.evidenceCategory) {
      reasons.push("different_evidence_category");
    } else {
      reasons.push("outside_selected_cohort");
    }
  }
  if (
    left.configuration.availability !== "pinned" ||
    right.configuration.availability !== "pinned"
  ) {
    reasons.push(
      left.configuration.availability === "labels_only" ||
        right.configuration.availability === "labels_only"
        ? "labels_only_configuration"
        : "missing_pinned_configuration",
    );
  }
  if (left.dispatchCoverage === "incomplete" || right.dispatchCoverage === "incomplete") {
    reasons.push("incomplete_coverage");
  }
  if (left.dispatchCoverage === "unknown" || right.dispatchCoverage === "unknown") {
    reasons.push("coverage_unknown");
  }
  if (
    (left.dispatchCoverage === "complete" && scoringCoverageFor(left) !== "complete") ||
    (right.dispatchCoverage === "complete" && scoringCoverageFor(right) !== "complete")
  ) {
    reasons.push("incomplete_grading");
  }
  return {
    eligible: reasons.length === 0,
    reasons,
    conditions: [...conditions, ...configurationDifferences(left, right)],
  };
}

// ---------------------------------------------------------------------------
// Representative runs: per model × family × configuration group, prefer
// non-withdrawn publications with complete dispatch, then select the newest
// startedAt. If none have complete dispatch, select the newest publication.
// Grading completeness and quality never affect this pick; corrections do not either.
// ---------------------------------------------------------------------------

export interface RepresentativeRow {
  readonly modelId: string;
  readonly family: PrototypeFamily;
  readonly run: CanonicalRun;
  /** Number of distinct configuration groups that produced candidates. */
  readonly configurationGroups: number;
  /** Present when the representative run has no headline rate. */
  readonly coverageReason: Extract<Headline, { kind: "counts_only" }>["reason"] | null;
}

function isPublished(run: CanonicalRun): boolean {
  const publication = publicationByRunId.get(run.runId);
  return publication !== undefined && publication.status === "current";
}

export function representativeRuns(family: PrototypeFamily): readonly RepresentativeRow[] {
  const rows: RepresentativeRow[] = [];
  const byModel = new Map<string, CanonicalRun[]>();
  for (const run of canonicalRuns) {
    if (run.family !== family) continue;
    const list = byModel.get(run.modelId) ?? [];
    list.push(run);
    byModel.set(run.modelId, list);
  }
  for (const [modelId, runs] of byModel) {
    const groups = new Map<string, CanonicalRun[]>();
    for (const run of runs) {
      const key = configurationGroupKey(run);
      const group = groups.get(key) ?? [];
      group.push(run);
      groups.set(key, group);
    }
    const groupReps: CanonicalRun[] = [];
    for (const group of groups.values()) {
      const published = group.filter(isPublished);
      const complete = published.filter((run) => run.dispatchCoverage === "complete");
      const pool = complete.length > 0 ? complete : published;
      if (pool.length === 0) continue;
      const newest = pool.reduce((a, b) => (a.startedAt >= b.startedAt ? a : b));
      groupReps.push(newest);
    }
    if (groupReps.length === 0) continue;
    // A measured representative always outranks a synthetic demonstration
    // row for the same model — demo rows never stand in for measured evidence.
    const measuredReps = groupReps.filter((run) => run.origin === "measured");
    const repPool = measuredReps.length > 0 ? measuredReps : groupReps;
    const pick = repPool.reduce((a, b) => (a.startedAt >= b.startedAt ? a : b));
    const headline = headlineFor(pick);
    rows.push({
      modelId,
      family,
      run: pick,
      configurationGroups: groups.size,
      coverageReason: headline.kind === "counts_only" ? headline.reason : null,
    });
  }
  return rows;
}

/** Newest-first run history for a model, optionally limited to a family (all config groups). */
export function runHistoryFor(modelId: string, family?: PrototypeFamily): readonly CanonicalRun[] {
  return canonicalRuns
    .filter((run) => run.modelId === modelId && (family === undefined || run.family === family))
    .sort((a, b) => (a.startedAt > b.startedAt ? -1 : a.startedAt < b.startedAt ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Attempt detail + outcome matrix
// ---------------------------------------------------------------------------

export function attemptsFor(run: CanonicalRun): readonly CanonicalAttempt[] {
  return run.attempts.availability === "available" ? run.attempts.value : [];
}

export interface OutcomeMatrixRow {
  readonly caseId: string;
  readonly definition: CanonicalCaseDefinition | undefined;
  readonly attempts: readonly (CanonicalAttempt | undefined)[];
}

/** Case × repetition matrix for the run detail view. */
export function outcomeMatrixFor(run: CanonicalRun): readonly OutcomeMatrixRow[] {
  const attempts = attemptsFor(run);
  const caseIds = [...new Set(attempts.map((attempt) => attempt.caseId))];
  const definitionIds = caseDefinitionsForFamily(run.family).map((definition) => definition.caseId);
  const orderedIds = [
    ...definitionIds.filter((id) => caseIds.includes(id)),
    ...caseIds.filter((id) => !definitionIds.includes(id)),
  ];
  return orderedIds.map((caseId) => {
    const perCase = attempts.filter((attempt) => attempt.caseId === caseId);
    const maxRep = Math.max(...perCase.map((attempt) => attempt.repetition), 0);
    const slots: (CanonicalAttempt | undefined)[] = Array.from({ length: maxRep }, (_, index) =>
      perCase.find((attempt) => attempt.repetition === index + 1),
    );
    return { caseId, definition: caseById.get(caseId), attempts: slots };
  });
}

// ---------------------------------------------------------------------------
// Graded-only rate — labelled, run detail only.
// ---------------------------------------------------------------------------

export interface GradedOnlyRate {
  readonly passed: number;
  readonly graded: number;
  readonly timedOut: number;
  readonly runtimeFailures: number;
}

export function gradedOnlyRate(run: CanonicalRun): GradedOnlyRate | null {
  if (run.counts.graded === 0) return null;
  if (run.counts.graded === run.counts.started) return null;
  return {
    passed: run.counts.passed,
    graded: run.counts.graded,
    timedOut: run.counts.timedOut,
    runtimeFailures: run.counts.runtimeFailure,
  };
}

export function gradedOnlyLabel(rate: GradedOnlyRate): string {
  const exclusions: string[] = [];
  if (rate.timedOut > 0) {
    exclusions.push(`${rate.timedOut} timed out`);
  }
  if (rate.runtimeFailures > 0) {
    exclusions.push(
      `${rate.runtimeFailures} runtime failure${rate.runtimeFailures === 1 ? "" : "s"}`,
    );
  }
  return `graded-only rate (excludes ${exclusions.join(", ")})`;
}

// ---------------------------------------------------------------------------
// Metric labels — display text for every availability state.
// ---------------------------------------------------------------------------

export function evidenceState(evidence: Evidence<unknown> | { availability: string }): string {
  if (evidence.availability === "withheld") {
    return `withheld · ${(evidence as { reason?: string }).reason ?? ""}`.trim();
  }
  return evidence.availability;
}

/** Dispatch completion never implies that every planned attempt was graded. */
export function scoringCoverageFor(run: {
  readonly dispatchCoverage: DispatchCoverage;
  readonly counts: Pick<CanonicalRunCounts, "planned" | "graded">;
}): "complete" | "partial" | "none" | "unknown" {
  if (run.counts.graded === 0) return "none";
  if (run.dispatchCoverage === "unknown") return "unknown";
  return run.dispatchCoverage === "complete" && run.counts.graded === run.counts.planned
    ? "complete"
    : "partial";
}

export function dispatchCoverageText(coverage: DispatchCoverage): string {
  if (coverage === "complete") return "dispatch complete";
  if (coverage === "incomplete") return "dispatch incomplete";
  return "dispatch unknown";
}

// ---------------------------------------------------------------------------
// Cohort labels + family cohorts — shared by the leaderboard cohort selector
// and the compare pickers.
// ---------------------------------------------------------------------------

const FAMILY_BY_SUITE_ID: Record<string, PrototypeFamily> = {
  [SUITE_IDS.Spot]: "Spot",
  [SUITE_IDS.Perps]: "Perps",
  [SUITE_IDS.Predictions]: "Predictions",
  [SUITE_IDS.Portfolio]: "Portfolio",
};

/** Human-readable cohort identity: family · target · account · reps · evidence. */
export function cohortLabel(cohort: CanonicalCohort): string {
  const family = FAMILY_BY_SUITE_ID[cohort.suiteId] ?? cohort.suiteId;
  return `${family} · ${cohort.target} · ${cohort.accountClass} · ${cohort.repetitions} reps · ${cohort.evidenceCategory}${cohort.recoveryProtocol ? " · Recovery (120–600s)" : ""}`;
}

/** Every cohort declared for a family's suite (empty for unmeasured families). */
export function cohortsForFamily(family: PrototypeFamily): readonly CanonicalCohort[] {
  const suiteId = suiteIdForFamily(family);
  return canonicalCohorts.filter((cohort) => cohort.suiteId === suiteId);
}

// ---------------------------------------------------------------------------
// Derived cost — measured tokens × registry price over the token statistic's
// own population (decision 10). Never presented as a measured field.
// ---------------------------------------------------------------------------

export interface DerivedCostAvailable {
  readonly availability: "available";
  readonly basis: CostEstimateBasis;
  readonly usdPerTask: number;
  /** null when the token metric is aggregate_only (sample count not retained). */
  readonly sampleCount: number | null;
  readonly population: StatisticPopulation;
  readonly priceAsOf: string;
  readonly priceSource: string;
}

export type DerivedCost = DerivedCostAvailable | MetricUnavailable;

const POPULATION_COUNT: Record<StatisticPopulation, (counts: CanonicalRunCounts) => number> = {
  started: (counts) => counts.started,
  completed: (counts) => counts.completed,
  graded: (counts) => counts.graded,
};

/**
 * Prefer reconciled client-recorded cost estimates, including cache charges.
 * Legacy runs use the token aggregate priced at the model's published rate,
 * divided by the number of tasks the statistic covers —
 * `sampleCount` when retained, the population count for `aggregate_only`.
 * Unavailable when token evidence is missing or the model has no pricing entry.
 */
export function derivedCostPerTask(run: CanonicalRun): DerivedCost {
  const recorded = run.recordedCostEstimate;
  if (recorded !== undefined) {
    if (recorded.availability !== "available") return recorded;
    if (recorded.sampleCount <= 0) {
      return { availability: "not_recorded", reason: "No completed attempts with cost records." };
    }
    return {
      availability: "available",
      basis: recorded.basis,
      usdPerTask: recorded.usdTotal / recorded.sampleCount,
      sampleCount: recorded.sampleCount,
      population: recorded.population,
      priceAsOf: recorded.recordedAt,
      priceSource: recorded.source,
    };
  }
  const metric = run.metrics.tokenUsage;
  if (metric.availability !== "available" && metric.availability !== "aggregate_only") {
    return metric;
  }
  const pricing = run.pricing === undefined ? MODEL_PRICING[run.modelId] : run.pricing;
  if (pricing == null) {
    return { availability: "not_recorded", reason: "no verified price for this model and route" };
  }
  const denominator =
    metric.availability === "available"
      ? metric.sampleCount
      : POPULATION_COUNT[metric.population](run.counts);
  if (denominator <= 0) {
    return { availability: "not_recorded", reason: "token statistic covers no tasks" };
  }
  const usdTotal =
    (metric.inputTokens * pricing.inputUsdPerMillion +
      metric.outputTokens * pricing.outputUsdPerMillion) /
    1_000_000;
  return {
    availability: "available",
    basis: "token_rates",
    usdPerTask: usdTotal / denominator,
    sampleCount: metric.availability === "available" ? metric.sampleCount : null,
    population: metric.population,
    priceAsOf: pricing.asOf,
    priceSource: pricing.source,
  };
}

// Public browsing summaries. Keep the stricter pairwise comparison rules above.
export const SCORED_FAMILIES = ["Spot", "Perps", "Predictions"] as const;
export type ScoredFamily = (typeof SCORED_FAMILIES)[number];
export type SummaryMetric =
  | {
      readonly availability: "available";
      readonly value: number;
      readonly sampleCount: number;
      readonly excluded: number;
      readonly detail?: string;
    }
  | { readonly availability: "unavailable"; readonly reason: string };
export interface LeaderboardModelRow {
  readonly rowId?: string;
  readonly campaignId?: string;
  readonly configurationLabel?: string;
  readonly model: CanonicalModel;
  readonly runs: Readonly<Partial<Record<PrototypeFamily, CanonicalRun>>>;
  readonly scores: Readonly<Record<ScoredFamily, number | null>>;
  readonly overall: number | null;
  readonly overallReason: string | null;
  readonly averageTime: SummaryMetric;
  readonly estimatedCost: SummaryMetric;
  readonly coverageLabel: string;
}
export type LeaderboardMetric = "overall" | ScoredFamily | "time" | "cost";

/** Filter origin/lifecycle before choosing by date; never choose by score. */
export function measuredRepresentativeRuns(
  runs: readonly CanonicalRun[] = canonicalRuns,
  publications: readonly CanonicalPublication[] = canonicalPublications,
): readonly CanonicalRun[] {
  const current = new Set(publications.filter((p) => p.status === "current").map((p) => p.runId));
  const groups = new Map<string, CanonicalRun[]>();
  for (const run of runs) {
    if (run.origin !== "measured" || !current.has(run.runId)) continue;
    const key = `${run.modelId}:${run.family}`;
    const group = groups.get(key) ?? [];
    group.push(run);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => {
    const complete = group.filter((run) => run.dispatchCoverage === "complete");
    return [...(complete.length ? complete : group)].sort(
      (a, b) => b.startedAt.localeCompare(a.startedAt) || a.runId.localeCompare(b.runId),
    )[0]!;
  });
}

const missingSummary = (reason: string): SummaryMetric => ({ availability: "unavailable", reason });

function compatibleSuiteRuns(runs: readonly CanonicalRun[]): boolean {
  const first = runs[0];
  return (
    first !== undefined &&
    runs.every(
      (run) =>
        run.cohort.suiteId === SUITE_IDS[run.family] &&
        run.cohort.suiteVersion === first.cohort.suiteVersion &&
        run.cohort.fixtureVersion === first.cohort.fixtureVersion &&
        run.cohort.catalogSha === first.cohort.catalogSha &&
        run.cohort.target === first.cohort.target &&
        run.cohort.accountClass === first.cohort.accountClass &&
        run.cohort.repetitions === first.cohort.repetitions &&
        run.cohort.evidenceCategory === "conformance" &&
        run.cohort.recoveryProtocol === first.cohort.recoveryProtocol &&
        run.configuration.reasoning === first.configuration.reasoning &&
        run.configuration.candidate === first.configuration.candidate,
    )
  );
}

function pooledTime(runs: readonly CanonicalRun[]): SummaryMetric {
  let total = 0;
  let count = 0;
  for (const run of runs) {
    if (run.attempts.availability !== "available")
      return missingSummary("Individual timings were not retained for every category.");
    const completed = run.attempts.value.filter((attempt) => attempt.execution === "completed");
    if (completed.length !== run.counts.completed)
      return missingSummary("Timing records do not cover every completed attempt.");
    for (const attempt of completed) {
      if (attempt.durationMs.availability !== "available")
        return missingSummary(
          `Individual ${run.family} timings were not retained for every completed attempt.`,
        );
      total += attempt.durationMs.value;
      count++;
    }
  }
  return count === 0
    ? missingSummary("No completed attempts with timings.")
    : {
        availability: "available",
        value: total / count,
        sampleCount: count,
        excluded: runs.reduce((sum, run) => sum + run.counts.started, 0) - count,
      };
}

function pooledCost(runs: readonly CanonicalRun[]): SummaryMetric {
  let total = 0;
  let count = 0;
  let population: string | undefined;
  const bases = new Set<string>();
  for (const run of runs) {
    // An empty, fully reconciled completed population contributes no samples.
    // Its unscored started attempts remain in the displayed exclusion count.
    if (
      run.recordedCostEstimate?.availability === "available" &&
      run.recordedCostEstimate.sampleCount === 0 &&
      run.counts.completed === 0
    )
      continue;
    const cost = derivedCostPerTask(run);
    if (cost.availability !== "available" && "reason" in cost && cost.reason) {
      return missingSummary(cost.reason);
    }
    if (cost.availability !== "available" || cost.sampleCount === null)
      return missingSummary(
        "Cost requires token usage, prices, and a known sample count in every category.",
      );
    // Graded and completed identify the same population only when their counts agree.
    const normalized =
      cost.population === "graded" && run.counts.graded === run.counts.completed
        ? "completed"
        : cost.population;
    if (population !== undefined && population !== normalized)
      return missingSummary("Token records cover different attempt populations.");
    population = normalized;
    bases.add(cost.basis);
    total += cost.usdPerTask * cost.sampleCount;
    count += cost.sampleCount;
  }
  return count === 0
    ? missingSummary("No recorded token usage.")
    : {
        availability: "available",
        value: total / count,
        sampleCount: count,
        excluded: runs.reduce((sum, run) => sum + run.counts.started, 0) - count,
        detail: bases.has("native_estimate")
          ? "Client-recorded estimate including cache usage; not billed spend."
          : bases.has("catalogue_free_tier")
            ? "Devin catalogue lists this model as Free; subscription charges excluded."
            : "Estimate from recorded tokens and published token rates; not billed spend.",
      };
}

export function unifiedLeaderboardRows(
  sourceRuns: readonly CanonicalRun[] = canonicalRuns,
  publications: readonly CanonicalPublication[] = canonicalPublications,
  models: readonly CanonicalModel[] = canonicalModels,
): readonly LeaderboardModelRow[] {
  const selected = measuredRepresentativeRuns(sourceRuns, publications);
  return models
    .filter(
      (model) => model.origin === "measured" && selected.some((run) => run.modelId === model.id),
    )
    .map((model) => {
      const modelRuns = selected.filter((run) => run.modelId === model.id);
      const runs = Object.fromEntries(modelRuns.map((run) => [run.family, run]));
      const scores = Object.fromEntries(
        SCORED_FAMILIES.map((family) => {
          const run = runs[family];
          const key = run ? headlineSortKey(run) : -1;
          return [family, key < 0 ? null : key];
        }),
      ) as Record<ScoredFamily, number | null>;
      const fullRuns = SCORED_FAMILIES.flatMap((family) => (runs[family] ? [runs[family]!] : []));
      const missing = fullRuns.length !== SCORED_FAMILIES.length;
      const overallReason = missing
        ? "Results are needed in all three categories."
        : !compatibleSuiteRuns(fullRuns)
          ? "These runs have different benchmark settings."
          : SCORED_FAMILIES.some((family) => scores[family] === null)
            ? (fullRuns
                .map(headlineFor)
                .flatMap((headline) =>
                  headline.kind === "counts_only" ? [eligibilityText(headline.reason)] : [],
                )[0] ?? "Complete dispatch and grading are needed in every category.")
            : null;
      const overall =
        overallReason === null
          ? SCORED_FAMILIES.reduce((sum, family) => sum + scores[family]!, 0) /
            SCORED_FAMILIES.length
          : null;
      // Measurement availability is independent of whether execution produced
      // enough graded attempts for a quality ranking.
      const measurementReason = missing
        ? "Results are needed in all three categories."
        : !compatibleSuiteRuns(fullRuns)
          ? "These runs have different benchmark settings."
          : null;
      return {
        model,
        runs,
        scores,
        overall,
        overallReason,
        averageTime:
          measurementReason === null ? pooledTime(fullRuns) : missingSummary(measurementReason),
        estimatedCost: compatibleSuiteRuns(fullRuns)
          ? pooledCost(fullRuns)
          : missingSummary("These runs have different benchmark settings."),
        coverageLabel: missing ? `${fullRuns.map((run) => run.family).join(" + ")} only` : "",
      };
    });
}

/** Keep every measured configuration visible instead of replacing it with a later effort. */
export function configurationLeaderboardRows(
  sourceRuns: readonly CanonicalRun[] = canonicalRuns,
  publications: readonly CanonicalPublication[] = canonicalPublications,
  models: readonly CanonicalModel[] = canonicalModels,
): readonly LeaderboardModelRow[] {
  const current = new Set(publications.filter((p) => p.status === "current").map((p) => p.runId));
  const groups = new Map<string, CanonicalRun[]>();
  for (const run of sourceRuns) {
    if (run.origin !== "measured" || !current.has(run.runId)) continue;
    const key = JSON.stringify([
      run.modelId,
      run.campaignId,
      run.cohort.target,
      run.cohort.accountClass,
      run.configuration.candidate,
      run.configuration.reasoning,
      run.cohort.suiteVersion,
      run.cohort.fixtureVersion,
      run.cohort.catalogSha,
      run.cohort.repetitions,
      run.cohort.evidenceCategory,
    ]);
    const group = groups.get(key) ?? [];
    group.push(run);
    groups.set(key, group);
  }
  return [...groups.values()].flatMap((group) => {
    const first = group[0]!;
    const client =
      first.cohort.target === "omp_harness"
        ? "OMP"
        : first.cohort.target === "muse_cli"
          ? "Muse"
          : first.cohort.target === "devin_cli"
            ? "Devin"
            : first.cohort.target;
    return unifiedLeaderboardRows(group, publications, models).map((row) => ({
      ...row,
      rowId: Object.values(row.runs)
        .map((run) => run.runId)
        .sort()
        .join("+"),
      campaignId: first.campaignId,
      configurationLabel: `${first.configuration.reasoning ?? "Unspecified"} reasoning · ${client}${first.recovery ? " · Recovery (120–600s)" : ""}`,
    }));
  });
}

/** Choose by grading coverage and date within the newest campaign, never by score. */
export function defaultLeaderboardRows(
  configurations: readonly LeaderboardModelRow[] = configurationLeaderboardRows(),
): readonly LeaderboardModelRow[] {
  const startedAt = (row: LeaderboardModelRow) =>
    Object.values(row.runs)
      .map((run) => run.startedAt)
      .sort()[0] ?? "";
  const groups = new Map<string, LeaderboardModelRow[]>();
  for (const row of configurations) {
    const group = groups.get(row.model.id) ?? [];
    group.push(row);
    groups.set(row.model.id, group);
  }
  return [...groups.values()].map((group) => {
    const newestFirst = [...group].sort(
      (a, b) =>
        startedAt(b).localeCompare(startedAt(a)) || (a.rowId ?? "").localeCompare(b.rowId ?? ""),
    );
    const newest = newestFirst[0]!;
    return (
      newestFirst.find((row) => row.campaignId === newest.campaignId && row.overall !== null) ??
      newest
    );
  });
}

export function recordedOutcomes(runs: readonly CanonicalRun[]) {
  return runs.reduce(
    (total, run) => ({
      planned: total.planned + run.counts.planned,
      started: total.started + run.counts.started,
      graded: total.graded + run.counts.graded,
      passed: total.passed + run.counts.passed,
      failed: total.failed + run.counts.failed,
      timedOut: total.timedOut + run.counts.timedOut,
      runtimeFailure: total.runtimeFailure + run.counts.runtimeFailure,
      pending: total.pending + run.counts.pending,
      unstarted: total.unstarted + run.counts.unstarted,
      unknown: total.unknown + run.counts.unknown,
    }),
    {
      planned: 0,
      started: 0,
      graded: 0,
      passed: 0,
      failed: 0,
      timedOut: 0,
      runtimeFailure: 0,
      pending: 0,
      unstarted: 0,
      unknown: 0,
    },
  );
}

export function sortLeaderboardRows(
  rows: readonly LeaderboardModelRow[],
  metric: LeaderboardMetric = "overall",
  direction: "asc" | "desc" = "desc",
): LeaderboardModelRow[] {
  const value = (row: LeaderboardModelRow): number | null => {
    if (metric === "overall") return row.overall;
    if (metric === "time" || metric === "cost") {
      const summary = metric === "time" ? row.averageTime : row.estimatedCost;
      return summary.availability === "available" ? summary.value : null;
    }
    return row.scores[metric];
  };
  return [...rows].sort((a, b) => {
    const av = value(a);
    const bv = value(b);
    if (av === null && bv !== null) return 1;
    if (bv === null && av !== null) return -1;
    const difference = av === null || bv === null ? 0 : av - bv;
    return (
      (direction === "asc" ? difference : -difference) || a.model.name.localeCompare(b.model.name)
    );
  });
}

export interface TaskSummary {
  readonly status: "available" | "not_evaluated" | "incomplete" | "unavailable";
  readonly passed: number;
  readonly started: number;
  readonly slots: readonly (CanonicalAttempt | undefined)[];
  readonly reason: string | null;
}

export function summarizeTask(run: CanonicalRun | undefined, caseId: string): TaskSummary {
  if (!run)
    return {
      status: "not_evaluated",
      passed: 0,
      started: 0,
      slots: [],
      reason: "No measured run for this category.",
    };
  if (run.attempts.availability !== "available")
    return {
      status: "unavailable",
      passed: 0,
      started: 0,
      slots: [],
      reason: evidenceState(run.attempts),
    };
  const attempts = run.attempts.value.filter((attempt) => attempt.caseId === caseId);
  const slots = Array.from(
    { length: Math.max(run.cohort.repetitions, ...attempts.map((a) => a.repetition)) },
    (_, index) => attempts.find((attempt) => attempt.repetition === index + 1),
  );
  const headline = headlineFor(run);
  const complete =
    headline.kind === "rate" &&
    attempts.length === run.cohort.repetitions &&
    slots.length === run.cohort.repetitions &&
    slots.every(
      (attempt) =>
        attempt &&
        attempt.execution === "completed" &&
        (attempt.verdict === "pass" || attempt.verdict === "fail"),
    );
  return {
    status: complete ? "available" : "incomplete",
    passed: attempts.filter((attempt) => attempt.verdict === "pass").length,
    started: attempts.filter((attempt) => !["unstarted", "unknown"].includes(attempt.execution))
      .length,
    slots,
    reason: complete
      ? null
      : headline.kind === "counts_only"
        ? eligibilityText(headline.reason)
        : "Some attempts or coverage records are missing.",
  };
}

export function benchmarkSummary(rows: readonly LeaderboardModelRow[]): string {
  const runs = rows.flatMap((row) =>
    SCORED_FAMILIES.flatMap((family) => (row.runs[family] ? [row.runs[family]!] : [])),
  );
  if (!runs.length) return "No measured results yet";
  const taskCount = SCORED_FAMILIES.reduce(
    (sum, family) => sum + caseDefinitionsForFamily(family).length,
    0,
  );
  const repetitions = [...new Set(runs.map((run) => run.cohort.repetitions))];
  const dates = runs.map((run) => run.startedAt.slice(0, 10)).sort();
  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${taskCount} tasks · ${repetitions.length === 1 ? `${repetitions[0]} attempts per task` : "Attempts vary by run"} · Results from ${formatter.formatRange(Date.parse(dates[0]!), Date.parse(dates[dates.length - 1]!))}`;
}
