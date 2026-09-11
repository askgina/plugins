import { useId, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Search, X } from "lucide-react";
import { Panel } from "../../components/eval-ui";
import { ComparisonScatterPlot } from "../../components/public-comparison-charts";
import {
  ComparisonConditions,
  MetricValue,
  ResultState,
} from "../../components/public-comparison-ui";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  PUBLIC_METRIC_DEFINITIONS,
  type PublicComparisonCatalog,
  type PublicComparisonCohort,
  type PublicComparisonRow,
  type PublicMetricId,
  type PublicMetricValue,
} from "../../lib/public-comparison";
import type { PublicComparisonState } from "../../lib/use-public-comparison";
import { ComparisonDialog } from "./comparison-dialog";
import {
  CandidateIdentity,
  CoverageBadge,
  ProductionHero,
  ProductionLoadState,
  ProductionNotice,
  ProductionShell,
  attemptsHref,
  formatProductionDate,
  runHref,
} from "./shared";
import "./results.css";

const INTEGER = new Intl.NumberFormat("en-US");
const MAX_SELECTION = 2;

type CoverageFilter = "all" | "complete" | "incomplete";

const COVERAGE_FILTERS: readonly { value: CoverageFilter; label: string }[] = [
  { value: "all", label: "All coverage" },
  { value: "complete", label: "Complete" },
  { value: "incomplete", label: "Incomplete" },
];

type MetricSortKey = "passRate" | "latencyP50" | "latencyP95" | "tokenUsage";
type SortKey = "run" | "attempts" | "publishedAt" | MetricSortKey;
type SortDirection = "asc" | "desc";

interface SortState {
  key: SortKey;
  direction: SortDirection;
}

const RESERVED_METRICS = PUBLIC_METRIC_DEFINITIONS.filter(
  (metric) => metric.unit === "unavailable",
);

const numericSortValue = (
  row: PublicComparisonRow,
  key: Exclude<SortKey, "run">,
): number | null => {
  switch (key) {
    case "attempts":
      return row.counts.attempts.total;
    case "publishedAt": {
      const parsed = Date.parse(row.publishedAt);
      return Number.isNaN(parsed) ? null : parsed;
    }
    default: {
      const metric = row.metrics[key];
      return metric.availability === "available" && Number.isFinite(metric.value)
        ? metric.value
        : null;
    }
  }
};

// Missing values stay last in either direction; publication identity breaks ties.
const compareRows =
  (sort: SortState) =>
  (left: PublicComparisonRow, right: PublicComparisonRow): number => {
    let order = 0;
    if (sort.key === "run") {
      order =
        left.model.localeCompare(right.model, "en") ||
        left.candidate.localeCompare(right.candidate, "en");
    } else {
      const a = numericSortValue(left, sort.key);
      const b = numericSortValue(right, sort.key);
      if (a === null && b !== null) return 1;
      if (a !== null && b === null) return -1;
      if (a !== null && b !== null) order = a - b;
    }
    return (
      (sort.direction === "asc" ? order : -order) ||
      left.publicationId.localeCompare(right.publicationId, "en")
    );
  };

const cohortOptionLabel = (cohort: PublicComparisonCohort): string => {
  const { conditions, rows } = cohort;
  return `${conditions.suiteId} v${conditions.suiteVersion} · ${conditions.target} · ${conditions.accountClass} · ${conditions.repetitions} repetitions · fixtures v${conditions.fixtureVersion} · catalog ${conditions.catalogSha.slice(0, 8)} · ${INTEGER.format(rows.length)} ${rows.length === 1 ? "run" : "runs"}`;
};

const resolveInitialCohortId = (
  catalog: PublicComparisonCatalog,
  initialCohortId: string | undefined,
  initialCompareIds: readonly string[],
): string | undefined => {
  if (
    initialCohortId !== undefined &&
    catalog.cohorts.some((cohort) => cohort.id === initialCohortId)
  ) {
    return initialCohortId;
  }
  if (initialCompareIds.length > 0) {
    const host = catalog.cohorts.find((cohort) =>
      initialCompareIds.every((id) => cohort.rows.some((row) => row.publicationId === id)),
    );
    if (host !== undefined) return host.id;
  }
  return catalog.cohorts[0]?.id;
};

