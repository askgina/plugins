import { useMemo, useState } from "react";
import { BookOpen, BriefcaseBusiness, Search, ShieldCheck, X } from "lucide-react";
import { FamilyTabs, ModelAvatar, PageShell, Panel } from "../components/eval-ui";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  canonicalCampaigns,
  type CanonicalCampaign,
  type CanonicalModel,
  type CanonicalRun,
} from "../canonical/canonical";
import {
  AvailabilityMark,
  HeadlineValue,
  LatencyValue,
  SampleCount,
} from "../canonical/components";
import {
  caseDefinitionsForFamily,
  cohortLabel,
  cohortsForFamily,
  derivedCostPerTask,
  getModel,
  headlineFor,
  headlineSortKey,
  inCohort,
  runsForFamily,
  type DerivedCost,
  type Headline,
} from "../canonical/selectors";
import "./leaderboard.css";

const leaderboardFamilies = ["Spot", "Perps", "Predictions"] as const;
type LeaderboardFamily = (typeof leaderboardFamilies)[number];

const ALL_COHORTS = "all";

type SortMetric = "headline" | "latency";
type SortDirection = "asc" | "desc";

/** One leaderboard row: a single measured canonical run. */
interface LeaderboardRow {
  readonly run: CanonicalRun;
  readonly model: CanonicalModel | undefined;
  readonly campaign: CanonicalCampaign | undefined;
}

interface CohortGroup {
  readonly cohortId: string;
  readonly label: string;
  readonly rows: readonly LeaderboardRow[];
}

const campaignById: Record<string, CanonicalCampaign> = Object.fromEntries(
  canonicalCampaigns.map((campaign) => [campaign.campaignId, campaign]),
);

const numberFormatter = new Intl.NumberFormat("en-US");
const costFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});

const benefits = [
  {
    title: "Open evals",
    description: "Prompts, fixtures, and scoring you can inspect.",
    icon: BookOpen,
  },
  {
    title: "Real financial tasks",
    description: "Research, analysis, and tool use in one run.",
    icon: BriefcaseBusiness,
  },
  {
    title: "Safety first",
    description: "Knowing when to stop is part of the score.",
    icon: ShieldCheck,
  },
] as const;

const metricLabels: Record<SortMetric, string> = {
  headline: "pass rate",
  latency: "p50 latency",
};

function paddedDomain(values: readonly number[], paddingRatio: number): readonly [number, number] {
  if (values.length === 0) return [0, 1];
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = maximum - minimum || Math.abs(maximum) * 0.2 || 1;
  const padding = span * paddingRatio;
  return [minimum - padding, maximum + padding];
}

/** Single sort rule: key order, unavailable always last, runId breaks ties. */
function sortedRows(
  rows: readonly LeaderboardRow[],
  metric: SortMetric,
  direction: SortDirection,
): LeaderboardRow[] {
  const keyFor = (row: LeaderboardRow): number | null => {
    if (metric === "headline") {
      const key = headlineSortKey(row.run);
      return key < 0 ? null : key;
    }
    const latency = row.run.metrics.latencyMs;
    return latency.availability === "available" || latency.availability === "aggregate_only"
      ? latency.p50
      : null;
  };
  return rows.slice().sort((left, right) => {
    const leftKey = keyFor(left);
    const rightKey = keyFor(right);
    if (leftKey === null && rightKey === null) {
      return left.run.runId.localeCompare(right.run.runId);
    }
    if (leftKey === null) return 1;
    if (rightKey === null) return -1;
    const difference = leftKey - rightKey;
    if (difference === 0) return left.run.runId.localeCompare(right.run.runId);
    return direction === "asc" ? difference : -difference;
  });
}

