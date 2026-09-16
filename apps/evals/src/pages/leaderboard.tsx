import { Fragment, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { ModelAvatar, PageShell } from "../components/eval-ui";
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
  sortLeaderboardRows,
  unifiedLeaderboardRows,
  type LeaderboardMetric,
  type LeaderboardModelRow,
  type SummaryMetric,
} from "../canonical/selectors";

const defaultRows = unifiedLeaderboardRows();

const columns: readonly { metric: LeaderboardMetric; label: string; explanation: string }[] = [
  {
    metric: "overall",
    label: "Overall",
    explanation:
      "The average of Spot, Perps, and Predictions pass rates, with each category contributing one third. Requires complete coverage in all three categories.",
  },
  {
    metric: "Spot",
    label: "Spot",
    explanation:
      "Passed attempts divided by started attempts on spot-market tasks. Timeouts and run errors stay in the denominator.",
  },
  {
    metric: "Perps",
    label: "Perps",
    explanation:
      "Passed attempts divided by started attempts on perpetual-futures tasks. Timeouts and run errors stay in the denominator.",
  },
  {
    metric: "Predictions",
    label: "Predictions",
    explanation:
      "Passed attempts divided by started attempts on prediction-market tasks. Timeouts and run errors stay in the denominator.",
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
      "Recorded input and output tokens multiplied by the model’s published prices, divided by the attempts covered by those records across all three categories. A task here means one attempt. This is an estimate, not a bill.",
  },
];

function SummaryValue({
  metric,
  format,
}: {
  metric: SummaryMetric;
  format: (value: number) => string;
}) {
  return metric.availability === "available" ? (
    <>{format(metric.value)}</>
  ) : (
    <span title={metric.reason} aria-label={`Unavailable: ${metric.reason}`}>
      —
    </span>
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
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    new Set(initialExpandedModel ? [initialExpandedModel] : []),
  );
  const query = search.trim().toLocaleLowerCase();
  const shown = sortLeaderboardRows(
    rows.filter((row) =>
      `${row.model.name} ${row.model.provider}`.toLocaleLowerCase().includes(query),
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
          title="Model leaderboard"
          description="Compare model results on spot, perpetuals, and prediction-market tasks."
        >
          <p className="results-context">{benchmarkSummary(rows)}</p>
        </ResultsHeader>
        <div className="results-toolbar">
          <p className="results-explanation">
            Scores measure tool-use checks in these runs. Models used different clients; answer
            accuracy and trading returns were not evaluated.{" "}
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
        <div className="results-scroll" role="region" aria-label="Model leaderboard" tabIndex={0}>
          <table className="results-table leaderboard-table">
            <caption className="results-sr-only">
              Models sorted by {columns.find((col) => col.metric === metric)?.label},{" "}
              {direction === "desc" ? "descending" : "ascending"}. Missing values appear last.
            </caption>
            <thead>
              <tr>
                <th scope="col" className="results-sticky">
                  Model
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
                <Fragment key={row.model.id}>
                  <tr>
                    <th scope="row" className="results-sticky">
                      <div className="results-model">
                        <button
                          className="results-disclosure"
                          aria-label={`Run details for ${row.model.name}`}
                          aria-expanded={expanded.has(row.model.id)}
                          aria-controls={`runs-${row.model.id}`}
                          onClick={() => toggle(row.model.id)}
                        >
                          <ChevronDown size={16} />
                        </button>
                        <ModelAvatar model={row.model} />
                        <div>
                          <a href={`#/models/${row.model.id}`}>{row.model.name}</a>
                          {row.coverageLabel && <small>{row.coverageLabel}</small>}
                        </div>
                      </div>
                    </th>
                    <td className="results-overall">
                      {row.overall === null ? (
                        <span
                          aria-label={row.overallReason ?? "Unavailable"}
                          title={row.overallReason ?? undefined}
                        >
                          —
                        </span>
                      ) : (
                        percent(row.overall)
                      )}
                    </td>
                    {SCORED_FAMILIES.map((family) => (
                      <td key={family}>
                        {row.scores[family] === null ? (
                          <span
                            title={
                              row.runs[family] ? "Coverage incomplete or unknown" : "Not evaluated"
                            }
                          >
                            —
                          </span>
                        ) : (
                          <a
                            className="results-score-link"
                            href={`#/tasks?category=${family}&model=${row.model.id}`}
                          >
                            {percent(row.scores[family])}
                          </a>
                        )}
                      </td>
                    ))}
                    <td>
                      <SummaryValue metric={row.averageTime} format={seconds} />
                    </td>
                    <td>
                      <SummaryValue metric={row.estimatedCost} format={dollars} />
                    </td>
                  </tr>
                  <tr
                    hidden={!expanded.has(row.model.id)}
                    id={`runs-${row.model.id}`}
                    className="results-expanded"
                  >
                    <td colSpan={7}>
                      <div className="results-detail-body">
                        <h2>{row.model.name}: run details</h2>
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
          Time covers completed attempts. Cost estimates cover recorded token usage; failed and
          timed-out attempts may be excluded. Open a row for counts and sources.
        </p>
        <p className="results-footnote">
          These are small samples. Differences in scores do not establish statistical significance.
        </p>
      </div>
    </PageShell>
  );
}
