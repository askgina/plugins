import { Fragment, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { ModelAvatar, PageShell } from "../components/eval-ui";
import { canonicalCampaigns, type CanonicalRun } from "../canonical/canonical";
import {
  InfoPopover,
  ResultsHeader,
  RunDetails,
  dollars,
  percent,
  seconds,
} from "../components/results-ui";
import {
  SCORED_FAMILIES,
  benchmarkSummary,
  configurationLeaderboardRows,
  recordedOutcomes,
  sortLeaderboardRows,
  type LeaderboardMetric,
  type LeaderboardModelRow,
  type SummaryMetric,
} from "../canonical/selectors";

const defaultRows = configurationLeaderboardRows();
const rowKey = (row: LeaderboardModelRow) => row.rowId ?? row.model.id;

const columns: readonly { metric: LeaderboardMetric; label: string; explanation: string }[] = [
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
      "Passed attempts divided by started attempts on spot-market tasks, shown only with complete dispatch and grading. Unscored attempts are not quality failures.",
  },
  {
    metric: "Perps",
    label: "Perps",
    explanation:
      "Passed attempts divided by started attempts on perpetual-futures tasks, shown only with complete dispatch and grading. Unscored attempts are not quality failures.",
  },
  {
    metric: "Predictions",
    label: "Predictions",
    explanation:
      "Passed attempts divided by started attempts on prediction-market tasks, shown only with complete dispatch and grading. Unscored attempts are not quality failures.",
  },
  {
    metric: "time",
    label: "Avg. time",
    explanation:
      "Arithmetic mean of recorded completed-attempt durations across all three categories. Shown even when other attempts timed out or errored; the sample count tells you how many are included. This is not the median.",
  },
  {
    metric: "cost",
    label: "Est. cost / task",
    explanation:
      "Recorded input and output tokens multiplied by the model’s published prices, divided by the attempts covered by those records across all three categories. A task here means one attempt. This is an estimate, not a bill.",
  },
];

function SummaryValue({
  metric,
  format,
  kind,
}: {
  metric: SummaryMetric;
  format: (value: number) => string;
  kind: "time" | "cost";
}) {
  return metric.availability === "available" ? (
    <span className="results-value-stack">
      <span>{format(metric.value)}</span>
      <small>{metric.sampleCount} attempts measured</small>
      {metric.excluded > 0 && <small>{metric.excluded} excluded</small>}
    </span>
  ) : (
    <span
      className="results-unavailable"
      title={metric.reason}
      aria-label={`Unavailable: ${metric.reason}`}
    >
      {metric.reason.includes("price")
        ? "Price unavailable"
        : metric.reason.includes("all three")
          ? "Partial coverage"
          : kind === "time"
            ? "No timing"
            : "No cost estimate"}
    </span>
  );
}

