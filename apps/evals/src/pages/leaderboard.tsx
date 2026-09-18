import { Fragment, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { LeaderboardMobile } from "../components/leaderboard-mobile";
import {
  rowKey,
  rowLabel,
  columns,
  SummaryValue,
  CoverageNote,
  RecordedResult,
} from "../components/leaderboard-results";
import { LeaderboardScatter } from "../components/leaderboard-scatter";
import { LeaderboardConversations } from "../components/leaderboard-conversations";
import { ModelAvatar, PageShell } from "../components/eval-ui";
import { canonicalCampaigns } from "../canonical/canonical";
import { InfoPopover, ResultsHeader, RunDetails, dollars, seconds } from "../components/results-ui";
import {
  SCORED_FAMILIES,
  benchmarkSummary,
  configurationLeaderboardRows,
  recordedOutcomes,
  sortLeaderboardRows,
  type LeaderboardMetric,
  type LeaderboardModelRow,
} from "../canonical/selectors";

const configurations = [...configurationLeaderboardRows()].sort((a, b) =>
  (Object.values(b.runs)[0]?.startedAt ?? "").localeCompare(
    Object.values(a.runs)[0]?.startedAt ?? "",
  ),
);
const defaultRows = configurations;
export function LeaderboardPage({
  initialSearch = "",
  initialExpandedModel,
  rows = defaultRows,
}: {
  initialSearch?: string;
  initialExpandedModel?: string;
  /** Storybook can supply derived summaries; the app uses all measured current records. */
  rows?: readonly LeaderboardModelRow[];
}) {
  const [search, setSearch] = useState(initialSearch);
  const [campaign, setCampaign] = useState("all");
  const [grading, setGrading] = useState("all");
  const [metric, setMetric] = useState<LeaderboardMetric>("overall");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    new Set(rows.filter((row) => row.model.id === initialExpandedModel).map(rowKey)),
  );
  const [chatRows, setChatRows] = useState<ReadonlySet<string>>(new Set());
  function setChatOpen(key: string, open: boolean) {
    setChatRows((current) => {
      const next = new Set(current);
      if (open) next.add(key);
      else next.delete(key);
      return next;
    });
  }
  const query = search.trim().toLocaleLowerCase();
  const campaigns = [...new Set(rows.map((row) => row.campaignId).filter(Boolean))];
  const shown = sortLeaderboardRows(
    rows.filter((row) => {
      const counts = recordedOutcomes(Object.values(row.runs));
      const complete = counts.planned > 0 && counts.graded === counts.planned;
      return (
        `${row.model.name} ${row.model.provider} ${row.configurationLabel ?? ""} ${row.campaignId ?? ""}`
          .toLocaleLowerCase()
          .includes(query) &&
        (campaign === "all" || row.campaignId === campaign) &&
        (grading === "all" || (grading === "complete" ? complete : !complete))
      );
    }),
    metric,
    direction,
  );
  const totals = recordedOutcomes(shown.flatMap((row) => Object.values(row.runs)));
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
  function toggle(key: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function clearFilters() {
    setSearch("");
    setCampaign("all");
    setGrading("all");
  }
  return (
    <PageShell active="leaderboard">
      <LeaderboardMobile rows={rows} initialSearch={initialSearch} />
      <div className="eval-container results-page leaderboard-desktop">
        <ResultsHeader
          title="Gina Model Leaderboard"
          description="Complete recorded results by model, reasoning setting, and campaign."
        >
          <p className="results-context">{benchmarkSummary(rows)}</p>
          <p className="results-context">
            Every recorded setting has its own row, including incomplete runs and earlier campaigns.
            Scores measure tool-use conformance; answer quality was not evaluated.
          </p>
        </ResultsHeader>
        <div className="results-toolbar">
          <p className="results-explanation">
            Clients, reasoning controls, and time budgets vary. Compare the recorded conditions
            alongside the results. Overall weights Spot, Perps, and Predictions equally. Small score
            differences do not establish statistical significance.{" "}
            <a href="#/methodology">Methodology ↗</a>
            {" · "}
            <a href="#/handoff">Data and exports ↗</a>
          </p>
          <label className="results-search">
            <Search size={17} aria-hidden="true" />
            <span className="results-sr-only">Search models, providers, or reasoning settings</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search models or settings"
            />
          </label>
        </div>
        <div className="results-filter-bar">
          <label>
            Campaign
            <select value={campaign} onChange={(event) => setCampaign(event.target.value)}>
              <option value="all">All recorded campaigns</option>
              {campaigns.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
          <label>
            Grading
            <select value={grading} onChange={(event) => setGrading(event.target.value)}>
              <option value="all">All results</option>
              <option value="complete">Fully graded</option>
              <option value="incomplete">Incomplete grading</option>
            </select>
          </label>
          <p role="status" className="results-filter-summary">
            {shown.length}/{rows.length} settings · {new Set(shown.map((row) => row.model.id)).size}{" "}
            models · {totals.graded.toLocaleString()}/{totals.planned.toLocaleString()} attempts
            graded
            <span>
              {totals.passed.toLocaleString()} passed · {totals.failed.toLocaleString()} failed ·{" "}
              {totals.timedOut} timed out · {totals.runtimeFailure} run errors
            </span>
          </p>
        </div>
        <LeaderboardScatter rows={shown} />
        <div
          className="results-scroll"
          role="region"
          aria-label="Gina Model Leaderboard"
          tabIndex={0}
        >
          <table className="results-table leaderboard-table">
            <caption className="results-sr-only">
              All recorded model settings, sorted by{" "}
              {columns.find((col) => col.metric === metric)?.label},{" "}
              {direction === "desc" ? "descending" : "ascending"}. Unavailable values appear last.
            </caption>
            <thead>
              <tr>
                <th scope="col" className="results-sticky">
                  Model / recorded setting
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
              {shown.map((row) => {
                const key = rowKey(row);
                const label = rowLabel(row);
                const runs = Object.values(row.runs);
                const first = runs[0];
                const timeouts = [
                  ...new Set(
                    runs
                      .map(
                        (run) =>
                          run.timeoutMs ??
                          canonicalCampaigns.find((entry) => entry.campaignId === run.campaignId)
                            ?.timeoutMs,
                      )
                      .filter((value) => value != null),
                  ),
                ];
                return (
                  <Fragment key={key}>
                    <tr
                      data-configuration={key}
                      data-model={row.model.id}
                      data-campaign={row.campaignId}
                    >
                      <th scope="row" className="results-sticky">
                        <div className="results-model">
                          <button
                            className="results-disclosure"
                            aria-label={`Run details for ${label}`}
                            aria-expanded={expanded.has(key)}
                            aria-controls={`runs-${key}`}
                            onClick={() => toggle(key)}
                          >
                            <ChevronDown size={16} />
                          </button>
                          <ModelAvatar model={row.model} />
                          <div>
                            <a href={`#/models/${row.model.id}`}>{row.model.name}</a>
                            <small className="results-configuration-label">
                              {row.configurationLabel ?? "Recorded setting"}
                            </small>
                            <small>
                              {first?.startedAt.slice(0, 10)} ·{" "}
                              {timeouts.length
                                ? `${timeouts.map((value) => value! / 1000).join(" / ")}s timeout`
                                : "Timeout not recorded"}{" "}
                              · {first?.cohort.repetitions} reps
                            </small>
                            <small>{row.campaignId}</small>
                            {row.coverageLabel && <small>{row.coverageLabel}</small>}
                            <div className="results-row-actions">
                              <button
                                type="button"
                                className="results-chat-trigger"
                                aria-label={`Evidence and sources for ${label}`}
                                aria-expanded={expanded.has(key)}
                                aria-controls={`runs-${key}`}
                                onClick={() => toggle(key)}
                              >
                                Evidence &amp; sources
                              </button>
                              {
                                <button
                                  type="button"
                                  className="results-chat-trigger"
                                  aria-label={`Chat transcripts for ${label}`}
                                  aria-expanded={expanded.has(key) && chatRows.has(key)}
                                  aria-controls={`leaderboard-chat-${key}`}
                                  onClick={() => {
                                    setExpanded((current) => new Set([...current, key]));
                                    setChatOpen(key, true);
                                  }}
                                >
                                  Chat
                                </button>
                              }
                            </div>
                          </div>
                        </div>
                      </th>
                      <td className="results-overall">
                        <RecordedResult
                          runs={runs}
                          score={row.overall}
                          overall
                          reason={row.overallReason}
                        />
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
                    {expanded.has(key) && (
                      <tr id={`runs-${key}`} className="results-expanded">
                        <td colSpan={7}>
                          <div className="results-detail-body">
                            <h2>{label}: run details</h2>
                            {row.overallReason && <p>{row.overallReason}</p>}
                            {
                              <LeaderboardConversations
                                panelId={`leaderboard-chat-${key}`}
                                row={row}
                                open={chatRows.has(key)}
                                onOpenChange={(open) => setChatOpen(key, open)}
                              />
                            }
                            <div className="results-coverage">
                              <CoverageNote label="Average time" metric={row.averageTime} />
                              <CoverageNote label="Estimated cost" metric={row.estimatedCost} />
                            </div>
                            {SCORED_FAMILIES.map((family) =>
                              row.runs[family] ? (
                                <Fragment key={family}>
                                  <RunDetails run={row.runs[family]} />
                                  <a
                                    className="results-score-link"
                                    href={`#/tasks?category=${family}&model=${row.model.id}&run=${encodeURIComponent(row.runs[family]!.runId)}`}
                                  >
                                    View {family} tasks and conversations ↗
                                  </a>
                                </Fragment>
                              ) : null,
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {shown.length === 0 && (
          <div className="results-empty" role="status">
            <h2>No matching results</h2>
            <p>Try another model, setting, campaign, or grading filter.</p>
            <button onClick={clearFilters}>Clear filters</button>
          </div>
        )}
        <p className="results-footnote">
          Time and estimated token costs cover completed attempts, including graded failures.
          Timeouts and run errors are excluded; sample counts are shown for both measures. Costs
          include cache discounts and are not billed spend or subscription charges. Evidence and
          sources include per-category latency, tokens, provenance, and recorded limitations.
        </p>
      </div>
    </PageShell>
  );
}