// Reject invalid requests rather than silently choosing a different comparison pair.
const selectableIds = (
  cohort: PublicComparisonCohort | undefined,
  ids: readonly string[],
): readonly string[] => {
  if (
    cohort === undefined ||
    ids.length > MAX_SELECTION ||
    ids.some(
      (id, index) =>
        ids.indexOf(id) !== index || !cohort.rows.some((row) => row.publicationId === id),
    )
  )
    return [];
  return ids;
};

const rowLabel = (row: PublicComparisonRow): string => `${row.model}, ${row.candidate}`;

const configurationLabel = (row: PublicComparisonRow): string => {
  if (row.configuration.availability !== "pinned") return "Labels only";
  const sha = row.configuration.pinnedSha256;
  return sha === null ? "Pinned configuration" : `Pinned ${sha.slice(0, 8)}`;
};

const revisionLabel = (row: PublicComparisonRow): string => {
  const { revision, supersedes } = row.publication;
  if (supersedes === null) return `Revision ${revision}`;
  return supersedes.reason === "correction"
    ? `Revision ${revision} · corrects revision ${supersedes.revision}`
    : `Revision ${revision} · replaces withdrawn revision ${supersedes.revision}`;
};

const tokenSampleLabel = (row: PublicComparisonRow): string | null => {
  const metric = row.metrics.tokenUsage;
  if (metric.availability !== "available") return null;
  return `${INTEGER.format(metric.sampleCount)} of ${INTEGER.format(row.counts.attempts.total)} attempts retained usage`;
};

/** Distinct unavailable states a reserved metric takes across the visible rows, in first-seen order. */
const reservedStates = (
  rows: readonly PublicComparisonRow[],
  id: PublicMetricId,
): PublicMetricValue[] => {
  const seen = new Map<string, PublicMetricValue>();
  for (const row of rows) {
    const metric = row.metrics[id];
    const key =
      metric.availability === "available" ? "available" : `${metric.availability}:${metric.reason}`;
    if (!seen.has(key)) seen.set(key, metric);
  }
  return [...seen.values()];
};

function SortHeader({
  column,
  label,
  sort,
  numeric = false,
  onSort,
}: {
  column: SortKey;
  label: string;
  sort: SortState | null;
  numeric?: boolean;
  onSort: (column: SortKey) => void;
}) {
  const active = sort !== null && sort.key === column;
  const direction = active ? sort.direction : null;
  const Icon = direction === "asc" ? ArrowUp : direction === "desc" ? ArrowDown : ChevronsUpDown;
  return (
    <th
      scope="col"
      className={numeric ? "prod-results-num" : undefined}
      aria-sort={
        direction === "asc" ? "ascending" : direction === "desc" ? "descending" : undefined
      }
    >
      <button type="button" className="prod-results-sort" onClick={() => onSort(column)}>
        <span>{label}</span>
        <Icon size={13} aria-hidden="true" />
        <span className="prod-sr-only">
          {direction === null
            ? ", not sorted"
            : `, sorted ${direction === "asc" ? "ascending" : "descending"}`}
        </span>
      </button>
    </th>
  );
}

function ResultsHero({ catalog }: { catalog: PublicComparisonCatalog | null }) {
  const currentCount =
    catalog === null ? 0 : catalog.cohorts.reduce((sum, cohort) => sum + cohort.rows.length, 0);
  return (
    <ProductionHero
      eyebrow="Public conformance results"
      title="Compare runs on equal terms"
      description="Compare conformance, latency, and retained token usage under the same benchmark conditions. Inspect the evidence behind each result."
    >
      {catalog !== null && (
        <dl className="prod-results-facts" aria-label="Index summary">
          <div>
            <dt>Comparable cohorts</dt>
            <dd>{INTEGER.format(catalog.cohorts.length)}</dd>
          </div>
          <div>
            <dt>Current publications</dt>
            <dd>{INTEGER.format(currentCount)}</dd>
          </div>
          <div>
            <dt>Withdrawn</dt>
            <dd>{INTEGER.format(catalog.withdrawnCount)}</dd>
          </div>
          <div>
            <dt>Index generated</dt>
            <dd>{formatProductionDate(catalog.generatedAt)}</dd>
          </div>
        </dl>
      )}
    </ProductionHero>
  );
}

function WithdrawnNotice({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <ProductionNotice
      title={`${INTEGER.format(count)} withdrawn ${count === 1 ? "publication is" : "publications are"} excluded`}
      description="Withdrawn results are excluded from comparisons. This view reports only their count, without identities or earlier results."
      role="status"
    />
  );
}

