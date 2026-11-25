import { useId, useState } from "react";
import { ArrowDown, ArrowUp, Search, SlidersHorizontal } from "lucide-react";
import { LeaderboardMobileView } from "../components/leaderboard-mobile";
import {
  columns,
  CompactScore,
  followModelRow,
  RowIdentity,
  rowKey,
  rowMetricValue,
} from "../components/leaderboard-results";
import { LeaderboardOverview } from "../components/leaderboard-overview";
import { PageShell } from "../components/eval-ui";
import { TransactionResult } from "../components/transaction-results";
import { useLeaderboard } from "../lib/leaderboard-state";
import {
  campaignDisplayLabel,
  configurationLeaderboardRows,
  recordedOutcomes,
  type LeaderboardMetric,
  type LeaderboardModelRow,
  type ScoredFamily,
} from "../canonical/selectors";
import "../styles/leaderboard.css";

const defaultRows = [...configurationLeaderboardRows()].sort((a, b) =>
  (Object.values(b.runs)[0]?.startedAt ?? "").localeCompare(
    Object.values(a.runs)[0]?.startedAt ?? "",
  ),
);

export function LeaderboardPage({
  initialSearch = "",
  rows = defaultRows,
}: {
  initialSearch?: string;
  rows?: readonly LeaderboardModelRow[];
}) {
  const controller = useLeaderboard(rows, initialSearch);
  const { state, update, sort, shown, clear } = controller;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const id = useId();
  const campaigns = [...new Set(rows.map((row) => row.campaignId).filter(Boolean))];
  const totals = recordedOutcomes(shown.flatMap((row) => Object.values(row.runs)));
  const modelCount = new Set(shown.map((row) => row.model.id)).size;
  const activeFilters = Number(state.grading !== "all") + Number(state.group !== "settings");
  const scope =
    state.campaign === "latest"
      ? "Latest per setting"
      : state.campaign === "all"
        ? "All campaigns (history)"
        : campaignDisplayLabel(state.campaign);
  return (
    <PageShell active="leaderboard" className="lb-page">
      <div className="eval-container results-page lb-content">
        <header className="lb-page-heading">
          <div>
            <p className="lb-eyebrow">GINA / EVALUATIONS</p>
            <h1>Gina Financial Evals Leaderboard</h1>
          </div>
          <p>Frontier model evals on financial transaction execution and financial data analysis</p>
        </header>
        <div className="lb-toolbar">
          <label className="lb-search">
            <Search size={16} aria-hidden="true" />
            <span className="results-sr-only">Search models, providers, or reasoning settings</span>
            <input
              type="search"
              value={state.search}
              onChange={(event) => update({ search: event.target.value })}
              placeholder="Search models or settings"
            />
          </label>
          <label className="lb-campaign">
            <span className="results-sr-only">Campaign</span>
            <select
              value={state.campaign}
              onChange={(event) => update({ campaign: event.target.value })}
            >
              <option value="latest">Latest per setting</option>
              <option value="all">All campaigns (history)</option>
              {campaigns.map((campaign) => (
                <option key={campaign} value={campaign}>
                  {campaignDisplayLabel(campaign)}
                </option>
              ))}
            </select>
          </label>
          <button
            className="lb-filter-trigger"
            type="button"
            aria-expanded={filtersOpen}
            aria-controls={`lb-filters-${id}`}
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            <SlidersHorizontal size={15} aria-hidden="true" /> Filters
            {activeFilters > 0 && <span>{activeFilters}</span>}
          </button>
          <p className="lb-result-count" role="status">
            {`${modelCount} models · ${shown.length} ${state.campaign === "all" ? "records" : "settings"}`}
            <span className="results-sr-only">
              {" "}
              · {totals.graded}/{totals.planned} attempts graded
            </span>
          </p>
        </div>
        <div className="lb-filter-scope">
          <span>
            {scope}
            {state.grading !== "all"
              ? ` · ${state.grading === "complete" ? "Fully graded" : "Incomplete grading"}`
              : ""}
          </span>
          {(state.search || state.campaign !== "latest" || activeFilters > 0) && (
            <button type="button" onClick={clear}>
              Clear filters
            </button>
          )}
        </div>
        <div className="lb-advanced-filters" id={`lb-filters-${id}`} hidden={!filtersOpen}>
          <label className="lb-mobile-campaign-control">
            Campaign
            <select
              value={state.campaign}
              onChange={(event) => update({ campaign: event.target.value })}
            >
              <option value="latest">Latest per setting</option>
              <option value="all">All campaigns (history)</option>
              {campaigns.map((campaign) => (
                <option key={campaign} value={campaign}>
                  {campaignDisplayLabel(campaign)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Grading
            <select
              value={state.grading}
              onChange={(event) => update({ grading: event.target.value as typeof state.grading })}
            >
              <option value="all">All results</option>
              <option value="complete">Fully graded</option>
              <option value="incomplete">Incomplete grading</option>
            </select>
          </label>
          <label className="lb-group-control">
            Results view
            <select
              value={state.group}
              onChange={(event) => update({ group: event.target.value as typeof state.group })}
            >
              <option value="settings">All settings</option>
              <option value="models">Group by model</option>
            </select>
          </label>
          <p>
            {totals.graded.toLocaleString()}/{totals.planned.toLocaleString()} attempts graded ·{" "}
            {totals.passed} passed · {totals.failed} failed · {totals.timedOut} timed out ·{" "}
            {totals.runtimeFailure} run errors
          </p>
        </div>
        <LeaderboardOverview controller={controller} />
        <div className="lb-responsive-controls">
          <label>
            Sort
            <select
              value={state.metric}
              onChange={(event) => sort(event.target.value as LeaderboardMetric)}
            >
              {columns.map((column) => (
                <option key={column.metric} value={column.metric}>
                  {column.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            aria-label={`Sort ${state.direction === "desc" ? "ascending" : "descending"}`}
            onClick={() => sort(state.metric)}
          >
            {state.direction === "desc" ? <ArrowDown size={15} /> : <ArrowUp size={15} />}
          </button>
          <label className="lb-category-control">
            Category
            <select
              value={state.category}
              onChange={(event) => update({ category: event.target.value as ScoredFamily })}
            >
              <option>Spot</option>
              <option>Perps</option>
              <option>Predictions</option>
            </select>
          </label>
          <div
            className="lb-efficiency-switch"
            role="group"
            aria-label="Displayed efficiency metric"
          >
            <button
              type="button"
              aria-pressed={state.efficiency === "time"}
              onClick={() => update({ efficiency: "time" })}
            >
              Time
            </button>
            <button
              type="button"
              aria-pressed={state.efficiency === "cost"}
              onClick={() => update({ efficiency: "cost" })}
            >
              Cost
            </button>
          </div>
        </div>
        <div className="lb-table-wrap leaderboard-desktop">
          <table className="lb-table leaderboard-table">
            <caption className="results-sr-only">
              Latest recorded model settings, sorted by{" "}
              {columns.find((column) => column.metric === state.metric)?.label},{" "}
              {state.direction === "desc" ? "descending" : "ascending"}. Unavailable values appear
              last.
            </caption>
            <colgroup>
              <col className="lb-col-position" />
              <col className="lb-col-model" />
              {columns.map((column) => (
                <col
                  key={column.metric}
                  data-column={column.metric}
                  data-selected={
                    column.metric === state.category || column.metric === state.efficiency
                  }
                />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th scope="col" className="lb-position">
                  #
                </th>
                <th scope="col">Model / recorded setting</th>
                {columns.map((column) => (
                  <th
                    key={column.metric}
                    scope="col"
                    data-column={column.metric}
                    data-selected={
                      column.metric === state.category || column.metric === state.efficiency
                    }
                    aria-sort={
                      state.metric === column.metric
                        ? state.direction === "desc"
                          ? "descending"
                          : "ascending"
                        : "none"
                    }
                  >
                    <div className="lb-column-heading">
                      <button className="lb-sort" type="button" onClick={() => sort(column.metric)}>
                        {column.label}
                        <span aria-hidden="true">
                          {state.metric === column.metric
                            ? state.direction === "desc"
                              ? "↓"
                              : "↑"
                            : ""}
                        </span>
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((row, index) => {
                const key = rowKey(row);
                return (
                  <tr
                    key={key}
                    data-configuration={key}
                    data-model={row.model.id}
                    data-campaign={row.campaignId}
                    className="lb-data-row"
                    onClick={(event) => followModelRow(event, row)}
                  >
                    <td className="lb-position">
                      {rowMetricValue(row, state.metric) === null ? "·" : index + 1}
                    </td>
                    <th scope="row">
                      <RowIdentity row={row} />
                    </th>
                    {columns.map((column) => (
                      <td
                        key={column.metric}
                        data-column={column.metric}
                        data-selected={
                          column.metric === state.category || column.metric === state.efficiency
                        }
                      >
                        <CompactScore row={row} metric={column.metric} />
                        {column.metric === "Spot" && (
                          <span className="lb-transactions-note">
                            <TransactionResult row={row} compact />
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!shown.length && (
            <div className="results-empty" role="status">
              <h2>No matching results</h2>
              <p>Try another model, setting, campaign, or grading filter.</p>
              <button onClick={clear}>Clear filters</button>
            </div>
          )}
        </div>
        <LeaderboardMobileView controller={controller} />
        <p className="lb-footnote">
          Overall averages three category success rates equally; terminal ungraded attempts earn
          zero credit. Time and estimated token cost cover completed attempts; errors and timeouts
          are excluded from those measurements. Spot transaction results are separate from Spot and
          Overall. <a href="#/methodology">Scoring, coverage, and methodology ↗</a>
        </p>
      </div>
    </PageShell>
  );
}
