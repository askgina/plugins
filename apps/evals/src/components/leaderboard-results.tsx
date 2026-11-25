import type { CSSProperties, MouseEvent } from "react";
import type { CanonicalRun } from "../canonical/canonical";
import {
  processingProgress,
  recordedOutcomes,
  type LeaderboardMetric,
  type LeaderboardModelRow,
  type SummaryMetric,
} from "../canonical/selectors";
import { dollars, percent, seconds } from "./results-ui";
import { ModelAvatar } from "./eval-ui";
import { recordedBudgetLabel } from "../canonical/selectors";

export const rowKey = (row: LeaderboardModelRow) =>
  row.rowId ??
  (Object.values(row.runs)
    .map((run) => run.runId)
    .sort()
    .join("+") ||
    row.model.id);
export const rowLabel = (row: LeaderboardModelRow) =>
  `${row.model.name}, ${row.configurationLabel ?? "recorded setting"}, ${Object.values(row.runs)[0]?.startedAt.slice(0, 10) ?? "undated"}`;

export function modelRowHref(row: LeaderboardModelRow) {
  const run = row.runs.Spot ?? Object.values(row.runs)[0];
  return `#/models/${row.model.id}${run ? `?run=${encodeURIComponent(run.runId)}` : ""}`;
}

export function followModelRow(event: MouseEvent<HTMLElement>, row: LeaderboardModelRow) {
  if (event.target instanceof Element && event.target.closest("a,button,input,select,summary"))
    return;
  if (window.getSelection()?.toString()) return;
  if (event.button !== 0) return;
  const href = modelRowHref(row);
  if (event.metaKey || event.ctrlKey || event.shiftKey)
    window.open(href, "_blank", "noopener,noreferrer");
  else window.location.hash = href.slice(1);
}

export function rowMetricValue(row: LeaderboardModelRow, metric: LeaderboardMetric) {
  if (metric === "overall") return row.overall;
  if (metric === "cost" || metric === "time") {
    const summary = metric === "cost" ? row.estimatedCost : row.averageTime;
    return summary.availability === "available" ? summary.value : null;
  }
  return row.scores[metric];
}

export function RowIdentity({
  row,
  compact = false,
}: {
  row: LeaderboardModelRow;
  compact?: boolean;
}) {
  const runs = Object.values(row.runs);
  const recovery = runs.some((run) => run.recovery);
  const budget = recordedBudgetLabel(runs);
  return (
    <div className="lb-identity">
      <ModelAvatar model={row.model} />
      <div>
        <a href={modelRowHref(row)}>{row.model.name}</a>
        <small>
          {compact
            ? (row.configurationLabel?.replace(" reasoning", "") ?? "Recorded setting")
            : (row.configurationLabel ?? "Recorded setting")}
          {recovery && (
            <span className="lb-record-flag" title={budget}>
              {!compact && budget.includes(" / ") ? " · Recovery · mixed budgets" : " · Recovery"}
            </span>
          )}
          {row.coverageLabel && <span className="lb-record-flag"> · {row.coverageLabel}</span>}
        </small>
        <span className="results-sr-only">
          {runs[0]?.startedAt.slice(0, 10)} · {recovery ? "Recovery · " : ""}
          {budget} · {runs[0]?.cohort.repetitions} reps
        </span>
      </div>
    </div>
  );
}

export function CompactScore({
  row,
  metric = "overall",
}: {
  row: LeaderboardModelRow;
  metric?: LeaderboardMetric;
}) {
  const value = rowMetricValue(row, metric);
  if (metric === "time" || metric === "cost") {
    const summary = metric === "cost" ? row.estimatedCost : row.averageTime;
    return (
      <span className="lb-compact-value">
        <span>
          {value === null
            ? summary.availability === "unavailable" && summary.reason.includes("not published")
              ? "Not published"
              : "Not recorded"
            : metric === "cost"
              ? dollars(value)
              : seconds(value)}
        </span>
        {summary.availability === "available" ? (
          <>
            {metric === "cost" && value === 0 && <small>Free model tier</small>}
            {summary.excluded > 0 && <small>{summary.excluded} excluded</small>}
            <span className="results-sr-only">
              {summary.sampleCount} attempts · {summary.excluded} excluded. {summary.detail}
            </span>
          </>
        ) : (
          <span className="results-sr-only">{summary.reason}</span>
        )}
      </span>
    );
  }
  const runs =
    metric === "overall" ? Object.values(row.runs) : row.runs[metric] ? [row.runs[metric]!] : [];
  const counts = recordedOutcomes(runs);
  const progress = processingProgress(runs);
  const reason = !runs.length
    ? "Not evaluated"
    : metric === "overall" && runs.length < 3
      ? "Partial coverage"
      : !progress.complete
        ? "Incomplete"
        : "Unavailable";
  const interruptions = [
    counts.timedOut ? `${counts.timedOut} timed out` : "",
    counts.runtimeFailure ? `${counts.runtimeFailure} run errors` : "",
    counts.pending ? `${counts.pending} pending` : "",
    counts.unstarted ? `${counts.unstarted} not started` : "",
    counts.unknown ? `${counts.unknown} unknown` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span className="lb-compact-value" data-score-available={value !== null}>
      <span>{value === null ? reason : percent(value)}</span>
      {value !== null && counts.graded < counts.planned && (
        <small aria-hidden="true">{counts.planned - counts.graded} ungraded</small>
      )}
      {metric === "overall" && value !== null && (
        <span
          className="lb-score-track"
          aria-hidden="true"
          style={{ "--lb-score": `${value * 100}%` } as CSSProperties}
        />
      )}
      <span className="results-sr-only">
        {progress.complete ? "Completed · " : ""}
        {progress.processed}/{progress.planned} processed · {counts.graded}/{counts.planned} graded
        · {counts.passed} passed · {counts.failed} failed
        {interruptions ? ` · ${interruptions}` : ""}
        {value !== null && counts.graded < counts.planned
          ? ` · ${counts.planned - counts.graded} ungraded · zero credit`
          : ""}
        {value === null && metric === "overall" ? ` · ${row.overallReason ?? reason}` : ""}
      </span>
    </span>
  );
}

