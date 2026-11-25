import { useId, type CSSProperties } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { SCORED_FAMILIES, type LeaderboardModelRow } from "../canonical/selectors";
import { providerOverviewRows, type LeaderboardController } from "../lib/leaderboard-state";
import { ModelAvatar } from "./eval-ui";
import { columns, modelRowHref, rowKey, rowLabel, rowMetricValue } from "./leaderboard-results";
import { percent } from "./results-ui";
import { LeaderboardScatter } from "./leaderboard-scatter";

const scoreMetrics = [...SCORED_FAMILIES, "overall"] as const;
type ScoreMetric = (typeof scoreMetrics)[number];
function HeatCell({ row, metric }: { row: LeaderboardModelRow; metric: ScoreMetric }) {
  const value = rowMetricValue(row, metric);
  const label = metric === "overall" ? "Overall" : metric;
  const band = value === null ? "missing" : String(Math.min(9, Math.floor(value * 10)));
  return (
    <a
      className="lb-heat-cell"
      href={modelRowHref(row)}
      data-band={band}
      data-overall={metric === "overall"}
      aria-label={`${rowLabel(row)}, ${label}: ${value === null ? "unavailable" : percent(value)}. View model details.`}
    >
      {value === null ? "N/A" : percent(value)}
    </a>
  );
}

export function LeaderboardOverview({ controller }: { controller: LeaderboardController }) {
  const { state, update, shown, page: requestedPage, pageSize, viewport } = controller;
  const id = useId();
  const overviewRows = providerOverviewRows(shown);
  const lastPage = Math.max(0, Math.ceil(overviewRows.length / pageSize) - 1);
  const page = Math.min(requestedPage, lastPage);
  const start = page * pageSize;
  const windowRows = overviewRows.slice(start, start + pageSize);
  const label = columns.find((column) => column.metric === state.metric)?.label;
  function changePage(next: number) {
    update({ page: next });
  }
  return (
    <section
      className="lb-overview"
      data-mobile-open={state.overview}
      aria-label="Performance overview"
    >
      <button
        className="lb-mobile-overview-trigger"
        type="button"
        aria-expanded={state.overview}
        aria-controls={`lb-overview-${id}`}
        onClick={() => update({ overview: !state.overview, page })}
      >
        Category overview <ChevronDown size={16} aria-hidden="true" />
      </button>
      <div className="lb-overview-inner" id={`lb-overview-${id}`}>
        <div className="lb-overview-toolbar">
          <div className="lb-view-switch" role="group" aria-label="Overview view">
            <button
              type="button"
              aria-pressed={state.view === "categories"}
              onClick={() => update({ view: "categories", page })}
            >
              By category
            </button>
            <button
              type="button"
              aria-pressed={state.view === "efficiency"}
              onClick={() => update({ view: "efficiency", page })}
            >
              Efficiency
            </button>
          </div>
          {state.view === "categories" && (
            <div className="lb-overview-pagination">
              <span>
                {overviewRows.length
                  ? `${start + 1}–${Math.min(start + pageSize, overviewRows.length)} of ${overviewRows.length} providers`
                  : "No settings"}
                <span className="lb-overview-sort">
                  {" "}
                  · {label} {state.direction === "desc" ? "↓" : "↑"}
                </span>
              </span>
              <button
                type="button"
                aria-label="Previous overview settings"
                disabled={page === 0}
                onClick={() => changePage(page - 1)}
              >
                <ChevronLeft size={15} />
              </button>
              <button
                type="button"
                aria-label="Next overview settings"
                disabled={page >= lastPage}
                onClick={() => changePage(page + 1)}
              >
                <ChevronRight size={15} />
              </button>
            </div>
          )}
        </div>
        <div hidden={state.view !== "categories"}>
          <table
            className="lb-matrix lb-matrix-wide"
            style={{ "--lb-columns": windowRows.length } as CSSProperties}
          >
            <caption className="results-sr-only">
              Success by category for the displayed settings. One setting per provider, selected
              using the active sort. All settings remain in the ranked table. Overall is the
              equal-weight mean of three categories.
            </caption>
            <thead>
              <tr>
                <td />
                {windowRows.map((row) => (
                  <th scope="col" key={rowKey(row)}>
                    <a href={modelRowHref(row)}>
                      <ModelAvatar model={row.model} />
                      <span>
                        {row.model.name}
                        <small>
                          {row.configurationLabel?.replace(" reasoning", "") ?? "Recorded setting"}
                        </small>
                      </span>
                    </a>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scoreMetrics.map((metric) => (
                <tr key={metric} data-overall={metric === "overall"}>
                  <th scope="row">{metric === "overall" ? "Overall" : metric}</th>
                  {windowRows.map((row) => (
                    <td key={rowKey(row)}>
                      <HeatCell row={row} metric={metric} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <table className="lb-matrix lb-matrix-narrow">
            <caption className="results-sr-only">
              Success by category for one setting per provider, selected using the active sort. All
              settings remain in the ranked table. Select a score to view that model and recorded
              setting.
            </caption>
            <thead>
              <tr>
                <th scope="col">Model / setting</th>
                {scoreMetrics.map((metric) => (
                  <th scope="col" key={metric} data-overall={metric === "overall"}>
                    {metric === "overall" ? (
                      "Overall"
                    ) : metric === "Predictions" ? (
                      <abbr title="Predictions">Pred.</abbr>
                    ) : (
                      metric
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {windowRows.map((row) => (
                <tr key={rowKey(row)}>
                  <th scope="row">
                    <a href={modelRowHref(row)}>
                      <ModelAvatar model={row.model} />
                      <span>
                        {row.model.name}
                        <small>{row.configurationLabel?.replace(" reasoning", "")}</small>
                      </span>
                    </a>
                  </th>
                  {scoreMetrics.map((metric) => (
                    <td key={metric} data-overall={metric === "overall"}>
                      <HeatCell row={row} metric={metric} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="lb-overview-caption">
            <span>
              {`${state.direction === "desc" ? "Highest" : "Lowest"} ${label?.toLowerCase()} setting per provider`}{" "}
              · different clients and budgets
            </span>
            <span className="lb-heat-legend">
              0% <i aria-hidden="true" /> 100% <span> · N/A: unavailable</span>
            </span>
          </div>
        </div>
        <div hidden={state.view !== "efficiency"}>
          <LeaderboardScatter rows={shown} compact={viewport === "phone"} />
        </div>
      </div>
    </section>
  );
}
