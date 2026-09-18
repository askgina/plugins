import type { CanonicalRun } from "../canonical/canonical";
import {
  recordedOutcomes,
  type LeaderboardMetric,
  type LeaderboardModelRow,
  type SummaryMetric,
} from "../canonical/selectors";
import { percent } from "./results-ui";

export const rowKey = (row: LeaderboardModelRow) =>
  row.rowId ??
  (Object.values(row.runs)
    .map((run) => run.runId)
    .sort()
    .join("+") ||
    row.model.id);
export const rowLabel = (row: LeaderboardModelRow) =>
  `${row.model.name}, ${row.configurationLabel ?? "recorded setting"}, ${Object.values(row.runs)[0]?.startedAt.slice(0, 10) ?? "undated"}`;

export const columns: readonly { metric: LeaderboardMetric; label: string; explanation: string }[] =
  [
    {
      metric: "overall",
      label: "Overall",
      explanation:
        "The average of Spot, Perps, and Predictions pass rates, with each category contributing one third. Requires complete dispatch and grading in all three categories.",
    },
    {
      metric: "Spot",
      label: "Spot",
      explanation:
        "Passed attempts divided by started attempts on spot-market tasks. Shown only with complete dispatch and grading. Timeouts and run errors remain unscored.",
    },
    {
      metric: "Perps",
      label: "Perps",
      explanation:
        "Passed attempts divided by started attempts on perpetual-futures tasks. Shown only with complete dispatch and grading. Timeouts and run errors remain unscored.",
    },
    {
      metric: "Predictions",
      label: "Predictions",
      explanation:
        "Passed attempts divided by started attempts on prediction-market tasks. Shown only with complete dispatch and grading. Timeouts and run errors remain unscored.",
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
        "Recorded token usage priced using OMP’s client estimates, Devin’s retained model catalogue, or Meta’s published API rates. Includes cache discounts. The denominator is completed attempts with cost records; exclusions are shown. SWE-2 is listed as Free by Devin. These are estimates, not bills or subscription charges.",
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
  const value =
    score !== null
      ? percent(score)
      : overall
        ? `${counts.graded}/${counts.planned} graded`
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
      <small>
        {score !== null || overall
          ? `${counts.passed} passed · ${counts.failed} failed`
          : `${counts.graded}/${counts.planned} graded`}
      </small>
      {score !== null && (
        <small>
          {counts.graded}/{counts.planned} graded
        </small>
      )}
      {interruptions && <small>{interruptions}</small>}
      {score === null && overall && (
        <small className="results-eligibility">
          Not ranked ·{" "}
          {runs.length < 3
            ? "partial coverage"
            : counts.graded < counts.planned
              ? "grading incomplete"
              : (reason ?? "not eligible")}
        </small>
      )}
    </div>
  );
}