export const columns: readonly { metric: LeaderboardMetric; label: string; explanation: string }[] =
  [
    {
      metric: "overall",
      label: "Overall",
      explanation:
        "End-to-end success: average the Spot, Perps and Predictions scores equally. Each category divides verified passes by all planned trials. Timeouts, execution errors and terminal ungraded trials earn zero credit. Every planned trial must finish processing before a score is shown.",
    },
    {
      metric: "Spot",
      label: "Spot",
      explanation:
        "Verified passes divided by all planned spot-market trials. Timeouts, execution errors and terminal ungraded trials earn zero credit. Unfinished runs have no score.",
    },
    {
      metric: "Perps",
      label: "Perps",
      explanation:
        "Verified passes divided by all planned perpetual-futures trials. Timeouts, execution errors and terminal ungraded trials earn zero credit. Unfinished runs have no score.",
    },
    {
      metric: "Predictions",
      label: "Predictions",
      explanation:
        "Verified passes divided by all planned prediction-market trials. Timeouts, execution errors and terminal ungraded trials earn zero credit. Unfinished runs have no score.",
    },
    {
      metric: "time",
      label: "Avg. time",
      explanation:
        "Arithmetic mean of completed-attempt durations across all three categories, in seconds. Unavailable if any completed attempt lacks a timing. This is not the median and excludes timeouts and run errors.",
    },
    {
      metric: "cost",
      label: "Est. cost / task",
      explanation:
        "Recorded token usage priced using recorded client estimates, Devin’s retained model catalogue, or Meta’s published API rates. Includes cache discounts. The denominator is completed attempts with cost records; exclusions are shown. SWE-2 is listed as Free by Devin. These are estimates, not bills or subscription charges.",
    },
  ];

export function SummaryValue({
  metric,
  format,
  cost = false,
  scope,
}: {
  metric: SummaryMetric;
  format: (value: number) => string;
  cost?: boolean;
  scope?: string;
}) {
  return metric.availability === "available" ? (
    <span className="results-cost-value" title={metric.detail}>
      {format(metric.value)}
      {cost && metric.value === 0 && <small>Free model tier</small>}
      {cost && scope && <small>{scope}</small>}
      <small>
        {metric.sampleCount} attempts · {metric.excluded} excluded
      </small>
    </span>
  ) : (
    <span title={metric.reason} aria-label={`Unavailable: ${metric.reason}`}>
      {cost
        ? metric.reason.includes("not published")
          ? "Not published"
          : "Not recorded"
        : "No timing"}
    </span>
  );
}

export function CoverageNote({ label, metric }: { label: string; metric: SummaryMetric }) {
  return (
    <p>
      <strong>{label}: </strong>
      {metric.availability === "available"
        ? `${metric.sampleCount} attempts included; ${metric.excluded} started attempts excluded. ${metric.detail ?? ""}`
        : metric.reason}
    </p>
  );
}

export function RecordedResult({
  runs,
  score,
  href,
  overall = false,
  reason,
}: {
  runs: readonly CanonicalRun[];
  score: number | null;
  href?: string;
  overall?: boolean;
  reason?: string | null;
}) {
  if (runs.length === 0) return <span>Not evaluated</span>;
  const counts = recordedOutcomes(runs);
  const progress = processingProgress(runs);
  const hasRate = score !== null;
  const value =
    score !== null
      ? percent(score)
      : overall
        ? "Score unavailable"
        : `${counts.passed} passed · ${counts.failed} failed`;
  const interruptions = [
    counts.timedOut > 0 ? `${counts.timedOut} timed out` : "",
    counts.runtimeFailure > 0 ? `${counts.runtimeFailure} run errors` : "",
    counts.pending > 0 ? `${counts.pending} pending` : "",
    counts.unstarted > 0 ? `${counts.unstarted} not started` : "",
    counts.unknown > 0 ? `${counts.unknown} unknown` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="results-outcome-value">
      {href ? (
        <a className="results-score-link" href={href}>
          {value}
        </a>
      ) : (
        <span>{value}</span>
      )}
      {hasRate && counts.graded < counts.planned && (
        <small>{`${counts.planned - counts.graded} ungraded · zero credit`}</small>
      )}
      {overall && (
        <small>{`${progress.complete ? "Completed · " : ""}${progress.processed}/${progress.planned} processed`}</small>
      )}
      <small className={hasRate || overall ? "results-pass-fail" : undefined}>
        {hasRate || overall
          ? `${counts.passed} passed · ${counts.failed} failed`
          : `${counts.graded}/${counts.planned} graded`}
      </small>
      {(hasRate || overall) && <small>{`${counts.graded}/${counts.planned} graded`}</small>}
      {interruptions && <small>{interruptions}</small>}
      {score === null && overall && (
        <small className="results-eligibility">
          Not ranked ·{" "}
          {runs.length < 3
            ? "partial coverage"
            : counts.graded < counts.planned
              ? `${counts.planned - counts.graded} ungraded`
              : (reason ?? "not eligible")}
        </small>
      )}
    </div>
  );
}
