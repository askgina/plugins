import { Fragment, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { LeaderboardScatter } from "../components/leaderboard-scatter";
import { LeaderboardConversations } from "../components/leaderboard-conversations";
import { ModelAvatar, PageShell } from "../components/eval-ui";
import type { CanonicalRun } from "../canonical/canonical";
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
  unifiedLeaderboardRows,
  type LeaderboardMetric,
  type LeaderboardModelRow,
  type SummaryMetric,
} from "../canonical/selectors";

const configurations = [...configurationLeaderboardRows()].sort((a, b) =>
  (Object.values(b.runs)[0]?.startedAt ?? "").localeCompare(
    Object.values(a.runs)[0]?.startedAt ?? "",
  ),
);
const latestCampaignConfigurations = configurations.filter(
  (row) => row.campaignId === configurations[0]?.campaignId,
);
const defaultRows = unifiedLeaderboardRows().map(
  (row) =>
    configurations.find(
      (configuration) =>
        configuration.model.id === row.model.id &&
        SCORED_FAMILIES.every(
          (family) => configuration.runs[family]?.runId === row.runs[family]?.runId,
        ),
    ) ?? row,
);

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

function SummaryValue({
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
    <span className={cost ? "results-cost-value" : undefined} title={metric.detail}>
      {format(metric.value)}
      {cost && metric.value === 0 && <small>Free model tier</small>}
      {cost && scope && <small>{scope}</small>}
      {cost && (
        <small>
          {metric.sampleCount} attempts · {metric.excluded} excluded
        </small>
      )}
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

function CoverageNote({ label, metric }: { label: string; metric: SummaryMetric }) {
  return (
    <p>
      <strong>{label}: </strong>
      {metric.availability === "available"
        ? `${metric.sampleCount} attempts included; ${metric.excluded} started attempts excluded. ${metric.detail ?? ""}`
        : metric.reason}
    </p>
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
      {interruptions && <small>{interruptions}</small>}
      {score === null && overall && (
        <small>Not ranked · {runs.length < 3 ? "partial coverage" : "grading incomplete"}</small>
      )}
    </div>
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
  const [selectedConfigurations, setSelectedConfigurations] = useState<
    Readonly<Record<string, string>>
  >({});
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    new Set(initialExpandedModel ? [initialExpandedModel] : []),
  );
  const [chatModels, setChatModels] = useState<ReadonlySet<string>>(new Set());
  function setChatOpen(id: string, open: boolean) {
    setChatModels((current) => {
      if (current.has(id) === open) return current;
      const next = new Set(current);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  const query = search.trim().toLocaleLowerCase();
  const activeRows = rows.map(
    (row) =>
      (rows === defaultRows
        ? configurations.find(
            (configuration) =>
              configuration.model.id === row.model.id &&
              configuration.rowId === selectedConfigurations[row.model.id],
          )
        : undefined) ?? row,
  );
  const shown = sortLeaderboardRows(
    activeRows.filter((row) =>
      `${row.model.name} ${row.model.provider}`.toLocaleLowerCase().includes(query),
    ),
    metric,
    direction,
  );
  const chartRows = (rows === defaultRows ? latestCampaignConfigurations : rows).filter((row) =>
    `${row.model.name} ${row.model.provider}`.toLocaleLowerCase().includes(query),
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
          <p className="results-context">{benchmarkSummary(activeRows)}</p>
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
                          {import.meta.env.DEV && (
                            <button
                              type="button"
                              className="results-chat-trigger"
                              aria-label={`Chat transcripts for ${row.model.name}`}
                              aria-expanded={
                                expanded.has(row.model.id) && chatModels.has(row.model.id)
                              }
                              aria-controls={`leaderboard-chat-${row.model.id}`}
                              onClick={() => {
                                setExpanded((current) => new Set([...current, row.model.id]));
                                setChatOpen(row.model.id, true);
                              }}
                            >
                              Chat
                            </button>
                          )}
                          {row.configurationLabel && <small>{row.configurationLabel}</small>}
                          {row.coverageLabel && <small>{row.coverageLabel}</small>}
                        </div>
                      </div>
                    </th>
                    <td className="results-overall">
                      <RecordedResult runs={Object.values(row.runs)} score={row.overall} overall />
                    </td>
                    {SCORED_FAMILIES.map((family) => (
                      <td key={family}>
                        <RecordedResult
                          runs={row.runs[family] ? [row.runs[family]!] : []}
                          score={row.scores[family]}
                          href={
                            row.runs[family]
                              ? `#/tasks?category=${family}&model=${row.model.id}&run=${encodeURIComponent(row.runs[family]!.runId)}`
                              : undefined
                          }
                        />
                      </td>
                    ))}
                    <td>
                      <SummaryValue metric={row.averageTime} format={seconds} />
                    </td>
                    <td>
                      <SummaryValue
                        metric={row.estimatedCost}
                        format={dollars}
                        cost
                        scope={row.coverageLabel}
                      />
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
                        {rows === defaultRows && (
                          <div className="task-model-picker">
                            <label htmlFor={`configuration-${row.model.id}`}>
                              Recorded setting
                            </label>
                            <select
                              id={`configuration-${row.model.id}`}
                              value={selectedConfigurations[row.model.id] ?? ""}
                              onChange={(event) =>
                                setSelectedConfigurations((current) => ({
                                  ...current,
                                  [row.model.id]: event.target.value,
                                }))
                              }
                            >
                              <option value="">Latest recorded runs</option>
                              {configurations
                                .filter((configuration) => configuration.model.id === row.model.id)
                                .map((configuration) => (
                                  <option key={configuration.rowId} value={configuration.rowId}>
                                    {Object.values(configuration.runs)[0]?.startedAt.slice(0, 10)} ·{" "}
                                    {configuration.configurationLabel}
                                  </option>
                                ))}
                            </select>
                          </div>
                        )}
                        {row.overallReason && <p>{row.overallReason}</p>}
                        {import.meta.env.DEV && expanded.has(row.model.id) && (
                          <LeaderboardConversations
                            key={Object.values(row.runs)
                              .map((run) => run.runId)
                              .join("+")}
                            row={row}
                            open={chatModels.has(row.model.id)}
                            onOpenChange={(open) => setChatOpen(row.model.id, open)}
                          />
                        )}
                        <div className="results-coverage">
                          <p>
                            {recordedOutcomes(Object.values(row.runs)).graded} /{" "}
                            {recordedOutcomes(Object.values(row.runs)).planned} attempts graded.{" "}
                            Open a category below for its outcomes, settings, and retained
                            conversations.
                          </p>
                          <CoverageNote label="Average time" metric={row.averageTime} />
                          <CoverageNote label="Estimated cost" metric={row.estimatedCost} />
                        </div>
                        {SCORED_FAMILIES.map((family) =>
                          row.runs[family] ? (
                            <Fragment key={family}>
                              <RunDetails run={row.runs[family]} />
                              <a
                                className="results-score-link"
                                href={`#/tasks?category=${family}&model=${row.model.id}&run=${encodeURIComponent(row.runs[family].runId)}`}
                              >
                                View {family} tasks and conversations ↗
                              </a>
                            </Fragment>
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
          Time and estimated token costs cover completed attempts, including graded failures.
          Timeouts and run errors are excluded. Costs include cache discounts and are not billed
          spend or subscription charges. Open a row for counts and sources.
        </p>
        <p className="results-footnote">
          These are small samples. Differences in scores do not establish statistical significance.
        </p>
        <LeaderboardScatter rows={chartRows} />
      </div>
    </PageShell>
  );
}