function RecordedResult({
  runs,
  score,
  href,
  overall = false,
}: {
  runs: readonly CanonicalRun[];
  score: number | null;
  href?: string;
  overall?: boolean;
}) {
  if (!runs.length) return <span className="results-unavailable">Not evaluated</span>;
  const counts = recordedOutcomes(runs);
  const interruptions = [
    counts.timedOut > 0 ? `${counts.timedOut} timed out` : "",
    counts.runtimeFailure > 0
      ? `${counts.runtimeFailure} run error${counts.runtimeFailure === 1 ? "" : "s"}`
      : "",
    counts.pending > 0 ? `${counts.pending} pending` : "",
    counts.unstarted > 0 ? `${counts.unstarted} not started` : "",
    counts.unknown > 0 ? `${counts.unknown} unknown` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const value =
    score !== null
      ? percent(score)
      : overall
        ? `${counts.graded}/${counts.planned} graded`
        : `${counts.passed} passed · ${counts.failed} failed`;
  return (
    <div className={`results-value-stack ${score === null ? "results-partial" : ""}`}>
      {href ? (
        <a className="results-score-link" href={href}>
          {value}
        </a>
      ) : (
        <span>{value}</span>
      )}
      {score !== null || overall ? (
        <small>
          {counts.passed} passed · {counts.failed} failed
        </small>
      ) : (
        <small>
          {counts.graded}/{counts.planned} graded
        </small>
      )}
      {interruptions && <small className="results-interruption">{interruptions}</small>}
      {score === null && overall && (
        <small>Not ranked{runs.length < 3 ? " · partial coverage" : ""}</small>
      )}
    </div>
  );
}

function CoverageNote({ label, metric }: { label: string; metric: SummaryMetric }) {
  return (
    <p>
      <strong>{label}: </strong>
      {metric.availability === "available"
        ? `${metric.sampleCount} attempts included; ${metric.excluded} started attempts excluded.`
        : metric.reason}
    </p>
  );
}

export function LeaderboardPage({
  initialSearch = "",
  initialExpandedModel,
  rows = defaultRows,
}: {
  initialSearch?: string;
  initialExpandedModel?: string;
  /** Storybook can supply derived summaries; the app always uses measured current data. */
  rows?: readonly LeaderboardModelRow[];
}) {
  const [search, setSearch] = useState(initialSearch);
  const [metric, setMetric] = useState<LeaderboardMetric>("overall");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const campaigns = canonicalCampaigns
    .filter((campaign) => rows.some((row) => row.campaignId === campaign.campaignId))
    .sort((a, b) => b.date.localeCompare(a.date));
  const [campaignId, setCampaignId] = useState(campaigns[0]?.campaignId ?? "all");
  const [grading, setGrading] = useState("all");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    new Set(rows.filter((row) => row.model.id === initialExpandedModel).map(rowKey)),
  );
  const query = search.trim().toLocaleLowerCase();
  const campaignRows = rows.filter((row) => campaignId === "all" || row.campaignId === campaignId);
  const completeCount = campaignRows.filter((row) => row.overall !== null).length;
  const totals = recordedOutcomes(campaignRows.flatMap((row) => Object.values(row.runs)));
  const shown = sortLeaderboardRows(
    campaignRows.filter(
      (row) =>
        `${row.model.name} ${row.model.provider} ${row.configurationLabel ?? ""}`
          .toLocaleLowerCase()
          .includes(query) &&
        (grading === "all" ||
          (grading === "complete" ? row.overall !== null : row.overall === null)),
    ),
    metric,
    direction,
  );
  function sort(next: LeaderboardMetric) {
    setMetric(next);
    setDirection(
      next === metric
        ? direction === "desc"
          ? "asc"
          : "desc"
        : next === "time" || next === "cost"
          ? "asc"
          : "desc",
    );
  }
  function toggle(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  return (
    <PageShell active="leaderboard">
      <div className="eval-container results-page">
        <ResultsHeader
          title="Gina Model Leaderboard"
          description="Compare model results on spot, perpetuals, and prediction-market tasks."
        >
          <p className="results-context">{benchmarkSummary(campaignRows)}</p>
        </ResultsHeader>
        <div className="results-toolbar">
          <p className="results-explanation">
            Each row is a recorded model and reasoning setting. Scores require complete grading;
            other rows show the recorded passes, failures, timeouts, and run errors.{" "}
            <a href="#/methodology">Methodology ↗</a>
          </p>
          <label className="results-search">
            <Search size={17} aria-hidden="true" />
            <span className="results-sr-only">Search models or providers</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search models"
            />
          </label>
        </div>
        <div className="results-filters">
          {campaigns.length > 0 && (
            <label>
              Campaign
              <select value={campaignId} onChange={(event) => setCampaignId(event.target.value)}>
                {campaigns.map((campaign) => (
                  <option key={campaign.campaignId} value={campaign.campaignId}>
                    {campaign.date} ·{" "}
                    {campaign.campaignId.startsWith("reasoning-sweep")
                      ? "Reasoning sweep"
                      : campaign.harness}
                  </option>
                ))}
                <option value="all">All recorded campaigns</option>
              </select>
            </label>
          )}
          <label>
            Grading
            <select value={grading} onChange={(event) => setGrading(event.target.value)}>
              <option value="all">All results ({campaignRows.length})</option>
              <option value="complete">Complete grading ({completeCount})</option>
              <option value="partial">
                Needs completion ({campaignRows.length - completeCount})
              </option>
            </select>
          </label>
          <p role="status">
            {totals.graded.toLocaleString()} / {totals.planned.toLocaleString()} attempts graded
            <br />
            <strong>{completeCount} configurations fully graded</strong>
            {totals.started > totals.graded && (
              <> · {(totals.started - totals.graded).toLocaleString()} attempts unscored</>
            )}
          </p>
        </div>
        <div
          className="results-scroll"
          role="region"
          aria-label="Gina Model Leaderboard"
          tabIndex={0}
        >
          <table className="results-table leaderboard-table">
            <caption className="results-sr-only">
              Models sorted by {columns.find((col) => col.metric === metric)?.label},{" "}
              {direction === "desc" ? "descending" : "ascending"}. Missing values appear last.
            </caption>
            <thead>
              <tr>
                <th scope="col" className="results-sticky">
                  Model / reasoning
                </th>
                {columns.map((column) => (
                  <th
                    key={column.metric}
                    scope="col"
                    aria-sort={
                      metric === column.metric
                        ? direction === "desc"
                          ? "descending"
                          : "ascending"
                        : "none"
                    }
                  >
                    <div className="results-column-label">
                      <button className="results-sort" onClick={() => sort(column.metric)}>
                        {column.label}
                        <span aria-hidden="true">
                          {metric === column.metric ? (direction === "desc" ? "↓" : "↑") : "↕"}
                        </span>
                      </button>
                      <InfoPopover label={`About ${column.label}`}>
                        <p>{column.explanation}</p>
                      </InfoPopover>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <Fragment key={rowKey(row)}>
                  <tr>
                    <th scope="row" className="results-sticky">
                      <div className="results-model">
                        <button
                          className="results-disclosure"
                          aria-label={`Run details for ${row.model.name}${row.configurationLabel ? `, ${row.configurationLabel}` : ""}`}
                          aria-expanded={expanded.has(rowKey(row))}
                          aria-controls={`runs-${rowKey(row)}`}
                          onClick={() => toggle(rowKey(row))}
                        >
                          <ChevronDown size={16} />
                        </button>
                        <ModelAvatar model={row.model} />
                        <div>
                          <a href={`#/models/${row.model.id}`}>{row.model.name}</a>
                          {row.configurationLabel && <small>{row.configurationLabel}</small>}
                          {row.coverageLabel && <small>{row.coverageLabel}</small>}
                        </div>
                      </div>
                    </th>
                    <td className="results-overall">
                      <RecordedResult runs={Object.values(row.runs)} score={row.overall} overall />
                    </td>
                    {SCORED_FAMILIES.map((family) => {
                      const run = row.runs[family];
                      return (
                        <td key={family}>
                          <RecordedResult
                            runs={run ? [run] : []}
                            score={row.scores[family]}
                            href={
                              run
                                ? `#/tasks?category=${family}&model=${row.model.id}&run=${encodeURIComponent(run.runId)}`
                                : undefined
                            }
                          />
                        </td>
                      );
                    })}
                    <td>
                      <SummaryValue metric={row.averageTime} format={seconds} kind="time" />
                    </td>
                    <td>
                      <SummaryValue metric={row.estimatedCost} format={dollars} kind="cost" />
                    </td>
                  </tr>
                  <tr
                    hidden={!expanded.has(rowKey(row))}
                    id={`runs-${rowKey(row)}`}
                    className="results-expanded"
                  >
                    <td colSpan={7}>
                      <div className="results-detail-body">
                        <h2>
                          {row.model.name}: {row.configurationLabel ?? "run details"}
                        </h2>
                        {row.overallReason && <p>{row.overallReason}</p>}
                        <div className="results-coverage">
                          <CoverageNote label="Average time" metric={row.averageTime} />
                          <CoverageNote label="Estimated cost" metric={row.estimatedCost} />
                        </div>
                        {SCORED_FAMILIES.map((family) =>
                          row.runs[family] ? (
                            <RunDetails key={family} run={row.runs[family]} />
                          ) : null,
                        )}
                      </div>
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        {shown.length === 0 && (
          <div className="results-empty" role="status">
            <h2>No matching models</h2>
            <p>Try a model name or provider.</p>
            <button onClick={() => setSearch("")}>Clear search</button>
          </div>
        )}
        <p className="results-footnote">
          Time covers completed attempts, including graded failures. Timeouts and run errors are
          excluded from the timing sample. Missing prices are labelled explicitly. Open a row for
          sources.
        </p>
        <p className="results-footnote">
          These are small samples. Differences in scores do not establish statistical significance.
        </p>
      </div>
    </PageShell>
  );
}
