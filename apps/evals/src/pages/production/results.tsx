import { Fragment, useId, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronRight, ChevronsUpDown, Search, X } from "lucide-react";
import { FamilyTabs, Panel } from "../../components/eval-ui";
import { ComparisonScatterPlot } from "../../components/public-comparison-charts";
import {
  ComparisonConditions,
  MetricValue,
  ResultState,
} from "../../components/public-comparison-ui";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import type { FamilyFilter } from "../../data";
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
const COLUMN_COUNT = 9;

type CoverageFilter = "all" | "complete" | "incomplete";

const DEFAULT_FAMILY: FamilyFilter = "All tasks";

const COVERAGE_FILTERS: readonly { value: CoverageFilter; label: string }[] = [
  { value: "all", label: "All coverage" },
  { value: "complete", label: "Complete" },
  { value: "incomplete", label: "Incomplete" },
];

type SortKey = "model" | "runCount" | "passRate" | "latencyP50" | "tokenUsage" | "publishedAt";
type SortDirection = "asc" | "desc";

interface SortState {
  key: SortKey;
  direction: SortDirection;
}

/** One current publication together with the cohort whose conditions produced it. */
interface RunEntry {
  row: PublicComparisonRow;
  cohort: PublicComparisonCohort;
  startedMillis: number | null;
  publishedMillis: number | null;
}

/** One exact configuration pin, or a standalone run without a published pin. */
interface VariantGroup {
  key: string;
  pinned: boolean;
  newest: RunEntry;
  runs: RunEntry[];
}

interface ModelGroup {
  model: string;
  variants: readonly VariantGroup[];
  pinnedVariantCount: number;
  labelsOnlyCount: number;
  runCount: number;
  cohortCount: number;
  metricRun: RunEntry | null;
  latestPublication: RunEntry;
}

interface ModelDraft {
  model: string;
  metricRun: RunEntry | null;
  latestPublication: RunEntry;
  variants: Map<string, VariantGroup>;
  cohortIds: Set<string>;
  runCount: number;
}

const RESERVED_METRICS = PUBLIC_METRIC_DEFINITIONS.filter(
  (metric) => metric.unit === "unavailable",
);

const plural = (count: number, noun: string, nouns = `${noun}s`): string =>
  `${INTEGER.format(count)} ${count === 1 ? noun : nouns}`;

const parseMillis = (timestamp: string): number | null => {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? null : parsed;
};

// Unparseable timestamps sort after real ones.
const newestFirst = (left: number | null, right: number | null): number => {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  return right - left;
};

// A correction changes publication time, not run start. Publication identity breaks remaining ties.
const compareRuns = (left: RunEntry, right: RunEntry): number =>
  newestFirst(left.startedMillis, right.startedMillis) ||
  newestFirst(left.publishedMillis, right.publishedMillis) ||
  left.row.publicationId.localeCompare(right.row.publicationId, "en");

