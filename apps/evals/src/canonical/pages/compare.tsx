// `#/compare?left=<runId>&right=<runId>` — side-by-side run comparison.
//
// Run pickers are grouped by cohort (suite + harness target + account class +
// repetitions + evidence category) and can be narrowed with the scope select.
// Eligibility comes from `compareEligibility` in ../selectors: equal cohorts and
// pinned configurations are required, while differing checkSource / reasoning /
// pins are surfaced as visible condition differences, not blocks. Blocked pairs
// explain their reason codes and never render deltas.

import { useMemo } from "react";
import { ArrowLeftRight, RotateCcw } from "lucide-react";
import { CheckDimensionPanel } from "../../components/check-dimension-radar";
import { ModelAvatar, PageShell, Panel } from "../../components/eval-ui";
import { navigate, useHashRoute } from "../../router";
import {
  canonicalCampaigns,
  canonicalRuns,
  type CanonicalAttempt,
  type CanonicalCohort,
  type CanonicalRun,
  type EligibilityReason,
  type Evidence,
  type MetricUnavailable,
} from "../canonical";
import {
  attemptsFor,
  caseDefinitionsForFamily,
  cohortLabel,
  compareEligibility,
  eligibilityText,
  getCaseDefinition,
  getModel,
  getPublication,
  getRun,
  getWithdrawnRun,
  headlineFor,
  resolveBaselineRun,
} from "../selectors";
import {
  AvailabilityMark,
  CoverageChip,
  ExecutionChip,
  HeadlineValue,
  LatencyValue,
  OriginTag,
  TokenUsageValue,
  VerdictChip,
} from "../components";
import "./compare.css";

const ALL_COHORTS = "all";

const numberFormatter = new Intl.NumberFormat("en-US");

function shortSha(sha: string | null | undefined): string | null {
  return sha === null || sha === undefined ? null : `${sha.slice(0, 12)}…`;
}

function comparePath(left: string | undefined, right: string | undefined, cohort: string): string {
  const params = new URLSearchParams();
  if (left !== undefined) params.set("left", left);
  if (right !== undefined) params.set("right", right);
  if (cohort !== ALL_COHORTS) params.set("cohort", cohort);
  const query = params.toString();
  return `/compare${query === "" ? "" : `?${query}`}`;
}

function runOptionLabel(run: CanonicalRun): string {
  const model = getModel(run.modelId);
  const marks = [
    run.origin === "synthetic" ? "synthetic" : null,
    run.dispatchCoverage !== "complete" ? `coverage ${run.dispatchCoverage}` : null,
    run.configuration.availability === "labels_only" ? "labels-only" : null,
  ].filter((mark): mark is string => mark !== null);
  const tail = marks.length > 0 ? ` · ${marks.join(" · ")}` : "";
  return `${model?.name ?? run.modelId} · ${run.runId} · ${run.startedAt.slice(0, 10)}${tail}`;
}

function sideName(run: CanonicalRun, left: CanonicalRun): string {
  return run.runId === left.runId ? "left" : "right";
}