function SortButton({
  label,
  metric,
  activeMetric,
  direction,
  onSort,
}: {
  label: string;
  metric: SortMetric;
  activeMetric: SortMetric;
  direction: SortDirection;
  onSort: (metric: SortMetric) => void;
}) {
  const active = metric === activeMetric;
  return (
    <button className="lb-sort-button" type="button" onClick={() => onSort(metric)}>
      <span>{label}</span>
      <span
        className={active ? "lb-sort-arrow lb-sort-arrow-active" : "lb-sort-arrow"}
        aria-hidden="true"
      >
        {active ? (direction === "desc" ? "↓" : "↑") : "↕"}
      </span>
      <span className="lb-visually-hidden">
        {active
          ? `, sorted ${direction === "desc" ? "descending" : "ascending"}`
          : ", activate to sort"}
      </span>
    </button>
  );
}

/** Derived per-task cost — always labelled derived, with price provenance. */
function CostValue({ cost }: { cost: DerivedCost }) {
  if (cost.availability !== "available") {
    return <AvailabilityMark availability={cost.availability} reason={cost.reason} />;
  }
  return (
    <span className="lb-cost-stack">
      <span className="lb-count">est. {costFormatter.format(cost.usdPerTask)}/task</span>
      {cost.sampleCount === null ? (
        <span className="eval-muted">of {cost.population}</span>
      ) : (
        <SampleCount sampleCount={cost.sampleCount} population={cost.population} />
      )}
      <span className="lb-cost-disclosure">
        derived · {cost.priceSource} · as of {cost.priceAsOf}
      </span>
    </span>
  );
}

function LeaderboardRowView({ row }: { row: LeaderboardRow }) {
  return (
    <tr>
      <th scope="row">
        <div className="lb-model-cell">
          {row.model !== undefined && <ModelAvatar model={row.model} />}
          <span className="lb-model-copy">
            {row.model === undefined ? (
              <span>{row.run.modelId}</span>
            ) : (
              <a href={`#/models/${row.model.id}`}>{row.model.name}</a>
            )}
          </span>
        </div>
      </th>
      <td>
        <HeadlineValue headline={headlineFor(row.run)} />
      </td>
      <td>
        <LatencyValue metric={row.run.metrics.latencyMs} />
      </td>
      <td className="lb-cost-cell">
        <CostValue cost={derivedCostPerTask(row.run)} />
      </td>
    </tr>
  );
}

interface ScatterPoint {
  readonly row: LeaderboardRow;
  readonly latencySeconds: number;
  readonly headline: Extract<Headline, { kind: "rate" }>;
}

interface PlottedScatterPoint extends ScatterPoint {
  readonly x: number;
  readonly y: number;
  readonly yValue: number;
  readonly name: string;
}

function placeScatterLabels(
  plotted: readonly PlottedScatterPoint[],
  chartWidth: number,
  chartHeight: number,
): Array<PlottedScatterPoint & { labelX: number; labelY: number; labelAnchor: "start" | "end" }> {
  const occupied: Array<readonly [number, number, number, number]> = [];
  return plotted.map((point) => {
    const width = Math.min(118, Math.max(22, point.name.length * 6.15));
    const fallback = { labelX: point.x + 9, labelY: point.y - 8, labelAnchor: "start" as const };
    const candidates = [
      fallback,
      { labelX: point.x + 9, labelY: point.y + 14, labelAnchor: "start" as const },
      { labelX: point.x - 9, labelY: point.y - 8, labelAnchor: "end" as const },
      { labelX: point.x - 9, labelY: point.y + 14, labelAnchor: "end" as const },
    ];
    for (const candidate of candidates) {
      const left = candidate.labelAnchor === "end" ? candidate.labelX - width : candidate.labelX;
      const box = [left, candidate.labelY - 9, left + width, candidate.labelY + 3] as const;
      const inBounds =
        box[0] >= 4 && box[2] <= chartWidth - 4 && box[1] >= 2 && box[3] <= chartHeight - 18;
      const hitsLabel = occupied.some(
        (other) =>
          box[0] < other[2] + 2 &&
          box[2] + 2 > other[0] &&
          box[1] < other[3] + 2 &&
          box[3] + 2 > other[1],
      );
      const hitsPoint = plotted.some((other) => {
        if (other === point) return false;
        return (
          other.x >= box[0] - 6 &&
          other.x <= box[2] + 6 &&
          other.y >= box[1] - 6 &&
          other.y <= box[3] + 6
        );
      });
      if (inBounds && !hitsLabel && !hitsPoint) {
        occupied.push(box);
        return { ...point, ...candidate };
      }
    }
    occupied.push([
      fallback.labelX,
      fallback.labelY - 9,
      fallback.labelX + width,
      fallback.labelY + 3,
    ]);
    return { ...point, ...fallback };
  });
}