/** All-cohort inventory; only the selected cohort can supply a model's metric run. */
const groupModels = (
  catalog: PublicComparisonCatalog,
  coverage: CoverageFilter,
  selectedCohortId: string | undefined,
): ModelGroup[] => {
  const drafts = new Map<string, ModelDraft>();
  for (const cohort of catalog.cohorts) {
    for (const row of cohort.rows) {
      if (coverage !== "all" && row.coverage.status !== coverage) continue;
      const run: RunEntry = {
        row,
        cohort,
        startedMillis: parseMillis(row.startedAt),
        publishedMillis: parseMillis(row.publishedAt),
      };
      let draft = drafts.get(row.model);
      if (draft === undefined) {
        draft = {
          model: row.model,
          metricRun: null,
          latestPublication: run,
          variants: new Map(),
          cohortIds: new Set(),
          runCount: 0,
        };
        drafts.set(row.model, draft);
      }
      if (
        cohort.id === selectedCohortId &&
        (draft.metricRun === null || compareRuns(run, draft.metricRun) < 0)
      ) {
        draft.metricRun = run;
      }
      const publicationOrder =
        newestFirst(run.publishedMillis, draft.latestPublication.publishedMillis) ||
        row.publicationId.localeCompare(draft.latestPublication.row.publicationId, "en");
      if (publicationOrder < 0) draft.latestPublication = run;
      draft.cohortIds.add(cohort.id);
      draft.runCount += 1;
      // The full pin already encodes labels and conditions. Labels-only publications never merge.
      const pinned = row.configuration.availability === "pinned";
      const key = pinned ? `pinned:${row.configuration.pinnedSha256}` : `run:${row.publicationId}`;
      const variant = draft.variants.get(key);
      if (variant === undefined) {
        draft.variants.set(key, { key, pinned, newest: run, runs: [run] });
      } else {
        if (compareRuns(run, variant.newest) < 0) variant.newest = run;
        variant.runs.push(run);
      }
    }
  }
  return [...drafts.values()].map((draft) => {
    const variants = [...draft.variants.values()];
    let pinnedVariantCount = 0;
    for (const variant of variants) {
      variant.runs.sort(compareRuns);
      if (variant.pinned) pinnedVariantCount += 1;
    }
    // Reproducible variants first, then labels-only runs; newest first within each.
    variants.sort(
      (left, right) =>
        Number(right.pinned) - Number(left.pinned) || compareRuns(left.newest, right.newest),
    );
    return {
      model: draft.model,
      variants,
      pinnedVariantCount,
      labelsOnlyCount: variants.length - pinnedVariantCount,
      runCount: draft.runCount,
      cohortCount: draft.cohortIds.size,
      metricRun: draft.metricRun,
      latestPublication: draft.latestPublication,
    };
  });
};

const modelSortValue = (group: ModelGroup, key: Exclude<SortKey, "model">): number | null => {
  switch (key) {
    case "runCount":
      return group.runCount;
    case "publishedAt":
      return group.latestPublication.publishedMillis;
    default: {
      if (group.metricRun === null) return null;
      const metric = group.metricRun.row.metrics[key];
      return metric.availability === "available" && Number.isFinite(metric.value)
        ? metric.value
        : null;
    }
  }
};

// Missing values stay last in either direction; the model string breaks ties.
const compareModels =
  (sort: SortState) =>
  (left: ModelGroup, right: ModelGroup): number => {
    let order = 0;
    if (sort.key === "model") {
      order = left.model.localeCompare(right.model, "en");
    } else {
      const a = modelSortValue(left, sort.key);
      const b = modelSortValue(right, sort.key);
      if (a === null && b !== null) return 1;
      if (a !== null && b === null) return -1;
      if (a !== null && b !== null) order = a - b;
    }
    return (
      (sort.direction === "asc" ? order : -order) || left.model.localeCompare(right.model, "en")
    );
  };

const matchesSearch = (row: PublicComparisonRow, query: string): boolean =>
  query.length === 0 ||
  `${row.model} ${row.candidate} ${row.reasoning ?? ""} ${row.publicationId} ${configurationLabel(row)} ${row.configuration.pinnedSha256 ?? "labels-only"}`
    .toLowerCase()
    .includes(query);