/** Where a blocking reason applies — derives from reason codes, not free text. */
function reasonContext(
  reason: EligibilityReason,
  left: CanonicalRun,
  right: CanonicalRun,
): string | null {
  switch (reason) {
    case "different_evidence_category":
      return `left measures ${left.cohort.evidenceCategory} · right measures ${right.cohort.evidenceCategory}`;
    case "outside_selected_cohort":
      return `left: ${cohortLabel(left.cohort)} · right: ${cohortLabel(right.cohort)}`;
    case "labels_only_configuration":
    case "missing_pinned_configuration": {
      const sides = [left, right].filter((run) => run.configuration.availability !== "pinned");
      return `applies to ${sides
        .map((run) => `${sideName(run, left)} (${run.configuration.availability})`)
        .join(", ")}`;
    }
    case "incomplete_coverage":
    case "coverage_unknown": {
      const sides = [left, right].filter((run) => run.dispatchCoverage !== "complete");
      return `applies to ${sides
        .map((run) => `${sideName(run, left)} (${run.dispatchCoverage} coverage)`)
        .join(", ")}`;
    }
    case "synthetic": {
      const sides = [left, right].filter((run) => run.origin === "synthetic");
      return `applies to ${sides.map((run) => sideName(run, left)).join(", ")}`;
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Run summary card
// ---------------------------------------------------------------------------

function RunSummaryCard({ title, runId }: { title: string; runId: string | undefined }) {
  if (runId === undefined) {
    return (
      <Panel title={title}>
        <div className="eval-compare-run-card">
          <p className="eval-muted">No run selected yet — pick one above.</p>
        </div>
      </Panel>
    );
  }
  const run = getRun(runId);
  if (run === undefined) {
    const withdrawn = getWithdrawnRun(runId);
    return (
      <Panel title={title}>
        <div className="eval-compare-run-card">
          {withdrawn === undefined ? (
            <>
              <p className="eval-muted">
                <code className="eval-compare-mono">{runId}</code> is not a canonical run id.
              </p>
            </>
          ) : (
            <>
              <div className="eval-compare-chip-row">
                <span className="eval-compare-run-name">{withdrawn.runId}</span>
                <OriginTag origin={withdrawn.origin} />
                <span className="eval-compare-condition">withdrawn</span>
              </div>
              <p className="eval-muted">
                {withdrawn.withdrawal.notice} Reason: {withdrawn.withdrawal.reason} · withdrawn{" "}
                {withdrawn.withdrawal.withdrawnAt.slice(0, 10)}. Result bytes are removed; the
                identifier stays visible in history.
              </p>
            </>
          )}
        </div>
      </Panel>
    );
  }
  const model = getModel(run.modelId);
  const campaign = canonicalCampaigns.find((entry) => entry.campaignId === run.campaignId);
  const baseline = resolveBaselineRun(run);
  return (
    <Panel title={title}>
      <div className="eval-compare-run-card">
        <div className="eval-compare-run-heading">
          {model && <ModelAvatar model={model} />}
          <span>
            <span className="eval-compare-run-name">{model?.name ?? run.modelId}</span>{" "}
            <span className="eval-compare-run-sub">
              <code className="eval-compare-mono">{run.runId}</code> · {run.startedAt.slice(0, 10)}
            </span>
          </span>
          <OriginTag origin={run.origin} />
        </div>
        <div className="eval-compare-chip-row">
          <CoverageChip coverage={run.dispatchCoverage} />
          <span className="eval-compare-condition">grading {run.gradingCoverage}</span>
          <span className="eval-compare-condition">checks {run.checkSource}</span>
          <span className="eval-compare-condition">{run.caseBinding}</span>
          {run.withheldFields.map((field) => (
            <AvailabilityMark
              key={field.field}
              availability="withheld"
              reason={`${field.field} · ${field.reason}`}
            />
          ))}
        </div>
        <dl className="eval-compare-kv">
          <div>
            <dt>Headline</dt>
            <dd>
              <HeadlineValue headline={headlineFor(run)} />
            </dd>
          </div>
          <div>
            <dt>Configuration</dt>
            <dd>
              {run.configuration.availability === "pinned" ? (
                <code className="eval-compare-mono">
                  pin {shortSha(run.configuration.pinnedSha256)}
                </code>
              ) : (
                <AvailabilityMark availability="not_recorded" reason="labels-only configuration" />
              )}{" "}
              {run.configuration.candidate} · reasoning {run.configuration.reasoning ?? "unset"}
            </dd>
          </div>
          <div>
            <dt>Cohort</dt>
            <dd>{cohortLabel(run.cohort)}</dd>
          </div>
          <div>
            <dt>Campaign</dt>
            <dd title={campaign?.harness}>
              <code className="eval-compare-mono">{run.campaignId}</code>
            </dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>
              {run.provenance.sourceLabel}
              {baseline !== undefined && (
                <>
                  {" "}
                  · Sol baseline imported once as{" "}
                  <code className="eval-compare-mono">{baseline.runId}</code>
                </>
              )}
            </dd>
          </div>
        </dl>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Eligible comparison sections
// ---------------------------------------------------------------------------

const COUNT_ROWS: readonly { label: string; pick: (run: CanonicalRun) => number }[] = [
  { label: "planned", pick: (run) => run.counts.planned },
  { label: "started", pick: (run) => run.counts.started },
  { label: "completed", pick: (run) => run.counts.completed },
  { label: "timed out", pick: (run) => run.counts.timedOut },
  { label: "runtime failures", pick: (run) => run.counts.runtimeFailure },
  { label: "pending", pick: (run) => run.counts.pending },
  { label: "unstarted", pick: (run) => run.counts.unstarted },
  { label: "unknown", pick: (run) => run.counts.unknown },
  { label: "passed", pick: (run) => run.counts.passed },
  { label: "failed", pick: (run) => run.counts.failed },
  { label: "graded", pick: (run) => run.counts.graded },
];

function runtimeFailureNote(run: CanonicalRun): string | null {
  const failures = attemptsFor(run).filter((attempt) => attempt.execution === "runtime_failure");
  if (failures.length === 0) return null;
  return failures
    .map(
      (attempt) =>
        `${attempt.caseId} rep ${attempt.repetition} · ${attempt.failureAttribution ?? "unattributed"}`,
    )
    .join("; ");
}

function HeadlinePanel({ left, right }: { left: CanonicalRun; right: CanonicalRun }) {
  const leftModel = getModel(left.modelId);
  const rightModel = getModel(right.modelId);
  const leftHeadline = headlineFor(left);
  const rightHeadline = headlineFor(right);
  const delta = left.counts.passed - right.counts.passed;
  const sameDenominator =
    left.counts.started === right.counts.started &&
    leftHeadline.kind === "rate" &&
    rightHeadline.kind === "rate";
  return (
    <Panel
      title="Headline"
      description="Passes over started — the only ordering key — for each run. The delta is a pass-count difference over equal denominators, never an averaged rate."
    >
      <div className="eval-compare-headline-grid">
        <div className="eval-compare-headline-cell">
          <span className="eval-compare-run-name">{leftModel?.name ?? left.modelId}</span>
          <span className="eval-compare-headline-value">
            <HeadlineValue headline={leftHeadline} />
          </span>
          <span className="eval-muted">passes / started</span>
        </div>
        <div className="eval-compare-delta" aria-label="Pass difference">
          {sameDenominator ? (
            <>
              <span>
                Δ {delta === 0 ? "±0" : delta > 0 ? `+${delta}` : delta} pass
                {Math.abs(delta) === 1 ? "" : "es"}
              </span>
              <span className="eval-muted">
                of {numberFormatter.format(left.counts.started)} started each
              </span>
            </>
          ) : (
            <span className="eval-muted">
              denominators differ ({left.counts.started} vs {right.counts.started} started)
            </span>
          )}
        </div>
        <div className="eval-compare-headline-cell eval-compare-headline-cell-right">
          <span className="eval-compare-run-name">{rightModel?.name ?? right.modelId}</span>
          <span className="eval-compare-headline-value">
            <HeadlineValue headline={rightHeadline} />
          </span>
          <span className="eval-muted">passes / started</span>
        </div>
      </div>
    </Panel>
  );
}

function CoveragePanel({ left, right }: { left: CanonicalRun; right: CanonicalRun }) {
  const leftFailures = runtimeFailureNote(left);
  const rightFailures = runtimeFailureNote(right);
  return (
    <Panel
      title="Coverage & counts"
      description="Dispatch and grading coverage with the full attempt counts for each run."
    >
      <div className="eval-compare-table-wrap">
        <table className="eval-table eval-compare-table">
          <thead>
            <tr>
              <th scope="col">Count</th>
              <th scope="col">Left</th>
              <th scope="col">Right</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">dispatch coverage</th>
              <td>
                <CoverageChip coverage={left.dispatchCoverage} />
              </td>
              <td>
                <CoverageChip coverage={right.dispatchCoverage} />
              </td>
            </tr>
            <tr>
              <th scope="row">grading coverage</th>
              <td>
                <span className="eval-compare-condition">{left.gradingCoverage}</span>
              </td>
              <td>
                <span className="eval-compare-condition">{right.gradingCoverage}</span>
              </td>
            </tr>
            {COUNT_ROWS.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                <td className="lb-count">{numberFormatter.format(row.pick(left))}</td>
                <td className="lb-count">{numberFormatter.format(row.pick(right))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(leftFailures !== null || rightFailures !== null) && (
        <div className="eval-compare-run-card">
          <span className="eval-muted">
            runtime failures — left: {leftFailures ?? "none"} · right: {rightFailures ?? "none"}
          </span>
        </div>
      )}
    </Panel>
  );
}

const UNAVAILABLE_METRIC_ROWS: readonly {
  label: string;
  pick: (run: CanonicalRun) => MetricUnavailable;
}[] = [
  { label: "answer accuracy", pick: (run) => run.metrics.answerAccuracy },
  { label: "USD cost", pick: (run) => run.metrics.usdCost },
  { label: "uncertainty", pick: (run) => run.metrics.uncertainty },
];

function MetricsPanel({ left, right }: { left: CanonicalRun; right: CanonicalRun }) {
  return (
    <Panel
      title="Metrics"
      description="Run-level statistics; every value carries its sample count and population."
    >
      <div className="eval-compare-table-wrap">
        <table className="eval-table eval-compare-table">
          <thead>
            <tr>
              <th scope="col">Metric</th>
              <th scope="col">Left</th>
              <th scope="col">Right</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">latency (p50 · p95 · max)</th>
              <td>
                <LatencyValue metric={left.metrics.latencyMs} />
              </td>
              <td>
                <LatencyValue metric={right.metrics.latencyMs} />
              </td>
            </tr>
            <tr>
              <th scope="row">token usage</th>
              <td>
                <TokenUsageValue metric={left.metrics.tokenUsage} />
              </td>
              <td>
                <TokenUsageValue metric={right.metrics.tokenUsage} />
              </td>
            </tr>
            {UNAVAILABLE_METRIC_ROWS.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                {[left, right].map((run, index) => {
                  const metric = row.pick(run);
                  return (
                    <td key={index}>
                      <AvailabilityMark availability={metric.availability} reason={metric.reason} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Per-case outcome comparison
// ---------------------------------------------------------------------------

const EXECUTION_TEXT: Record<CanonicalAttempt["execution"], string> = {
  completed: "completed",
  timed_out: "timed out",
  runtime_failure: "runtime failure",
  pending: "pending",
  unstarted: "unstarted",
  unknown: "unknown",
};

function attemptLabel(attempt: CanonicalAttempt): string {
  const state =
    attempt.execution === "completed" ? attempt.verdict : EXECUTION_TEXT[attempt.execution];
  const attribution =
    attempt.execution === "runtime_failure" && attempt.failureAttribution
      ? ` (${attempt.failureAttribution})`
      : "";
  return `${attempt.caseId} rep ${attempt.repetition}: ${state}${attribution}`;
}

function AttemptOutcome({ attempt }: { attempt: CanonicalAttempt | undefined }) {
  if (attempt === undefined) {
    return <span className="eval-muted">—</span>;
  }
  return (
    <span className="eval-compare-rep" title={attemptLabel(attempt)}>
      <span className="eval-muted eval-compare-rep-num">r{attempt.repetition}</span>
      {attempt.execution === "completed" ? (
        <VerdictChip verdict={attempt.verdict} />
      ) : (
        <ExecutionChip
          execution={attempt.execution}
          failureAttribution={attempt.failureAttribution}
        />
      )}
    </span>
  );
}

interface CaseCompareRow {
  readonly caseId: string;
  readonly title: string;
  readonly category: string | undefined;
  readonly left: readonly (CanonicalAttempt | undefined)[];
  readonly right: readonly (CanonicalAttempt | undefined)[];
}

function caseCompareRows(left: CanonicalRun, right: CanonicalRun): readonly CaseCompareRow[] {
  const byCase = (run: CanonicalRun) => {
    const map = new Map<string, CanonicalAttempt[]>();
    for (const attempt of attemptsFor(run)) {
      const list = map.get(attempt.caseId) ?? [];
      list.push(attempt);
      map.set(attempt.caseId, list);
    }
    return map;
  };
  const leftMap = byCase(left);
  const rightMap = byCase(right);
  const definitionOrder = caseDefinitionsForFamily(left.family).map((def) => def.caseId);
  const seen = new Set<string>();
  const orderedIds = [
    ...definitionOrder,
    ...[...leftMap.keys(), ...rightMap.keys()].filter(
      (caseId) => !definitionOrder.includes(caseId),
    ),
  ];
  return orderedIds
    .filter((caseId) => {
      if (seen.has(caseId)) return false;
      seen.add(caseId);
      return true;
    })
    .map((caseId) => {
      const leftAttempts = leftMap.get(caseId) ?? [];
      const rightAttempts = rightMap.get(caseId) ?? [];
      const slots = Math.max(
        left.cohort.repetitions,
        right.cohort.repetitions,
        ...leftAttempts.map((attempt) => attempt.repetition),
        ...rightAttempts.map((attempt) => attempt.repetition),
      );
      const fill = (attempts: readonly CanonicalAttempt[]) =>
        Array.from({ length: slots }, (_, index) =>
          attempts.find((attempt) => attempt.repetition === index + 1),
        );
      const definition = getCaseDefinition(caseId);
      return {
        caseId,
        title: definition?.title ?? caseId,
        category: definition?.category,
        left: fill(leftAttempts),
        right: fill(rightAttempts),
      };
    });
}

function OutcomePanel({ left, right }: { left: CanonicalRun; right: CanonicalRun }) {
  const rows = caseCompareRows(left, right);
  const leftModel = getModel(left.modelId);
  const rightModel = getModel(right.modelId);
  return (
    <Panel
      title="Per-case outcomes"
      description="One row per case, repetition slots aligned across both runs. Missing slots render as —."
    >
      <div className="eval-compare-table-wrap">
        <table className="eval-table eval-compare-table">
          <thead>
            <tr>
              <th scope="col">Case</th>
              <th scope="col">Left — {leftModel?.name ?? left.modelId}</th>
              <th scope="col">Right — {rightModel?.name ?? right.modelId}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.caseId}>
                <th scope="row">
                  {row.title}
                  <div className="eval-compare-run-sub">
                    <code className="eval-compare-mono">{row.caseId}</code>
                    {row.category ? ` · ${row.category}` : ""}
                  </div>
                </th>
                <td>
                  <span className="eval-compare-rep-list">
                    {row.left.map((attempt, index) => (
                      <AttemptOutcome key={index} attempt={attempt} />
                    ))}
                  </span>
                </td>
                <td>
                  <span className="eval-compare-rep-list">
                    {row.right.map((attempt, index) => (
                      <AttemptOutcome key={index} attempt={attempt} />
                    ))}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Availability & provenance
// ---------------------------------------------------------------------------

const ATTEMPT_FIELDS: readonly {
  label: string;
  pick: (attempt: CanonicalAttempt) => Evidence<unknown>;
}[] = [
  { label: "checks", pick: (attempt) => attempt.checks },
  { label: "durationMs", pick: (attempt) => attempt.durationMs },
  { label: "wallDurationMs", pick: (attempt) => attempt.wallDurationMs },
  { label: "tokenUsage", pick: (attempt) => attempt.tokenUsage },
  { label: "answer", pick: (attempt) => attempt.answer },
  { label: "toolCalls", pick: (attempt) => attempt.toolCalls },
];

function attemptFieldAvailability(run: CanonicalRun): readonly string[] {
  if (run.attempts.availability !== "available") return [`attempts ${run.attempts.availability}`];
  const attempts = run.attempts.value;
  const lines: string[] = [];
  for (const field of ATTEMPT_FIELDS) {
    const counts = new Map<string, number>();
    for (const attempt of attempts) {
      const evidence = field.pick(attempt);
      const key =
        evidence.availability === "withheld"
          ? `withheld · ${evidence.reason}`
          : evidence.availability;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const parts = [...counts.entries()]
      .filter(([key]) => key !== "available")
      .map(([key, count]) => `${key} ×${count}`);
    if (parts.length > 0) lines.push(`${field.label}: ${parts.join(", ")}`);
  }
  return lines;
}

function SideFacts({ run }: { run: CanonicalRun }) {
  const publication = getPublication(run.runId);
  const currentRevision = publication?.revisions.find(
    (revision) => revision.revisionId === publication.currentRevisionId,
  );
  const artifactSha = shortSha(run.provenance.sourceArtifactSha256);
  const availability = attemptFieldAvailability(run);
  return (
    <div className="eval-compare-side">
      <h4>
        <code className="eval-compare-mono">{run.runId}</code>
      </h4>
      {availability.length > 0 && (
        <ul className="eval-compare-note-list" aria-label="Field availability">
          {availability.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {run.notes.length > 0 && (
        <ul className="eval-compare-note-list" aria-label="Run notes">
          {run.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
      <span className="eval-muted">
        source {run.provenance.sourceLabel}
        {artifactSha !== null ? (
          <>
            {" "}
            · sha <code className="eval-compare-mono">{artifactSha}</code>
          </>
        ) : (
          " · no source artifact retained"
        )}
        {run.provenance.sourceCommit !== "" && (
          <>
            {" "}
            · commit{" "}
            <code className="eval-compare-mono">{run.provenance.sourceCommit.slice(0, 7)}</code>
          </>
        )}
      </span>
      {publication !== undefined && (
        <span className="eval-muted">
          <code className="eval-compare-mono">{publication.publicationId}</code> ·{" "}
          {publication.status} · {publication.revisions.length} revision
          {publication.revisions.length === 1 ? "" : "s"}
          {currentRevision?.supersedes
            ? ` (r${currentRevision.revision} ${currentRevision.supersedes.reason})`
            : ""}
          {" · review: synthetic preview"}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function ComparePage({
  left,
  right,
  // Decision 9: synthetic runs never appear in the app's pickers — they exist
  // for Storybook state demos only, so stories pass includeSynthetic.
  includeSynthetic = false,
}: {
  left?: string;
  right?: string;
  includeSynthetic?: boolean;
}) {
  const route = useHashRoute();
  const scope = new URLSearchParams(route.split("?")[1] ?? "").get("cohort") ?? ALL_COHORTS;
  const cohortsInUse = useMemo(() => {
    const groups = new Map<string, { cohort: CanonicalCohort; runs: CanonicalRun[] }>();
    for (const run of canonicalRuns) {
      if (!includeSynthetic && run.origin !== "measured") continue;
      const group = groups.get(run.cohort.cohortId) ?? { cohort: run.cohort, runs: [] };
      group.runs.push(run);
      groups.set(run.cohort.cohortId, group);
    }
    return [...groups.values()];
  }, [includeSynthetic]);

  const scopedGroups =
    scope === ALL_COHORTS ? cohortsInUse : cohortsInUse.filter((g) => g.cohort.cohortId === scope);

  const leftRun = left === undefined ? undefined : getRun(left);
  const rightRun = right === undefined ? undefined : getRun(right);
  const eligibility =
    leftRun !== undefined && rightRun !== undefined
      ? compareEligibility(leftRun, rightRun)
      : undefined;
  const conditions = [
    ...(eligibility?.conditions ?? []),
    ...(leftRun !== undefined && leftRun.runId === rightRun?.runId
      ? ["same run selected on both sides"]
      : []),
  ];

  const picker = (side: "left" | "right", value: string | undefined) => (
    <div className="eval-compare-field">
      <label className="eval-compare-field-label" htmlFor={`eval-compare-${side}-picker`}>
        {side === "left" ? "Left run" : "Right run"}
      </label>
      <select
        id={`eval-compare-${side}-picker`}
        className="eval-compare-select"
        value={value ?? ""}
        onChange={(event) => {
          const selected = event.currentTarget.value || undefined;
          if (side === "left") navigate(comparePath(selected, right, scope));
          else navigate(comparePath(left, selected, scope));
        }}
      >
        <option value="">Select a run…</option>
        {scopedGroups.map((group) => (
          <optgroup key={group.cohort.cohortId} label={cohortLabel(group.cohort)}>
            {group.runs.map((run) => (
              <option key={run.runId} value={run.runId}>
                {runOptionLabel(run)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );

  return (
    <PageShell
      active="compare"
      footerNote="Run comparison over the canonical eval dataset; measured rows only."
    >
      <div className="eval-container eval-compare-page">
        <section className="eval-hero" aria-labelledby="compare-title">
          <p className="eval-eyebrow">Canonical eval browsing · Run comparison</p>
          <h1 className="eval-title" id="compare-title">
            Compare runs<span className="eval-dot">.</span>
          </h1>
          <p className="eval-description">
            Two runs side by side inside a shared cohort. Eligible pairs show headline, coverage,
            metrics and per-case outcomes with condition differences surfaced; ineligible pairs
            explain the reason codes and stay disabled.
          </p>
        </section>

        <Panel
          title="Pick two runs"
          description="Runs are grouped by cohort (suite, harness target, account class, repetitions, evidence category). Use the scope to narrow the list; picks outside the same cohort show their blocking reason."
        >
          <div className="eval-compare-scope">
            <label className="eval-compare-field-label" htmlFor="eval-compare-cohort-scope">
              Cohort scope
            </label>
            <select
              id="eval-compare-cohort-scope"
              className="eval-compare-select"
              value={scope}
              onChange={(event) => navigate(comparePath(left, right, event.currentTarget.value))}
            >
              <option value={ALL_COHORTS}>
                All cohorts — cross-cohort picks show why they block
              </option>
              {cohortsInUse.map((group) => (
                <option key={group.cohort.cohortId} value={group.cohort.cohortId}>
                  {cohortLabel(group.cohort)} · {group.runs.length} runs
                </option>
              ))}
            </select>
          </div>
          <div className="eval-compare-pickers">
            {picker("left", left)}
            <div className="eval-compare-picker-actions">
              <button
                type="button"
                className="eval-compare-button"
                aria-label="Swap left and right runs"
                onClick={() => navigate(comparePath(right, left, scope))}
              >
                <ArrowLeftRight size={13} aria-hidden="true" /> Swap
              </button>
              <button
                type="button"
                className="eval-compare-button"
                aria-label="Clear both run selections"
                onClick={() => navigate(comparePath(undefined, undefined, scope))}
              >
                <RotateCcw size={13} aria-hidden="true" /> Clear
              </button>
            </div>
            {picker("right", right)}
          </div>
          <div className="eval-compare-examples">
            <span className="eval-muted">Try a pair:</span>
            <ul>
              {includeSynthetic && (
                <li>
                  <a className="eval-text-link" href="#/compare?left=sol-spot-1&right=sol-spot-2">
                    sol-spot-1 vs sol-spot-2
                  </a>{" "}
                  — same model, eligible; reasoning medium vs high is a visible condition difference
                </li>
              )}
              <li>
                <a className="eval-text-link" href="#/compare?left=gpt55-spot-1&right=fable-spot-1">
                  gpt55-spot-1 vs fable-spot-1
                </a>{" "}
                — cross-model, eligible; checkSource native vs derived_from_scores is a condition,
                not a block
              </li>
              {includeSynthetic && (
                <li>
                  <a
                    className="eval-text-link"
                    href="#/compare?left=sol-spot-1&right=sol-spot-labels-only"
                  >
                    sol-spot-1 vs sol-spot-labels-only
                  </a>{" "}
                  — blocked: labels_only_configuration
                </li>
              )}
              <li>
                <a className="eval-text-link" href="#/compare?left=muse-spot-1&right=fable-spot-1">
                  muse-spot-1 vs fable-spot-1
                </a>{" "}
                — blocked: outside_selected_cohort (muse_cli vs omp_harness, same evidence category)
              </li>
              {includeSynthetic && (
                <li>
                  <a
                    className="eval-text-link"
                    href="#/compare?left=sol-spot-1&right=meridian-spot-1"
                  >
                    sol-spot-1 vs meridian-spot-1
                  </a>{" "}
                  — blocked: different_evidence_category (conformance vs answer_quality)
                </li>
              )}
              {includeSynthetic && (
                <li>
                  <a
                    className="eval-text-link"
                    href="#/compare?left=sol-spot-1&right=sol-spot-incomplete"
                  >
                    sol-spot-1 vs sol-spot-incomplete
                  </a>{" "}
                  — blocked: incomplete_coverage
                </li>
              )}
            </ul>
          </div>
        </Panel>

        <div className="eval-two-column eval-compare-section">
          <RunSummaryCard title="Left run" runId={left} />
          <RunSummaryCard title="Right run" runId={right} />
        </div>

        {eligibility !== undefined && leftRun !== undefined && rightRun !== undefined && (
          <Panel
            title={eligibility.eligible ? "Eligible comparison" : "Comparison unavailable"}
            description={
              eligibility.eligible
                ? "Same cohort — suite, fixture, catalog, target, account class, repetitions and evidence category all match."
                : "This pair is ineligible. Deltas and the per-case comparison stay disabled; the blocking reason codes are explained below."
            }
          >
            <div
              className={
                eligibility.eligible
                  ? "eval-compare-verdict"
                  : "eval-compare-verdict eval-compare-verdict-blocked"
              }
            >
              {eligibility.eligible ? (
                <div className="eval-compare-chip-row">
                  <span className="eval-score eval-score-positive">
                    <strong>same cohort</strong>
                  </span>
                  <code className="eval-compare-mono eval-muted">{leftRun.cohort.cohortId}</code>
                </div>
              ) : (
                <ul className="eval-compare-reason-list">
                  {eligibility.reasons.map((reason) => (
                    <li className="eval-compare-reason" key={reason}>
                      <span className="eval-compare-chip-row">
                        <span className="eval-compare-condition">{reason}</span>
                        <span>{eligibilityText(reason)}</span>
                      </span>
                      {reasonContext(reason, leftRun, rightRun) !== null && (
                        <span className="eval-muted">
                          {reasonContext(reason, leftRun, rightRun)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {conditions.length > 0 && (
                <ul className="eval-compare-conditions" aria-label="Condition differences">
                  {conditions.map((condition) => (
                    <li className="eval-compare-condition" key={condition}>
                      {condition}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Panel>
        )}

        {eligibility?.eligible === true && leftRun !== undefined && rightRun !== undefined && (
          <>
            <div className="eval-compare-section">
              <HeadlinePanel left={leftRun} right={rightRun} />
            </div>
            <div className="eval-compare-section">
              <CheckDimensionPanel
                fill={false}
                series={[
                  {
                    key: "left",
                    label: getModel(leftRun.modelId)?.name ?? leftRun.modelId,
                    dimensions: leftRun.dimensions,
                  },
                  {
                    key: "right",
                    label: getModel(rightRun.modelId)?.name ?? rightRun.modelId,
                    dimensions: rightRun.dimensions,
                  },
                ]}
              />
            </div>
            <div className="eval-compare-section">
              <CoveragePanel left={leftRun} right={rightRun} />
            </div>
            <div className="eval-compare-section">
              <MetricsPanel left={leftRun} right={rightRun} />
            </div>
            <div className="eval-compare-section">
              <OutcomePanel left={leftRun} right={rightRun} />
            </div>
            <Panel
              title="Availability & provenance"
              description="Withheld and missing evidence per run — withheld, not_retained, not_recorded and aggregate_only stay distinct — plus notes, sources and publication state."
            >
              <div className="eval-compare-side-grid">
                <SideFacts run={leftRun} />
                <SideFacts run={rightRun} />
              </div>
            </Panel>
          </>
        )}
      </div>
    </PageShell>
  );
}