/** Quality vs. p50 latency — measured rows with both values available only. */
function ScatterPlot({
  rows,
  family,
}: {
  rows: readonly LeaderboardRow[];
  family: LeaderboardFamily;
}) {
  const width = 620;
  const height = 310;
  const margin = { top: 24, right: 94, bottom: 46, left: 50 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const points: ScatterPoint[] = rows.flatMap((row) => {
    const latency = row.run.metrics.latencyMs;
    if (latency.availability !== "available" && latency.availability !== "aggregate_only") {
      return [];
    }
    const headline = headlineFor(row.run);
    if (headline.kind !== "rate" || headline.started === 0) return [];
    return [{ row, latencySeconds: latency.p50 / 1000, headline }];
  });
  const rawXDomain =
    points.length > 0
      ? paddedDomain(
          points.map((point) => point.latencySeconds),
          0.12,
        )
      : [3, 8];
  const xDomain: readonly [number, number] = [Math.max(0, rawXDomain[0]), rawXDomain[1]];
  const rawYDomain =
    points.length > 0
      ? paddedDomain(
          points.map((point) => (point.headline.passed / point.headline.started) * 100),
          0.12,
        )
      : [0, 100];
  const yDomain: readonly [number, number] = [
    Math.max(0, rawYDomain[0]),
    Math.min(100, rawYDomain[1]),
  ];
  const xTicks = [0, 1, 2, 3, 4].map((step) => xDomain[0] + ((xDomain[1] - xDomain[0]) * step) / 4);
  const yTicks = [0, 1, 2, 3, 4].map((step) => yDomain[0] + ((yDomain[1] - yDomain[0]) * step) / 4);
  const chartId = "lb-latency-chart";
  const formatX = (value: number) => `${value.toFixed(1)}s`;
  const xPosition = (value: number) =>
    margin.left + ((value - xDomain[0]) / (xDomain[1] - xDomain[0])) * plotWidth;
  const yPosition = (value: number) =>
    margin.top + (1 - (value - yDomain[0]) / (yDomain[1] - yDomain[0])) * plotHeight;
  const labeled = placeScatterLabels(
    points.map((point) => {
      const yValue = (point.headline.passed / point.headline.started) * 100;
      return {
        ...point,
        yValue,
        x: xPosition(point.latencySeconds),
        y: yPosition(yValue),
        name: point.row.model?.name ?? point.row.run.modelId,
      };
    }),
    width,
    height,
  );

  return (
    <div className="lb-chart-wrap">
      <svg
        className="lb-scatterplot"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-labelledby={`${chartId}-title ${chartId}-description`}
      >
        <title id={`${chartId}-title`}>Headline pass rate compared with p50 latency</title>
        <desc id={`${chartId}-description`}>
          {points.length > 0
            ? `${points.length} measured runs for ${family} with headline and latency evidence. Higher on the chart means a higher pass rate.`
            : `No measured runs for ${family} have both headline and latency evidence.`}
        </desc>
        <g className="lb-chart-grid" aria-hidden="true">
          {yTicks.map((value) => {
            const y = yPosition(value);
            return (
              <g key={`y-${value}`}>
                <line x1={margin.left} x2={width - margin.right} y1={y} y2={y} />
                <text x={margin.left - 10} y={y + 4} textAnchor="end">
                  {Math.round(value)}%
                </text>
              </g>
            );
          })}
          {xTicks.map((value) => {
            const x = xPosition(value);
            return (
              <g key={`x-${value}`}>
                <line x1={x} x2={x} y1={margin.top} y2={height - margin.bottom} />
                <text x={x} y={height - margin.bottom + 23} textAnchor="middle">
                  {formatX(value)}
                </text>
              </g>
            );
          })}
        </g>
        <line
          className="lb-chart-axis"
          x1={margin.left}
          x2={margin.left}
          y1={margin.top}
          y2={height - margin.bottom}
          aria-hidden="true"
        />
        <line
          className="lb-chart-axis"
          x1={margin.left}
          x2={width - margin.right}
          y1={height - margin.bottom}
          y2={height - margin.bottom}
          aria-hidden="true"
        />
        <text
          className="lb-chart-axis-label"
          x={margin.left + plotWidth / 2}
          y={height - 5}
          textAnchor="middle"
        >
          p50 latency
        </text>
        <text
          className="lb-chart-axis-label"
          transform={`translate(13 ${margin.top + plotHeight / 2}) rotate(-90)`}
          textAnchor="middle"
        >
          Pass rate
        </text>
        {points.length === 0 && (
          <text
            className="lb-chart-empty"
            x={margin.left + plotWidth / 2}
            y={margin.top + plotHeight / 2}
            textAnchor="middle"
          >
            No matching runs to plot
          </text>
        )}
        {labeled.map((point) => (
          <g className="lb-chart-model" key={point.row.run.runId}>
            <title>
              {`${point.name}: ${point.headline.passed}/${point.headline.started} passed (${point.yValue.toFixed(1)}%), p50 ${formatX(point.latencySeconds)}`}
            </title>
            <circle className="lb-chart-hit" cx={point.x} cy={point.y} r="16" />
            <circle className="lb-chart-point-halo" cx={point.x} cy={point.y} r="7" />
            <circle
              className="lb-chart-point"
              cx={point.x}
              cy={point.y}
              r="4.2"
              fill={point.row.model?.color ?? "currentColor"}
            />
            <text
              className="lb-chart-model-label"
              x={point.labelX}
              y={point.labelY}
              textAnchor={point.labelAnchor}
            >
              {point.name}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

export function LeaderboardPage({
  initialFamily = "Spot",
  initialSearch = "",
  initialCohort = ALL_COHORTS,
}: {
  initialFamily?: LeaderboardFamily;
  initialSearch?: string;
  initialCohort?: string;
}) {
  const [family, setFamily] = useState<LeaderboardFamily>(initialFamily);
  const [search, setSearch] = useState(initialSearch);
  const [cohort, setCohort] = useState(initialCohort);
  const [sortMetric, setSortMetric] = useState<SortMetric>("headline");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const cohorts = cohortsForFamily(family);
  const selectedCohort = cohorts.find((entry) => entry.cohortId === cohort);
  const selectedCohortId = selectedCohort?.cohortId ?? ALL_COHORTS;

  const familyRows = useMemo<readonly LeaderboardRow[]>(
    () =>
      runsForFamily(family)
        .filter((run) => run.origin === "measured")
        .map((run) => ({
          run,
          model: getModel(run.modelId),
          campaign: campaignById[run.campaignId],
        })),
    [family],
  );

  const campaigns = useMemo(() => {
    const byId: Record<string, CanonicalCampaign> = {};
    for (const row of familyRows) {
      if (row.campaign !== undefined) byId[row.campaign.campaignId] = row.campaign;
    }
    return Object.values(byId).sort((left, right) => left.date.localeCompare(right.date));
  }, [familyRows]);

  const rows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return familyRows.filter(
      (row) =>
        query.length === 0 ||
        `${row.model?.name ?? ""} ${row.model?.provider ?? ""}`.toLocaleLowerCase().includes(query),
    );
  }, [familyRows, search]);

  const groups = useMemo<readonly CohortGroup[]>(() => {
    if (selectedCohort === undefined) {
      return cohorts
        .map((entry): CohortGroup => {
          const scoped = rows.filter((row) => inCohort(row.run, entry));
          return {
            cohortId: entry.cohortId,
            label: cohortLabel(entry),
            rows: sortedRows(scoped, sortMetric, sortDirection),
          };
        })
        .filter((group) => group.rows.length > 0);
    }
    return [
      {
        cohortId: selectedCohort.cohortId,
        label: cohortLabel(selectedCohort),
        rows: sortedRows(
          rows.filter((row) => inCohort(row.run, selectedCohort)),
          sortMetric,
          sortDirection,
        ),
      },
    ];
  }, [cohorts, rows, selectedCohort, sortDirection, sortMetric]);

  const shownCount = groups.reduce((total, group) => total + group.rows.length, 0);
  const chartRows = groups.flatMap((group) => group.rows);

  const sort = (nextMetric: SortMetric) => {
    if (nextMetric === sortMetric) {
      setSortDirection((current) => (current === "desc" ? "asc" : "desc"));
      return;
    }
    setSortMetric(nextMetric);
    setSortDirection(nextMetric === "latency" ? "asc" : "desc");
  };

  const tableCaption = `Measured runs for the ${family} family${
    selectedCohort === undefined
      ? ", grouped by cohort"
      : ` in cohort ${cohortLabel(selectedCohort)}`
  }.`;
  const panelDescription = `${shownCount} measured ${shownCount === 1 ? "run" : "runs"} · sorted by ${metricLabels[sortMetric]} (${sortDirection === "desc" ? "descending" : "ascending"}) · unavailable values sort last${
    selectedCohort === undefined
      ? " · grouped by cohort"
      : ` · cohort ${cohortLabel(selectedCohort)}`
  }`;

  return (
    <PageShell active="leaderboard">
      <div className="eval-container leaderboard-page">
        <section className="eval-hero lb-hero" aria-labelledby="leaderboard-title">
          <img className="eval-hero-art" src="/images/hero-watercolor-landscape.webp" alt="" />
          <p className="eval-eyebrow">Open benchmark for financial agents</p>
          <h1 className="eval-title" id="leaderboard-title">
            Finance agents.
            <br />
            Put to the test<span>.</span>
          </h1>
          <p className="eval-description">
            Compare how AI agents research, reason, and use financial tools.
          </p>
          <blockquote className="eval-quote lb-quote">
            "A benchmark should show the work, not just crown a winner."
          </blockquote>
          <ul className="lb-benefits" aria-label="Evaluation principles">
            {benefits.map(({ title, description, icon: Icon }) => (
              <li key={title}>
                <span className="lb-benefit-icon">
                  <Icon size={16} strokeWidth={1.7} aria-hidden="true" />
                </span>
                <span>
                  <strong>{title}</strong>
                  <small>{description}</small>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="lb-results" aria-labelledby="leaderboard-results-title">
          <div className="lb-section-heading">
            <div>
              <p className="lb-section-kicker">The field</p>
              <h2 id="leaderboard-results-title">Current standings</h2>
              <p>
                Sort the field, search by model or provider, or compare one task family at a time.
              </p>
            </div>
            <span className="lb-dataset-indicator">
              <span>
                {family} family · {numberFormatter.format(caseDefinitionsForFamily(family).length)}{" "}
                cases
              </span>
              {campaigns.map((campaign) => (
                <span className="lb-measured-indicator" key={campaign.campaignId}>
                  {campaign.campaignId} · {campaign.date} · {campaign.harness}
                  {campaign.prUrl && (
                    <>
                      {" · "}
                      <a href={campaign.prUrl} target="_blank" rel="noreferrer">
                        {campaign.prLabel ?? "GitHub PR"}
                      </a>
                    </>
                  )}
                </span>
              ))}
            </span>
          </div>

          <div className="lb-toolbar">
            <FamilyTabs
              value={family}
              onChange={(next) => {
                setFamily(next);
                setCohort(ALL_COHORTS);
              }}
              options={leaderboardFamilies}
            />
            <div className="lb-toolbar-controls">
              <label className="lb-cohort-field">
                <span className="lb-cohort-label">Cohort</span>
                <select
                  className="lb-cohort-select"
                  value={selectedCohortId}
                  onChange={(event) => setCohort(event.currentTarget.value)}
                >
                  <option value={ALL_COHORTS}>All cohorts</option>
                  {cohorts.map((entry) => (
                    <option key={entry.cohortId} value={entry.cohortId}>
                      {cohortLabel(entry)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="lb-search-field">
                <span className="lb-visually-hidden">Search models</span>
                <Search size={15} aria-hidden="true" />
                <Input
                  className="lb-search-input"
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.currentTarget.value)}
                  placeholder="Search models"
                />
                {search.length > 0 && (
                  <Button
                    className="lb-search-clear"
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Clear model search"
                    onClick={() => setSearch("")}
                  >
                    <X size={14} aria-hidden="true" />
                  </Button>
                )}
              </label>
            </div>
          </div>

          <Panel className="lb-table-panel" title="Measured results" description={panelDescription}>
            {shownCount > 0 ? (
              <div className="lb-table-scroll">
                <table className="eval-table lb-table">
                  <caption className="lb-visually-hidden">{tableCaption}</caption>
                  <thead>
                    <tr>
                      <th className="lb-model-column" scope="col">
                        Model
                      </th>
                      <th
                        scope="col"
                        aria-sort={
                          sortMetric === "headline"
                            ? sortDirection === "desc"
                              ? "descending"
                              : "ascending"
                            : "none"
                        }
                      >
                        <SortButton
                          label="Pass rate"
                          metric="headline"
                          activeMetric={sortMetric}
                          direction={sortDirection}
                          onSort={sort}
                        />
                      </th>
                      <th
                        scope="col"
                        aria-sort={
                          sortMetric === "latency"
                            ? sortDirection === "desc"
                              ? "descending"
                              : "ascending"
                            : "none"
                        }
                      >
                        <SortButton
                          label="p50 latency"
                          metric="latency"
                          activeMetric={sortMetric}
                          direction={sortDirection}
                          onSort={sort}
                        />
                      </th>
                      <th scope="col">est. cost/task</th>
                    </tr>
                  </thead>
                  {groups.map((group) => (
                    <tbody key={group.cohortId}>
                      {selectedCohort === undefined && (
                        <tr className="lb-cohort-row">
                          <th scope="rowgroup" colSpan={4}>
                            {group.label}{" "}
                            <span className="lb-cohort-run-count">
                              · {group.rows.length} {group.rows.length === 1 ? "run" : "runs"}
                            </span>
                          </th>
                        </tr>
                      )}
                      {group.rows.map((row) => (
                        <LeaderboardRowView key={row.run.runId} row={row} />
                      ))}
                    </tbody>
                  ))}
                </table>
              </div>
            ) : (
              <div className="lb-empty-state" role="status">
                <span className="lb-empty-mark" aria-hidden="true">
                  0
                </span>
                <h3>No measured runs</h3>
                <p>
                  {search.trim().length > 0
                    ? `No model or provider matches "${search.trim()}" in ${family.toLocaleLowerCase()}.`
                    : "No measured runs match the current family and cohort selection."}
                </p>
                <div className="lb-empty-actions">
                  {search.trim().length > 0 && (
                    <Button
                      className="lb-reset-button"
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setSearch("")}
                    >
                      Clear search
                    </Button>
                  )}
                  <Button
                    className="lb-reset-button"
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setFamily("Spot");
                      setSearch("");
                      setCohort(ALL_COHORTS);
                    }}
                  >
                    Reset filters
                  </Button>
                </div>
              </div>
            )}
          </Panel>
        </section>

        <section className="lb-charts" aria-label="Model trade-off chart">
          <Panel
            className="lb-chart-panel"
            title="Quality vs. latency"
            description={`Headline pass rate and median response time · measured runs with both values · ${family}`}
          >
            <ScatterPlot rows={chartRows} family={family} />
          </Panel>
        </section>
      </div>
    </PageShell>
  );
}
