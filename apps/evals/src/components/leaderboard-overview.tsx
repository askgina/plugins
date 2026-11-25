import { useId, useState, type CSSProperties } from "react";
import { Popover } from "@base-ui/react/popover";
import { ChevronDown, ChevronLeft, ChevronRight, X } from "lucide-react";
import { SCORED_FAMILIES, type LeaderboardModelRow } from "../canonical/selectors";
import { providerOverviewRows, type LeaderboardController } from "../lib/leaderboard-state";
import { ModelAvatar } from "./eval-ui";
import {
  columns,
  modelRowHref,
  RecordedResult,
  rowKey,
  rowLabel,
  rowMetricValue,
} from "./leaderboard-results";
import { percent } from "./results-ui";
import { LeaderboardScatter } from "./leaderboard-scatter";

const scoreMetrics = [...SCORED_FAMILIES, "overall"] as const;
type ScoreMetric = (typeof scoreMetrics)[number];
type ActiveCell = { key: string; metric: ScoreMetric; surface: string } | null;

function HeatCell({
  row,
  metric,
  surface,
  active,
  setActive,
}: {
  row: LeaderboardModelRow;
  metric: ScoreMetric;
  surface: string;
  active: ActiveCell;
  setActive: (active: ActiveCell) => void;
}) {
  const key = rowKey(row);
  const value = rowMetricValue(row, metric);
  const open = active?.key === key && active.metric === metric && active.surface === surface;
  const run = metric === "overall" ? undefined : row.runs[metric];
  const runs = metric === "overall" ? Object.values(row.runs) : run ? [run] : [];
  const label = metric === "overall" ? "Overall" : metric;
  const band = value === null ? "missing" : String(Math.min(9, Math.floor(value * 10)));
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next) setActive({ key, metric, surface });
        else if (open) setActive(null);
      }}
    >
      <Popover.Trigger
        className="lb-heat-cell"
        openOnHover
        delay={120}
        closeDelay={120}
        onFocus={(event) => {
          if (event.currentTarget.matches(":focus-visible")) setActive({ key, metric, surface });
        }}
        data-band={band}
        data-overall={metric === "overall"}
        data-highlight={active?.key === key || active?.metric === metric}
        aria-label={`${rowLabel(row)}, ${label}: ${value === null ? "unavailable" : percent(value)}. Show evidence.`}
      >
        {value === null ? "N/A" : percent(value)}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          sideOffset={8}
          collisionPadding={12}
          className="results-popover-positioner"
        >
          <Popover.Popup className="results-popover lb-heat-popover" initialFocus={false}>
            <div className="results-popover-heading">
              <Popover.Title>
                {row.model.name} · {label}
              </Popover.Title>
              <Popover.Close aria-label="Close score details">
                <X size={16} />
              </Popover.Close>
            </div>
            <div className="results-popover-body">
              <p>
                {row.configurationLabel} · {runs[0]?.startedAt.slice(0, 10)}
              </p>
              <RecordedResult
                runs={runs}
                score={value}
                overall={metric === "overall"}
                reason={row.overallReason}
              />
              <p>{columns.find((column) => column.metric === metric)?.explanation}</p>
              <a
                className="results-score-link"
                href={
                  run
                    ? `#/tasks?category=${metric}&model=${row.model.id}&run=${encodeURIComponent(run.runId)}`
                    : modelRowHref(row)
                }
              >
                {run ? "View tasks and evidence ↗" : "View model and recorded setting ↗"}
              </a>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function LeaderboardOverview({ controller }: { controller: LeaderboardController }) {
  const { state, update, shown, page: requestedPage, pageSize, viewport } = controller;
  const [selection, setSelection] = useState<{ context: string; cell: ActiveCell } | null>(null);
  const id = useId();
  const overviewRows = providerOverviewRows(shown);
  const lastPage = Math.max(0, Math.ceil(overviewRows.length / pageSize) - 1);
  const page = Math.min(requestedPage, lastPage);
  const start = page * pageSize;
  const windowRows = overviewRows.slice(start, start + pageSize);
  const context = JSON.stringify([
    state.search,
    state.campaign,
    state.grading,
    state.metric,
    state.direction,
    state.view,
    page,
    pageSize,
    viewport,
  ]);
  const active = selection?.context === context ? selection.cell : null;
  function setActive(cell: ActiveCell) {
    setSelection({ context, cell });
  }
  const label = columns.find((column) => column.metric === state.metric)?.label;
  function changePage(next: number) {
    setActive(null);
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
                  <th scope="col" key={rowKey(row)} data-active={active?.key === rowKey(row)}>
                    <a href={modelRowHref(row)} title={rowLabel(row)}>
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
                  <th scope="row" data-active={active?.metric === metric}>
                    {metric === "overall" ? "Overall" : metric}
                  </th>
                  {windowRows.map((row) => (
                    <td key={rowKey(row)}>
                      <HeatCell
                        row={row}
                        metric={metric}
                        surface="wide"
                        active={active}
                        setActive={setActive}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <table className="lb-matrix lb-matrix-narrow">
            <caption className="results-sr-only">
              Success by category for one setting per provider, selected using the active sort. All
              settings remain in the ranked table. Tap a score for evidence.
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
                      <HeatCell
                        row={row}
                        metric={metric}
                        surface="narrow"
                        active={active}
                        setActive={setActive}
                      />
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
