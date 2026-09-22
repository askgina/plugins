import { Fragment, useEffect, useId, useState, useSyncExternalStore } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Search, SlidersHorizontal, X } from "lucide-react";
import {
  benchmarkSummary,
  campaignDisplayLabel,
  leaderboardCampaignRows,
  recordedBudgetLabel,
  recordedOutcomes,
  SCORED_FAMILIES,
  sortLeaderboardRows,
  type LeaderboardMetric,
  type LeaderboardModelRow,
} from "../canonical/selectors";
import { ModelAvatar } from "./eval-ui";
import { LeaderboardConversations } from "./leaderboard-conversations";
import { LeaderboardScatter } from "./leaderboard-scatter";
import {
  columns,
  CoverageNote,
  RecordedResult,
  rowKey,
  rowLabel,
  SummaryValue,
} from "./leaderboard-results";
import { dollars, InfoPopover, ResultsHeader, RunDetails, seconds } from "./results-ui";
import "../styles/leaderboard-mobile.css";

type Grouping = "settings" | "models";

function subscribeToMobile(onChange: () => void) {
  const media = window.matchMedia("(max-width: 760px)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
function isMobileViewport() {
  return window.matchMedia("(max-width: 760px)").matches;
}

function initialState(search: string) {
  const params = new URLSearchParams(
    typeof window === "undefined" ? "" : window.location.hash.split("?")[1],
  );
  const metric =
    columns.find((column) => column.metric === params.get("metric"))?.metric ?? "overall";
  return {
    search: params.get("search") ?? search,
    campaign: params.get("campaign") ?? "latest",
    grading: ["complete", "incomplete"].includes(params.get("grading") ?? "")
      ? params.get("grading")!
      : "all",
    metric,
    direction: params.get("direction") === "asc" ? ("asc" as const) : ("desc" as const),
    grouping: params.get("group") === "models" ? ("models" as Grouping) : ("settings" as Grouping),
  };
}

function MobileMetric({ row, metric }: { row: LeaderboardModelRow; metric: LeaderboardMetric }) {
  if (metric === "time") return <SummaryValue metric={row.averageTime} format={seconds} />;
  if (metric === "cost")
    return (
      <SummaryValue metric={row.estimatedCost} format={dollars} cost scope={row.coverageLabel} />
    );
  const runs =
    metric === "overall" ? Object.values(row.runs) : row.runs[metric] ? [row.runs[metric]!] : [];
  const score = metric === "overall" ? row.overall : row.scores[metric];
  return (
    <div data-complete-score={score !== null}>
      <RecordedResult
        runs={runs}
        score={score}
        overall={metric === "overall"}
        reason={row.overallReason}
      />
    </div>
  );
}

function MobileInspector({ row, onClose }: { row: LeaderboardModelRow; onClose: () => void }) {
  const [view, setView] = useState<"chat" | "details">("chat");
  return (
    <section className="lb-mobile-inspector" aria-label={`Inspect ${rowLabel(row)}`}>
      <div className="lb-mobile-inspector-heading">
        <h3>
          {row.model.name}
          <small>{row.configurationLabel}</small>
        </h3>
        <button type="button" onClick={onClose} aria-label="Close inspection">
          <X size={18} />
        </button>
      </div>
      <div className="lb-mobile-inspector-views" role="group" aria-label="Inspection view">
        <button type="button" aria-pressed={view === "chat"} onClick={() => setView("chat")}>
          Conversation
        </button>
        <button type="button" aria-pressed={view === "details"} onClick={() => setView("details")}>
          Run details
        </button>
        <a href={`#/models/${row.model.id}`}>Model profile ↗</a>
      </div>
      <div
        className="lb-mobile-inspector-body"
        tabIndex={0}
        role="region"
        aria-label={view === "chat" ? "Recorded conversation" : "Run evidence"}
        key={view}
      >
        {view === "chat" ? (
          <LeaderboardConversations row={row} open onOpenChange={() => {}} />
        ) : (
          <>
            {row.overallReason && <p>{row.overallReason}</p>}
            <CoverageNote label="Average time" metric={row.averageTime} />
            <CoverageNote label="Estimated cost" metric={row.estimatedCost} />
            {SCORED_FAMILIES.map((family) =>
              row.runs[family] ? (
                <Fragment key={family}>
                  <RunDetails run={row.runs[family]} />
                  <a
                    className="lb-mobile-task-link"
                    href={`#/tasks?category=${family}&model=${row.model.id}&run=${encodeURIComponent(row.runs[family]!.runId)}`}
                  >
                    View {family} tasks and checks ↗
                  </a>
                </Fragment>
              ) : null,
            )}
          </>
        )}
      </div>
    </section>
  );
}

/** Mobile presentation shares the desktop's outcome and measurement semantics. */
export function LeaderboardMobile({
  rows,
  initialSearch = "",
}: {
  rows: readonly LeaderboardModelRow[];
  initialSearch?: string;
}) {
  const id = useId();
  const mobile = useSyncExternalStore(subscribeToMobile, isMobileViewport, () => false);
  const [state, setState] = useState(() => initialState(initialSearch));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set());
  const column = columns.find((entry) => entry.metric === state.metric)!;
  const campaigns = [...new Set(rows.map((row) => row.campaignId).filter(Boolean))];
  const query = state.search.trim().toLocaleLowerCase();
  const campaignRows = leaderboardCampaignRows(rows, state.campaign);
  const shown = sortLeaderboardRows(
    campaignRows.filter((row) => {
      const counts = recordedOutcomes(Object.values(row.runs));
      const complete = counts.planned > 0 && counts.graded === counts.planned;
      return (
        `${row.model.name} ${row.model.provider} ${row.configurationLabel ?? ""} ${row.campaignId ?? ""}`
          .toLocaleLowerCase()
          .includes(query) &&
        (state.grading === "all" || (state.grading === "complete" ? complete : !complete))
      );
    }),
    state.metric,
    state.direction,
  );
  const groups = new Map<string, LeaderboardModelRow[]>();
  for (const row of shown) groups.set(row.model.id, [...(groups.get(row.model.id) ?? []), row]);
  const totals = recordedOutcomes(shown.flatMap((row) => Object.values(row.runs)));
  const hasFilters = Boolean(query || state.campaign !== "latest" || state.grading !== "all");
  const scope = `${state.campaign === "latest" ? "Latest per setting" : state.campaign === "all" ? "All campaigns (history)" : campaignDisplayLabel(state.campaign)} · ${state.grading === "all" ? "All results" : state.grading === "complete" ? "Fully graded" : "Incomplete grading"}`;

  useEffect(() => {
    // Keep mobile exploration shareable without changing desktop navigation or
    // triggering a route change (and page scroll) on each filter keystroke.
    if (!window.matchMedia("(max-width: 760px)").matches) return;
    const [path, search] = window.location.hash.split("?");
    const params = new URLSearchParams(search);
    for (const [key, value, fallback] of [
      ["search", state.search, ""],
      ["campaign", state.campaign, "latest"],
      ["grading", state.grading, "all"],
      ["metric", state.metric, "overall"],
      ["direction", state.direction, "desc"],
      ["group", state.grouping, "settings"],
    ]) {
      if (value === fallback) params.delete(key!);
      else params.set(key!, value!);
    }
    params.delete("view");
    window.history.replaceState(
      window.history.state,
      "",
      `${path || "#/leaderboard"}${params.size ? `?${params}` : ""}`,
    );
  }, [state]);

  function clearFilters() {
    setState({ ...state, search: "", campaign: "latest", grading: "all" });
  }
  function closeInspection(key: string) {
    setSelected(null);
    document.getElementById(`${id}-inspect-${key}`)?.focus({ preventScroll: true });
  }
  function renderRow(row: LeaderboardModelRow) {
    const key = rowKey(row);
    const open = selected === key;
    const runs = Object.values(row.runs);
    const first = runs[0];
    const recovery = runs.some((run) => run.recovery);
    return (
      <li key={key} data-mobile-configuration={key}>
        <div className="lb-mobile-row" data-selected={open}>
          <button
            type="button"
            className="lb-mobile-inspect-trigger"
            id={`${id}-inspect-${key}`}
            aria-label={`Inspect ${rowLabel(row)}`}
            aria-expanded={open}
            aria-controls={`${id}-evidence-${key}`}
            onClick={() => setSelected(open ? null : key)}
          >
            <ModelAvatar model={row.model} />
            <span className="lb-mobile-model-name">
              <strong>{row.model.name}</strong>
              <small>
                {row.configurationLabel?.replace(" reasoning", "") ?? "Recorded setting"}
              </small>
              <small>
                {recovery && "Recovery · "}
                {first?.startedAt.slice(0, 10) ?? "Date not recorded"}
              </small>
              {recovery && <small>{recordedBudgetLabel(runs)}</small>}
            </span>
            <ChevronDown size={14} aria-hidden="true" />
          </button>
          <div className="lb-mobile-value">
            <span className="results-sr-only">{column.label}: </span>
            <MobileMetric row={row} metric={state.metric} />
          </div>
        </div>
        {open && (
          <div id={`${id}-evidence-${key}`}>
            <MobileInspector key={key} row={row} onClose={() => closeInspection(key)} />
          </div>
        )}
      </li>
    );
  }

  return (
    <div className="eval-container results-page leaderboard-mobile">
      <ResultsHeader title="Gina Model Leaderboard" description={benchmarkSummary(rows)}>
        <p className="lb-mobile-caveat">
          Tool-use conformance with price grounding on three Perps tasks.
        </p>
        <div className="lb-mobile-methodology">
          <a href="#/methodology">Methodology ↗</a>
          <InfoPopover label="Comparison conditions">
            <p>
              Latest per setting keeps each reasoning level separate, including incomplete results.
              Choose All campaigns (history) to inspect earlier runs. Recovery rows include retries
              and show their recorded time budgets. Completed means every trial finished processing,
              including execution errors. Graded counts trials with a pass or fail verdict. Clients,
              reasoning controls, and time budgets vary. Overall weights Spot, Perps, and Predictions
              equally. Small score differences do not establish statistical significance.
            </p>
          </InfoPopover>
        </div>
      </ResultsHeader>
      <div className="lb-mobile-searchbar">
        <label className="results-search">
          <Search size={17} aria-hidden="true" />
          <span className="results-sr-only">Search mobile leaderboard</span>
          <input
            type="search"
            placeholder="Search models or settings"
            value={state.search}
            onChange={(event) => setState({ ...state, search: event.target.value })}
          />
        </label>
        <button
          type="button"
          className="lb-mobile-filter-trigger"
          aria-expanded={filtersOpen}
          aria-controls={`${id}-filters`}
          onClick={() => setFiltersOpen(!filtersOpen)}
        >
          <SlidersHorizontal size={17} aria-hidden="true" />
          Filters{hasFilters && <span aria-label="Filters active"> ·</span>}
        </button>
      </div>
      <div className="lb-mobile-filter-scope">
        <p>{scope}</p>
        {hasFilters && (
          <button type="button" onClick={clearFilters}>
            Clear
          </button>
        )}
      </div>
      <div className="lb-mobile-filters" id={`${id}-filters`} hidden={!filtersOpen}>
        <label>
          Campaign
          <select
            value={state.campaign}
            onChange={(event) => setState({ ...state, campaign: event.target.value })}
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
            onChange={(event) => setState({ ...state, grading: event.target.value })}
          >
            <option value="all">All results</option>
            <option value="complete">Fully graded</option>
            <option value="incomplete">Incomplete grading</option>
          </select>
        </label>
        <p>
          {totals.graded.toLocaleString()}/{totals.planned.toLocaleString()} attempts graded ·{" "}
          {totals.passed} passed · {totals.failed} failed · {totals.timedOut} timed out ·{" "}
          {totals.runtimeFailure} run errors
        </p>
      </div>
      <section aria-label="Leaderboard results">
        <div className="lb-mobile-controls">
          <label>
            <span className="results-sr-only">Results view</span>
            <select
              value={state.grouping}
              onChange={(event) => {
                setSelected(null);
                setState({ ...state, grouping: event.target.value as Grouping });
              }}
            >
              <option value="settings">All settings</option>
              <option value="models">Group by model</option>
            </select>
          </label>
          <label>
            <span className="results-sr-only">Displayed metric</span>
            <select
              value={state.metric}
              onChange={(event) => {
                const metric = event.target.value as LeaderboardMetric;
                setState({
                  ...state,
                  metric,
                  direction: metric === "time" || metric === "cost" ? "asc" : "desc",
                });
              }}
            >
              {columns.map((entry) => (
                <option key={entry.metric} value={entry.metric}>
                  Metric: {entry.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="lb-mobile-result-summary">
          <p role="status">
            {shown.length} {state.campaign === "all" ? "records" : "settings"} · {groups.size}{" "}
            {groups.size === 1 ? "model" : "models"}
          </p>
          <InfoPopover label={`About ${column.label}`}>
            <p>{column.explanation}</p>
          </InfoPopover>
          <button
            type="button"
            className="lb-mobile-sort"
            aria-label={`Sort ${column.label} ${state.direction === "desc" ? "lowest first" : "highest first"}`}
            title={`Currently ${state.direction === "desc" ? "highest" : "lowest"} first`}
            onClick={() =>
              setState({ ...state, direction: state.direction === "desc" ? "asc" : "desc" })
            }
          >
            {state.direction === "desc" ? <ArrowDown size={17} /> : <ArrowUp size={17} />}
          </button>
        </div>
        {state.grouping === "settings" ? (
          <ul
            className="lb-mobile-results"
            aria-label={`Recorded settings sorted by ${column.label}, ${state.direction === "desc" ? "descending" : "ascending"}`}
          >
            {shown.map(renderRow)}
          </ul>
        ) : (
          <div className="lb-mobile-groups">
            <p className="lb-mobile-group-note">
              Expand a model to see every setting. No settings are combined into a model score.
            </p>
            {[...groups].map(([modelId, settings]) => (
              <section key={modelId}>
                <button
                  type="button"
                  className="lb-mobile-group-trigger"
                  aria-expanded={openGroups.has(modelId)}
                  aria-controls={`${id}-group-${modelId}`}
                  onClick={() =>
                    setOpenGroups((current) => {
                      const next = new Set(current);
                      if (next.has(modelId)) next.delete(modelId);
                      else next.add(modelId);
                      return next;
                    })
                  }
                >
                  <ModelAvatar model={settings[0]!.model} />
                  <span>
                    <strong>{settings[0]!.model.name}</strong>
                    <small>
                      {settings.length} recorded {settings.length === 1 ? "setting" : "settings"}
                    </small>
                  </span>
                  <ChevronDown size={17} aria-hidden="true" />
                </button>
                <ul
                  id={`${id}-group-${modelId}`}
                  className="lb-mobile-results"
                  hidden={!openGroups.has(modelId)}
                >
                  {settings.map(renderRow)}
                </ul>
              </section>
            ))}
          </div>
        )}
        {shown.length === 0 && (
          <div className="results-empty" role="status">
            <h2>No matching results</h2>
            <p>Try another model, setting, campaign, or grading filter.</p>
            <button type="button" onClick={clearFilters}>
              Clear filters
            </button>
          </div>
        )}
        <p className="lb-mobile-footnote">
          Tap a model to inspect its conversation and run details. Time and cost cover completed
          attempts; exclusions are shown. Costs are estimates, not billed spend.
        </p>
      </section>
      {mobile && <LeaderboardScatter rows={shown} compact />}
    </div>
  );
}