const conditionsSummary = (cohort: PublicComparisonCohort): string => {
  const { conditions } = cohort;
  return `${conditions.suiteId} v${conditions.suiteVersion} · ${conditions.target} · ${conditions.accountClass} · clean chat · ${plural(conditions.repetitions, "repetition")} per case · fixtures v${conditions.fixtureVersion} · catalog ${conditions.catalogSha}`;
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

const rowLabel = (row: PublicComparisonRow): string =>
  `${row.model}, ${row.candidate}, publication ${row.publicationId}`;

const configurationLabel = (row: PublicComparisonRow): string => {
  if (row.configuration.availability !== "pinned") return "Labels only";
  const sha = row.configuration.pinnedSha256;
  return sha === null ? "Pinned configuration" : `Pinned ${sha.slice(0, 8)}`;
};

const variantSummary = (group: ModelGroup): string => {
  const parts: string[] = [];
  if (group.pinnedVariantCount > 0) parts.push(plural(group.pinnedVariantCount, "pinned variant"));
  if (group.labelsOnlyCount > 0) parts.push(plural(group.labelsOnlyCount, "labels-only run"));
  return parts.join(" · ");
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

/** Model metrics use only the selected cohort; expanded runs report their own conditions. */
function MetricCells({ row }: { row: PublicComparisonRow | null }) {
  if (row === null) {
    return (
      <td colSpan={5} className="prod-results-not-in-cohort">
        Not in this cohort
        <small>No current run matches the selected cohort and coverage filter.</small>
      </td>
    );
  }
  const tokenSample = tokenSampleLabel(row);
  return (
    <>
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
        <MetricValue metric={row.metrics.tokenUsage} compact={tokenSample !== null} />
        {tokenSample !== null && <small className="prod-results-sample">{tokenSample}</small>}
      </td>
      <td>
        <div className="prod-results-status">
          <CoverageBadge row={row} />
          <ResultState row={row} />
        </div>
      </td>
    </>
  );
}

function PublishedCell({ row, latest = false }: { row: PublicComparisonRow; latest?: boolean }) {
  return (
    <td>
      <span className="prod-results-published">
        <time dateTime={row.publishedAt} title={row.publishedAt}>
          {formatProductionDate(row.publishedAt)}
        </time>
        <small title={row.publication.supersedes?.summary}>{revisionLabel(row)}</small>
        {latest && <small>Latest across cohorts</small>}
      </span>
    </td>
  );
}

function RunRow({
  run,
  variantId,
  cohortId,
  selected,
  onToggleSelection,
}: {
  run: RunEntry;
  variantId: string;
  cohortId: string;
  selected: readonly string[];
  onToggleSelection: (publicationId: string) => void;
}) {
  const selectionNoteId = useId();
  const { row, cohort } = run;
  const comparable = cohort.id === cohortId;
  const isSelected = comparable && selected.includes(row.publicationId);
  return (
    <tr
      className={
        isSelected
          ? "prod-results-row prod-results-run-row prod-results-row--selected"
          : "prod-results-row prod-results-run-row"
      }
    >
      <td className="prod-results-select">
        <input
          type="checkbox"
          className="prod-results-check"
          checked={isSelected}
          disabled={!comparable}
          aria-label={`Select ${rowLabel(row)} for comparison`}
          aria-describedby={comparable ? undefined : selectionNoteId}
          onChange={() => onToggleSelection(row.publicationId)}
        />
      </td>
      <th scope="row" headers={variantId} colSpan={2} className="prod-results-run">
        <code className="prod-results-run-id">{row.publicationId}</code>
        <span className="prod-results-run-cohort">
          Started{" "}
          <time dateTime={row.startedAt} title={row.startedAt}>
            {formatProductionDate(row.startedAt)}
          </time>
          {" · "}
          {conditionsSummary(cohort)}
        </span>
        {!comparable && (
          <span id={selectionNoteId} className="prod-results-select-note">
            Other cohort. Select these conditions in Benchmark conditions to compare this run.
            Changing cohort clears the current selection.
          </span>
        )}
        <span className="prod-results-links">
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
        </span>
      </th>
      <MetricCells row={row} />
      <PublishedCell row={row} />
    </tr>
  );
}

function ModelRows({
  group,
  open,
  headline,
  cohortId,
  selected,
  onToggleOpen,
  onToggleSelection,
}: {
  group: ModelGroup;
  open: boolean;
  headline: string;
  cohortId: string;
  selected: readonly string[];
  onToggleOpen: (model: string) => void;
  onToggleSelection: (publicationId: string) => void;
}) {
  const detailsId = useId();
  const { metricRun } = group;
  return (
    <>
      <tbody>
        <tr className="prod-results-row prod-results-model-row">
          <td className="prod-results-select">
            <button
              type="button"
              className="prod-results-expand"
              aria-expanded={open}
              aria-controls={detailsId}
              onClick={() => onToggleOpen(group.model)}
            >
              <ChevronRight size={14} aria-hidden="true" />
              <span className="prod-sr-only">
                {open ? "Collapse" : "Expand"} {group.model}, {plural(group.runCount, "run")}
              </span>
            </button>
          </td>
          <th scope="row" className="prod-results-model">
            <div className="prod-results-model-identity">
              <span className="prod-results-model-mark" aria-hidden="true">
                {group.model.charAt(0).toUpperCase()}
              </span>
              <div className="prod-results-model-copy">
                <strong>{group.model}</strong>
                <span className="prod-results-model-meta">{variantSummary(group)}</span>
                {metricRun !== null && (
                  <small className="prod-results-headline">
                    Figures from its{" "}
                    <a className="prod-inline-link" href={runHref(metricRun.row.publicationId)}>
                      {headline}
                    </a>{" "}
                    in the selected cohort
                    {metricRun.row.reasoning !== null && ` · ${metricRun.row.reasoning}`}
                    {" · "}
                    {configurationLabel(metricRun.row)}
                  </small>
                )}
              </div>
            </div>
          </th>
          <td className="prod-results-num">
            <span className="eval-metric-value">
              <strong>{INTEGER.format(group.runCount)}</strong>
              <small>across {plural(group.cohortCount, "cohort")}</small>
            </span>
          </td>
          <MetricCells row={metricRun?.row ?? null} />
          <PublishedCell row={group.latestPublication.row} latest />
        </tr>
      </tbody>
      <tbody id={detailsId} hidden={!open}>
        {open &&
          group.variants.map((variant, index) => {
            const { row } = variant.newest;
            const variantId = `${detailsId}-${index}`;
            return (
              <Fragment key={variant.key}>
                <tr
                  className={
                    variant.pinned
                      ? "prod-results-variant-row"
                      : "prod-results-variant-row prod-results-variant-row--labels"
                  }
                >
                  <th id={variantId} colSpan={COLUMN_COUNT} className="prod-results-variant">
                    <div className="prod-results-variant-content">
                      <CandidateIdentity row={row} linked={false} />
                      <span
                        className={`prod-badge ${variant.pinned ? "prod-badge--neutral" : "prod-badge--warning"} prod-results-config`}
                        title={
                          variant.pinned
                            ? (row.configuration.pinnedSha256 ?? undefined)
                            : "Configuration labels are published without a pinned configuration hash"
                        }
                      >
                        {configurationLabel(row)}
                      </span>
                      <span className="prod-results-variant-detail">
                        {variant.pinned
                          ? `${plural(variant.runs.length, "run shares", "runs share")} this exact pin. Newest run start first.`
                          : "Standalone labels-only run, not a reproducible variant."}
                      </span>
                    </div>
                  </th>
                </tr>
                {variant.runs.map((run) => (
                  <RunRow
                    key={run.row.publicationId}
                    run={run}
                    variantId={variantId}
                    cohortId={cohortId}
                    selected={selected}
                    onToggleSelection={onToggleSelection}
                  />
                ))}
              </Fragment>
            );
          })}
      </tbody>
    </>
  );
}

function ResultsHero({ catalog }: { catalog: PublicComparisonCatalog | null }) {
  const currentCount =
    catalog === null ? 0 : catalog.cohorts.reduce((sum, cohort) => sum + cohort.rows.length, 0);
  return (
    <ProductionHero
      eyebrow="Public conformance results"
      title="Explore models and their runs"
      description="Open a model to inspect its configurations, current runs, and evidence. Headline metrics and run comparisons use the selected benchmark cohort."
    >
      {catalog !== null && (
        <div>
          <p className="prod-muted">Global public index · all tasks and cohorts</p>
          <dl className="prod-results-facts" aria-label="Global public index summary">
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
        </div>
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
  initialFamily,
  initialCohortId,
  initialSearch,
  initialCompareIds,
}: {
  catalog: PublicComparisonCatalog;
  initialFamily: FamilyFilter;
  initialCohortId: string | undefined;
  initialSearch: string;
  initialCompareIds: readonly string[];
}) {
  const searchId = useId();
  const navigationRef = useRef<HTMLDivElement>(null);
  const [family, setFamily] = useState(initialFamily);
  const [cohortId, setCohortId] = useState(() =>
    resolveInitialCohortId(catalog, initialCohortId, initialCompareIds),
  );
  const cohort = catalog.cohorts.find((item) => item.id === cohortId) ?? catalog.cohorts[0];
  const [search, setSearch] = useState(initialSearch);
  const [coverage, setCoverage] = useState<CoverageFilter>("all");
  const [sort, setSort] = useState<SortState | null>(null);
  const [selected, setSelected] = useState<readonly string[]>(() =>
    initialFamily === DEFAULT_FAMILY ? selectableIds(cohort, initialCompareIds) : [],
  );
  const [selectionCohortId, setSelectionCohortId] = useState(cohort?.id);
  const [dialogOpen, setDialogOpen] = useState(selected.length === MAX_SELECTION);
  const [limitReached, setLimitReached] = useState(false);
  // Manual expansion belongs to the search it was made under; a new search starts from its matches.
  const [expansion, setExpansion] = useState<{
    query: string;
    models: ReadonlySet<string>;
  } | null>(null);

  const query = search.trim().toLowerCase();

  const totals = useMemo(() => {
    const models = new Set<string>();
    const coverageCounts = { all: 0, complete: 0, incomplete: 0 };
    for (const item of catalog.cohorts) {
      for (const row of item.rows) {
        models.add(row.model);
        coverageCounts.all += 1;
        coverageCounts[row.coverage.status] += 1;
      }
    }
    return { models: models.size, coverage: coverageCounts };
  }, [catalog]);

  const grouped = useMemo(
    () => groupModels(catalog, coverage, cohort?.id),
    [catalog, coverage, cohort?.id],
  );

  const { models, runCount, searchExpanded } = useMemo(() => {
    const searchExpanded = new Set<string>();
    const models = grouped.filter((group) => {
      if (query.length === 0) return true;
      const matched = group.variants.some((variant) =>
        variant.runs.some((run) => matchesSearch(run.row, query)),
      );
      if (matched) searchExpanded.add(group.model);
      return matched;
    });
    if (sort !== null) models.sort(compareModels(sort));
    return {
      models,
      runCount: models.reduce((sum, group) => sum + group.runCount, 0),
      searchExpanded,
    };
  }, [grouped, query, sort]);

  // Keep chart filtering run-scoped, even when a search keeps a whole model visible in the table.
  const chartRows = useMemo(
    () =>
      (cohort?.rows ?? []).filter(
        (row) =>
          (coverage === "all" || row.coverage.status === coverage) && matchesSearch(row, query),
      ),
    [cohort, coverage, query],
  );

  const chartCounts = useMemo(() => {
    const counts = { latencyP50: 0, tokenUsage: 0 };
    for (const row of chartRows) {
      if (row.metrics.passRate.availability !== "available") continue;
      if (row.metrics.latencyP50.availability === "available") counts.latencyP50 += 1;
      if (row.metrics.tokenUsage.availability === "available") counts.tokenUsage += 1;
    }
    return counts;
  }, [chartRows]);

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

  const expanded: ReadonlySet<string> =
    expansion !== null && expansion.query === query
      ? expansion.models
      : new Set([...searchExpanded, ...selectedRows.map((row) => row.model)]);

  const toggleModel = (model: string) => {
    const next = new Set(expanded);
    if (!next.delete(model)) next.add(model);
    setExpansion({ query, models: next });
  };

  const changeCohort = (nextId: string) => {
    setCohortId(nextId);
    setSelectionCohortId(nextId);
    setSelected([]);
    setDialogOpen(false);
    setLimitReached(false);
  };

  const toggleSelection = (publicationId: string) => {
    if (!cohort?.rows.some((row) => row.publicationId === publicationId)) return;
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

  const changeSearch = (value: string) => {
    setSearch(value);
    setExpansion(null);
  };

  const clearFilters = () => {
    changeSearch("");
    setCoverage("all");
  };

  // Comparison pairs belong to the all-task table; never carry one across a family switch.
  const changeFamily = (next: FamilyFilter) => {
    if (next === family) return;
    setFamily(next);
    clearSelection();
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
      ? "Select two runs under the selected benchmark conditions to compare them side by side. Expand a model to reach its runs."
      : secondSelection === undefined
        ? `1 of ${MAX_SELECTION} selected: ${rowLabel(firstSelection)}. Choose one more run under the same conditions.`
        : `${MAX_SELECTION} of ${MAX_SELECTION} selected: ${rowLabel(firstSelection)} and ${rowLabel(secondSelection)}. Deselect one to change the pair.`;

  const filtersActive = query.length > 0 || coverage !== "all";
  const coverageLabel = COVERAGE_FILTERS.find((filter) => filter.value === coverage)?.label;
  const headline = coverage === "all" ? "newest run" : `newest ${coverage}-coverage run`;

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
      <div className="prod-results-nav" ref={navigationRef}>
        <FamilyTabs value={family} onChange={changeFamily} />

        <div className="prod-search prod-results-search">
          <label className="prod-sr-only" htmlFor={searchId}>
            Search models by model, candidate, reasoning, configuration pin or publication id
          </label>
          <Search size={15} aria-hidden="true" />
          <Input
            id={searchId}
            type="search"
            value={search}
            placeholder="Search models"
            disabled={family !== DEFAULT_FAMILY}
            onChange={(event) => changeSearch(event.currentTarget.value)}
          />
          {search.length > 0 && family === DEFAULT_FAMILY && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="prod-results-search-clear"
              aria-label="Clear model search"
              onClick={() => changeSearch("")}
            >
              <X size={14} aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>

      {family !== DEFAULT_FAMILY ? (
        <section className="prod-results-family-notice" aria-labelledby="prod-results-family-title">
          <h2 id="prod-results-family-title">{family}</h2>
          <p>The {family} breakdown is not published in the current public results.</p>
          <Button
            type="button"
            className="prod-button"
            onClick={() => {
              changeFamily(DEFAULT_FAMILY);
              navigationRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
            }}
          >
            Return to All tasks
          </Button>
        </section>
      ) : (
        <>
          <section className="prod-results-table-section" aria-labelledby="prod-results-title">
            <div className="prod-section-heading">
              <div>
                <p className="prod-kicker">Current publications</p>
                <h2 id="prod-results-title">Models</h2>
                <p>
                  Expand a model to see its configurations and runs. Headline figures come from its
                  newest run under the selected benchmark conditions. Sorting changes display order,
                  not rank.
                </p>
              </div>
            </div>

            <details className="prod-results-conditions">
              <summary>
                <span>Benchmark conditions for metrics and comparison</span>
                <span>
                  {cohort.conditions.suiteId} v{cohort.conditions.suiteVersion} ·{" "}
                  {cohort.conditions.target}
                  {" · "}Clean chat · {cohort.conditions.repetitions} repetitions per case
                  {" · "}
                  {coverageLabel}
                </span>
              </summary>
              <div className="prod-results-conditions-body">
                <div className="prod-results-conditions-controls">
                  <label className="prod-select-field prod-results-cohort">
                    <span>Comparable cohort</span>
                    <select
                      value={cohort.id}
                      onChange={(event) => changeCohort(event.currentTarget.value)}
                    >
                      {catalog.cohorts.map((item) => (
                        <option key={item.id} value={item.id}>
                          {conditionsSummary(item)} · {plural(item.rows.length, "run")}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div
                    className="prod-segmented prod-results-coverage"
                    role="group"
                    aria-label="Coverage filter across all cohorts"
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
                          {INTEGER.format(totals.coverage[filter.value])}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <p className="prod-muted">
                  Model metrics, metric sorts, comparison pairs, and charts use these conditions.
                  Counts and latest-publication context cover all cohorts. Coverage filters apply
                  across all cohorts; search keeps each matching model's variants and runs visible.
                  Runs from other cohorts cannot be selected for comparison. Changing this cohort
                  clears the current selection.
                </p>
                <ComparisonConditions conditions={cohort.conditions} />
              </div>
            </details>

            {models.length > 0 && (
              <p className="prod-muted prod-results-scroll-note">
                Scroll across the table for latency, token coverage and evidence.
              </p>
            )}
            {models.length === 0 ? (
              <ProductionNotice
                title="No models match"
                description={
                  query.length > 0
                    ? `No model matches "${search.trim()}"${coverage === "all" ? "" : ` among runs with ${coverage} coverage`}.`
                    : `No current run has ${coverage} coverage.`
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
                      Showing {INTEGER.format(models.length)} of {plural(totals.models, "model")}{" "}
                      and {INTEGER.format(runCount)} of {plural(totals.coverage.all, "current run")}{" "}
                      across {plural(catalog.cohorts.length, "cohort")}
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
                        <span className="prod-sr-only">Expand model or select run</span>
                      </th>
                      <SortHeader column="model" label="Model" sort={sort} onSort={toggleSort} />
                      <SortHeader
                        column="runCount"
                        label="Runs"
                        sort={sort}
                        onSort={toggleSort}
                        numeric
                      />
                      <SortHeader
                        column="passRate"
                        label="Pass rate"
                        sort={sort}
                        onSort={toggleSort}
                        numeric
                      />
                      <th scope="col" className="prod-results-num">
                        Attempts
                      </th>
                      <SortHeader
                        column="latencyP50"
                        label="p50 latency"
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
                        label="Latest published"
                        sort={sort}
                        onSort={toggleSort}
                      />
                    </tr>
                  </thead>
                  {models.map((group) => (
                    <ModelRows
                      key={group.model}
                      group={group}
                      open={expanded.has(group.model)}
                      headline={headline}
                      cohortId={cohort.id}
                      selected={selected}
                      onToggleOpen={toggleModel}
                      onToggleSelection={toggleSelection}
                    />
                  ))}
                </table>
              </div>
            )}

            {selected.length > 0 && (
              <div className="prod-results-compare" role="region" aria-label="Comparison selection">
                <div className="prod-results-compare-copy">
                  <p className="prod-results-compare-status" aria-live="polite">
                    {selectionStatus}
                  </p>
                  {limitReached && (
                    <p className="prod-results-compare-limit" role="status">
                      Only {MAX_SELECTION} runs can be compared at once. Deselect one before
                      choosing another.
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
                  <Button type="button" variant="secondary" size="sm" onClick={clearSelection}>
                    Clear selection
                  </Button>
                </div>
              </div>
            )}

            <WithdrawnNotice count={catalog.withdrawnCount} />
          </section>

          <section
            className="prod-results-secondary"
            aria-labelledby="prod-results-secondary-title"
          >
            <div className="prod-section-heading">
              <div>
                <p className="prod-kicker">Secondary views</p>
                <h2 id="prod-results-secondary-title">Latency and retained usage</h2>
                <p>
                  Charts include runs under the selected benchmark conditions that pass the current
                  filters and have both metrics available. Missing values are omitted, never plotted
                  as zero.
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
                    rows={chartRows}
                    metric="latencyP50"
                    title="Pass rate and p50 latency"
                  />
                ) : (
                  <p className="prod-muted prod-results-chart-empty">
                    Fewer than two runs under the selected conditions have both a pass rate and a
                    p50 latency, so no chart is drawn.
                  </p>
                )}
              </Panel>
              <Panel
                title="Pass rate and retained tokens"
                description="Complete-coverage runs plotted against total tokens over attempts that retained usage."
              >
                {chartCounts.tokenUsage >= 2 ? (
                  <ComparisonScatterPlot
                    rows={chartRows}
                    metric="tokenUsage"
                    title="Pass rate and retained tokens"
                  />
                ) : (
                  <p className="prod-muted prod-results-chart-empty">
                    Fewer than two runs under the selected conditions have both a pass rate and
                    retained token usage, so no chart is drawn.
                  </p>
                )}
                <p className="prod-muted prod-results-chart-note">
                  Totals cover retained samples only, and sample counts can differ between runs. See
                  each run's sample count before comparing totals. Fewer tokens do not establish
                  lower cost or better efficiency.
                </p>
              </Panel>
            </div>
            <Panel
              title="Reserved metrics"
              description="Unavailable states reported under the selected benchmark conditions. No accuracy, cost or uncertainty is estimated from the observed counts."
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
      )}
    </>
  );
}

export interface ResultsPageProps {
  state: PublicComparisonState;
  initialFamily?: FamilyFilter;
  initialCohortId?: string;
  initialSearch?: string;
  initialCompareIds?: readonly string[];
}

export function ResultsPage({
  state,
  initialFamily = DEFAULT_FAMILY,
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
            initialFamily={initialFamily}
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