function ReadyResults({
  catalog,
  initialCohortId,
  initialSearch,
  initialCompareIds,
}: {
  catalog: PublicComparisonCatalog;
  initialCohortId: string | undefined;
  initialSearch: string;
  initialCompareIds: readonly string[];
}) {
  const searchId = useId();
  const [cohortId, setCohortId] = useState(() =>
    resolveInitialCohortId(catalog, initialCohortId, initialCompareIds),
  );
  const cohort = catalog.cohorts.find((item) => item.id === cohortId) ?? catalog.cohorts[0];
  const [search, setSearch] = useState(initialSearch);
  const [coverage, setCoverage] = useState<CoverageFilter>("all");
  const [sort, setSort] = useState<SortState | null>(null);
  const [selected, setSelected] = useState<readonly string[]>(() =>
    selectableIds(cohort, initialCompareIds),
  );
  const [selectionCohortId, setSelectionCohortId] = useState(cohort?.id);
  const [dialogOpen, setDialogOpen] = useState(selected.length === MAX_SELECTION);
  const [limitReached, setLimitReached] = useState(false);

  const query = search.trim().toLowerCase();
  const rows = useMemo(() => {
    const visible = (cohort?.rows ?? []).filter((row) => {
      if (coverage !== "all" && row.coverage.status !== coverage) return false;
      return (
        query.length === 0 ||
        `${row.candidate} ${row.model} ${row.reasoning ?? ""} ${row.publicationId} ${row.configuration.pinnedSha256 ?? "labels only"}`
          .toLowerCase()
          .includes(query)
      );
    });
    if (sort !== null) visible.sort(compareRows(sort));
    return visible;
  }, [cohort, coverage, query, sort]);

  const coverageCounts = useMemo(() => {
    const counts = { all: cohort?.rows.length ?? 0, complete: 0, incomplete: 0 };
    for (const row of cohort?.rows ?? []) counts[row.coverage.status] += 1;
    return counts;
  }, [cohort]);

  const chartCounts = useMemo(() => {
    const counts = { latencyP50: 0, tokenUsage: 0 };
    for (const row of rows) {
      if (row.metrics.passRate.availability !== "available") continue;
      if (row.metrics.latencyP50.availability === "available") counts.latencyP50 += 1;
      if (row.metrics.tokenUsage.availability === "available") counts.tokenUsage += 1;
    }
    return counts;
  }, [rows]);

  const selectedRows =
    selectionCohortId === cohort?.id
      ? selected.flatMap((id) => {
          const row = cohort?.rows.find((item) => item.publicationId === id);
          return row === undefined ? [] : [row];
        })
      : [];
  const pairSelected = selectedRows.length === MAX_SELECTION;

  // Reconcile before rendering children when a refreshed catalog changes the current publications.
  if (cohortId !== cohort?.id) setCohortId(cohort?.id);
  if (selectionCohortId !== cohort?.id || selectedRows.length !== selected.length) {
    setSelectionCohortId(cohort?.id);
    setSelected(selectedRows.map((row) => row.publicationId));
    setDialogOpen(false);
    setLimitReached(false);
  }

  const changeCohort = (nextId: string) => {
    setCohortId(nextId);
    setSelectionCohortId(nextId);
    setSelected([]);
    setDialogOpen(false);
    setLimitReached(false);
  };

  const toggleSelection = (publicationId: string) => {
    if (selected.includes(publicationId)) {
      setSelected(selected.filter((id) => id !== publicationId));
      setLimitReached(false);
      return;
    }
    if (pairSelected) {
      setLimitReached(true);
      return;
    }
    setSelected([...selectedRows.map((row) => row.publicationId), publicationId]);
    setLimitReached(false);
  };

  const clearSelection = () => {
    setSelected([]);
    setDialogOpen(false);
    setLimitReached(false);
  };

  const clearFilters = () => {
    setSearch("");
    setCoverage("all");
  };

  const toggleSort = (key: SortKey) => {
    setSort((current) =>
      current !== null && current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "asc" },
    );
  };

  const [firstSelection, secondSelection] = selectedRows;
  const selectionStatus =
    firstSelection === undefined
      ? "Select two runs in this cohort to compare them side by side."
      : secondSelection === undefined
        ? `1 of ${MAX_SELECTION} selected: ${rowLabel(firstSelection)}. Choose one more run.`
        : `${MAX_SELECTION} of ${MAX_SELECTION} selected: ${rowLabel(firstSelection)} and ${rowLabel(secondSelection)}. Deselect one to change the pair.`;

  const filtersActive = query.length > 0 || coverage !== "all";

  if (cohort === undefined) {
    return (
      <>
        <ProductionNotice
          title="No current publications"
          description="The verified index contains no current results. There are no runs to compare yet."
          role="status"
        >
          <a className="prod-inline-link" href="#/methodology">
            How publications reach this page
          </a>
        </ProductionNotice>
        <WithdrawnNotice count={catalog.withdrawnCount} />
      </>
    );
  }

  return (
    <>
      <section className="prod-results-table-section" aria-labelledby="prod-results-title">
        <div className="prod-section-heading">
          <div>
            <p className="prod-kicker">Current publications</p>
            <h2 id="prod-results-title">Current runs</h2>
            <p>
              One cohort at a time. Sorting changes display order only; every result stays unranked.
            </p>
          </div>
        </div>

        <div className="prod-toolbar prod-results-toolbar">
          <label className="prod-select-field prod-results-cohort">
            <span>Comparable cohort</span>
            <select value={cohort.id} onChange={(event) => changeCohort(event.currentTarget.value)}>
              {catalog.cohorts.map((item) => (
                <option key={item.id} value={item.id}>
                  {cohortOptionLabel(item)}
                </option>
              ))}
            </select>
          </label>

          <div className="prod-search prod-results-search">
            <label className="prod-sr-only" htmlFor={searchId}>
              Search runs by model, candidate, reasoning, configuration pin or publication id
            </label>
            <Search size={15} aria-hidden="true" />
            <Input
              id={searchId}
              type="search"
              value={search}
              placeholder="Search runs"
              onChange={(event) => setSearch(event.currentTarget.value)}
            />
            {search.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="prod-results-search-clear"
                aria-label="Clear run search"
                onClick={() => setSearch("")}
              >
                <X size={14} aria-hidden="true" />
              </Button>
            )}
          </div>

          <div
            className="prod-segmented prod-results-coverage"
            role="group"
            aria-label="Coverage filter"
          >
            {COVERAGE_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                aria-pressed={coverage === filter.value}
                onClick={() => setCoverage(filter.value)}
              >
                {filter.label}{" "}
                <span className="prod-results-count">
                  {INTEGER.format(coverageCounts[filter.value])}
                </span>
              </button>
            ))}
          </div>
        </div>

        <details className="prod-results-conditions">
          <summary>
            <span>Benchmark conditions</span>
            <span>
              {cohort.conditions.suiteId} v{cohort.conditions.suiteVersion} ·{" "}
              {cohort.conditions.target}
              {" · "}Clean chat · {cohort.conditions.repetitions} repetitions per case
            </span>
          </summary>
          <div className="prod-results-conditions-body">
            <p className="prod-muted">
              Every row below was produced under these exact conditions. Runs from other cohorts
              never mix into this table or the comparison dialog.
            </p>
            <ComparisonConditions conditions={cohort.conditions} />
          </div>
        </details>

        <div className="prod-results-compare" role="region" aria-label="Comparison selection">
          <div className="prod-results-compare-copy">
            <p className="prod-results-compare-status" aria-live="polite">
              {selectionStatus}
            </p>
            {limitReached && (
              <p className="prod-results-compare-limit" role="status">
                Only {MAX_SELECTION} runs can be compared at once. Deselect one before choosing
                another.
              </p>
            )}
          </div>
          <div className="prod-results-compare-actions">
            <Button
              type="button"
              className="prod-button"
              disabled={!pairSelected}
              focusableWhenDisabled
              onClick={() => setDialogOpen(true)}
            >
              Compare selected
            </Button>
            {selected.length > 0 && (
              <Button type="button" variant="secondary" size="sm" onClick={clearSelection}>
                Clear selection
              </Button>
            )}
          </div>
        </div>

        {rows.length > 0 && (
          <p className="prod-muted prod-results-scroll-note">
            Scroll across the table for latency, token coverage and evidence.
          </p>
        )}
        {rows.length === 0 ? (
          <ProductionNotice
            title="No runs match"
            description={
              query.length > 0
                ? `No run in this cohort matches "${search.trim()}"${coverage === "all" ? "" : ` with ${coverage} coverage`}.`
                : `No run in this cohort has ${coverage} coverage.`
            }
            role="status"
          >
            <Button type="button" className="prod-button" onClick={clearFilters}>
              Clear search and filters
            </Button>
          </ProductionNotice>
        ) : (
          <div
            className="prod-table-scroll prod-results-scroll"
            role="region"
            aria-label="Results table, scroll horizontally to see all columns"
            tabIndex={0}
          >
            <table className="eval-table prod-results-table">
              <caption className="prod-results-caption">
                <span aria-live="polite">
                  Showing {INTEGER.format(rows.length)} of {INTEGER.format(cohort.rows.length)}{" "}
                  {cohort.rows.length === 1 ? "run" : "runs"} in this cohort
                  {filtersActive ? " after filters" : ""}.
                </span>
                {sort !== null && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setSort(null)}>
                    Reset to catalog order
                  </Button>
                )}
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="prod-results-select">
                    <span className="prod-sr-only">Select for comparison</span>
                  </th>
                  <SortHeader column="run" label="Run" sort={sort} onSort={toggleSort} />
                  <SortHeader
                    column="passRate"
                    label="Pass rate"
                    sort={sort}
                    onSort={toggleSort}
                    numeric
                  />
                  <SortHeader
                    column="attempts"
                    label="Attempts"
                    sort={sort}
                    onSort={toggleSort}
                    numeric
                  />
                  <SortHeader
                    column="latencyP50"
                    label="p50 latency"
                    sort={sort}
                    onSort={toggleSort}
                    numeric
                  />
                  <SortHeader
                    column="latencyP95"
                    label="p95 latency"
                    sort={sort}
                    onSort={toggleSort}
                    numeric
                  />
                  <SortHeader
                    column="tokenUsage"
                    label="Tokens"
                    sort={sort}
                    onSort={toggleSort}
                    numeric
                  />
                  <th scope="col">Coverage and evidence</th>
                  <SortHeader
                    column="publishedAt"
                    label="Published"
                    sort={sort}
                    onSort={toggleSort}
                  />
                  <th scope="col">Detail</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const isSelected = selected.includes(row.publicationId);
                  const tokenSample = tokenSampleLabel(row);
                  return (
                    <tr
                      key={row.publicationId}
                      className={
                        isSelected
                          ? "prod-results-row prod-results-row--selected"
                          : "prod-results-row"
                      }
                    >
                      <td className="prod-results-select">
                        <input
                          type="checkbox"
                          className="prod-results-check"
                          checked={isSelected}
                          aria-label={`Select ${rowLabel(row)}, publication ${row.publicationId}, for comparison`}
                          onChange={() => toggleSelection(row.publicationId)}
                        />
                      </td>
                      <td className="prod-results-run">
                        <CandidateIdentity row={row} />
                        <span
                          className={`prod-badge ${row.configuration.availability === "pinned" ? "prod-badge--neutral" : "prod-badge--warning"} prod-results-config`}
                          title={
                            row.configuration.availability === "pinned"
                              ? (row.configuration.pinnedSha256 ?? "Pinned configuration")
                              : "Configuration labels are published without a pinned configuration hash"
                          }
                        >
                          {configurationLabel(row)}
                        </span>
                      </td>
                      <td className="prod-results-num">
                        <MetricValue metric={row.metrics.passRate} />
                      </td>
                      <td className="prod-results-num">
                        <span className="eval-metric-value">
                          <strong>{INTEGER.format(row.counts.attempts.total)}</strong>
                          <small>
                            {INTEGER.format(row.counts.attempts.passed)} passed ·{" "}
                            {INTEGER.format(row.counts.attempts.failed)} failed ·{" "}
                            {INTEGER.format(row.coverage.plannedAttempts)} planned
                          </small>
                        </span>
                      </td>
                      <td className="prod-results-num">
                        <MetricValue metric={row.metrics.latencyP50} />
                      </td>
                      <td className="prod-results-num">
                        <MetricValue metric={row.metrics.latencyP95} compact />
                      </td>
                      <td className="prod-results-num">
                        <MetricValue
                          metric={row.metrics.tokenUsage}
                          compact={tokenSample !== null}
                        />
                        {tokenSample !== null && (
                          <small className="prod-results-sample">{tokenSample}</small>
                        )}
                      </td>
                      <td>
                        <div className="prod-results-status">
                          <CoverageBadge row={row} />
                          <ResultState row={row} />
                        </div>
                      </td>
                      <td>
                        <span className="prod-results-published">
                          {formatProductionDate(row.publishedAt)}
                          <small title={row.publication.supersedes?.summary}>
                            {revisionLabel(row)}
                          </small>
                        </span>
                      </td>
                      <td className="prod-results-links">
                        <a className="prod-inline-link" href={runHref(row.publicationId)}>
                          Run detail
                        </a>
                        {row.evidence === "available" ? (
                          <a className="prod-inline-link" href={attemptsHref(row.publicationId)}>
                            Attempts
                          </a>
                        ) : (
                          <span className="prod-muted">No attempt detail</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <WithdrawnNotice count={catalog.withdrawnCount} />
      </section>

      <section className="prod-results-secondary" aria-labelledby="prod-results-secondary-title">
        <div className="prod-section-heading">
          <div>
            <p className="prod-kicker">Secondary views</p>
            <h2 id="prod-results-secondary-title">Latency and retained usage</h2>
            <p>
              Charts include visible rows with both metrics available. Missing values are omitted,
              never plotted as zero.
            </p>
          </div>
        </div>
        <div className="eval-two-column prod-results-charts">
          <Panel
            title="Pass rate and p50 latency"
            description="Complete-coverage runs plotted against median attempt duration."
          >
            {chartCounts.latencyP50 >= 2 ? (
              <ComparisonScatterPlot
                rows={rows}
                metric="latencyP50"
                title="Pass rate and p50 latency"
              />
            ) : (
              <p className="prod-muted prod-results-chart-empty">
                Fewer than two visible runs have both a pass rate and a p50 latency, so no chart is
                drawn.
              </p>
            )}
          </Panel>
          <Panel
            title="Pass rate and retained tokens"
            description="Complete-coverage runs plotted against total tokens over attempts that retained usage."
          >
            {chartCounts.tokenUsage >= 2 ? (
              <ComparisonScatterPlot
                rows={rows}
                metric="tokenUsage"
                title="Pass rate and retained tokens"
              />
            ) : (
              <p className="prod-muted prod-results-chart-empty">
                Fewer than two visible runs have both a pass rate and retained token usage, so no
                chart is drawn.
              </p>
            )}
            <p className="prod-muted prod-results-chart-note">
              Totals cover retained samples only, and sample counts can differ between runs. See
              each row's sample count before comparing totals. Fewer tokens do not establish lower
              cost or better efficiency.
            </p>
          </Panel>
        </div>
        <Panel
          title="Reserved metrics"
          description="Unavailable states reported across this cohort. No accuracy, cost or uncertainty is estimated from the observed counts."
          className="prod-results-reserved"
        >
          <dl className="prod-record-list prod-results-reserved-list">
            {RESERVED_METRICS.map((definition) => {
              const states = reservedStates(cohort.rows, definition.id);
              return (
                <div key={definition.id}>
                  <dt>
                    {definition.label}
                    <small>{definition.description}</small>
                  </dt>
                  <dd>
                    {states.length === 0 ? (
                      <span className="prod-muted">No current publications</span>
                    ) : (
                      states.map((metric) => (
                        <MetricValue
                          key={
                            metric.availability === "available"
                              ? "available"
                              : `${metric.availability}:${metric.reason}`
                          }
                          metric={metric}
                        />
                      ))
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </Panel>
      </section>

      <ComparisonDialog
        cohort={cohort}
        selectedPublicationIds={selected}
        open={dialogOpen && pairSelected}
        onClose={() => setDialogOpen(false)}
      />
    </>
  );
}

export interface ResultsPageProps {
  state: PublicComparisonState;
  initialCohortId?: string;
  initialSearch?: string;
  initialCompareIds?: readonly string[];
}

export function ResultsPage({
  state,
  initialCohortId,
  initialSearch = "",
  initialCompareIds = [],
}: ResultsPageProps) {
  return (
    <ProductionShell active="results" catalog={state.catalog ?? undefined}>
      <div className="eval-container prod-results">
        <ResultsHero catalog={state.catalog} />
        {state.status === "ready" ? (
          <ReadyResults
            catalog={state.catalog}
            initialCohortId={initialCohortId}
            initialSearch={initialSearch}
            initialCompareIds={initialCompareIds}
          />
        ) : (
          <ProductionLoadState state={state} />
        )}
      </div>
    </ProductionShell>
  );
}
