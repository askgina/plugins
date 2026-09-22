import type { CanonicalRun } from "../canonical/canonical";
import {
  gradedOnlyScore,
  processingProgress,
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
        "The average of Spot, Perps, and Predictions pass rates, with each category contributing one third. Ranked scores require complete dispatch and grading. Graded-only percentages use available verdicts in each category, exclude ungraded trials, and remain provisional and unranked.",
    },
    {
      metric: "Spot",
      label: "Spot",
      explanation:
        "Passed attempts divided by started attempts on spot-market tasks. Graded-only percentages divide by graded attempts instead and remain provisional. Timeouts and run errors remain unscored.",
    },
    {
      metric: "Perps",
      label: "Perps",
      explanation:
        "Passed attempts divided by started attempts on perpetual-futures tasks. Graded-only percentages divide by graded attempts instead and remain provisional. Timeouts and run errors remain unscored.",
    },
    {
      metric: "Predictions",
      label: "Predictions",
      explanation:
        "Passed attempts divided by started attempts on prediction-market tasks. Graded-only percentages divide by graded attempts instead and remain provisional. Timeouts and run errors remain unscored.",
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
  const provisional = score === null ? gradedOnlyScore(runs, overall) : null;
  const hasRate = score !== null || provisional !== null;
  const value =
    score !== null
      ? percent(score)
      : provisional !== null
        ? percent(provisional)
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
      {provisional !== null && (
        <small title="Excludes ungraded trials; unavailable for quality rankings.">
          Provisional · graded-only
        </small>
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
