import { useMemo, useState } from "react";
import { BookOpen, BriefcaseBusiness, Search, ShieldCheck, X } from "lucide-react";
import { dataset, familyMetrics, models, type EvalModel, type FamilyFilter } from "../data";
import {
  measuredCampaigns,
  measuredModels,
  type MeasuredFamilyResult,
  type MeasuredModel,
} from "../measured";
import { FamilyTabs, ModelAvatar, PageShell, Panel, ScoreBadge } from "../components/eval-ui";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  canonicalModels,
  canonicalRuns,
  type CanonicalModel,
  type CanonicalRun,
} from "../canonical/canonical";
import "./leaderboard.css";

const leaderboardFamilies = ["Spot", "Perps", "Predictions"] as const;
type LeaderboardFamily = (typeof leaderboardFamilies)[number];

type SortMetric = "passRate" | "accuracy" | "latency" | "cost";
type SortDirection = "asc" | "desc";
type ScatterMetric = "latency" | "cost";

type IllustrativeRow = {
  kind: "illustrative";
  model: EvalModel;
  passRate: number;
  accuracy: number;
};

type MeasuredRow = {
  kind: "measured";
  model: MeasuredModel;
  result: MeasuredFamilyResult;
};

type SyntheticRow = {
  kind: "synthetic";
  model: CanonicalModel;
  run: CanonicalRun;
};

type LeaderboardRow = IllustrativeRow | MeasuredRow | SyntheticRow;

const canonicalModelById = new Map(canonicalModels.map((model) => [model.id, model]));

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
  passRate: "pass rate",
  accuracy: "accuracy",
  latency: "p50 latency",
  cost: "cost per task",
};

function paddedDomain(values: readonly number[], paddingRatio: number): readonly [number, number] {
  if (values.length === 0) return [0, 1];
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = maximum - minimum || Math.abs(maximum) * 0.2 || 1;
  const padding = span * paddingRatio;
  return [minimum - padding, maximum + padding];
}

function ScatterPlot({
  rows,
  metric,
  family,
}: {
  rows: readonly LeaderboardRow[];
  metric: ScatterMetric;
  family: FamilyFilter;
}) {
  const width = 620;
  const height = 310;
  const margin = { top: 24, right: 94, bottom: 46, left: 50 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const chartRows = rows.filter((row): row is IllustrativeRow | MeasuredRow =>
    metric === "latency" ? row.kind !== "synthetic" : row.kind === "illustrative",
  );
  const xValues = chartRows.map((row) =>
    row.kind === "measured" ? row.result.latencyMs.p50 / 1000 : row.model[metric],
  );
  const yValues = chartRows.map((row) =>
    row.kind === "measured" ? row.result.passRateSortKey : row.passRate,
  );
  const fallbackX: readonly [number, number] = metric === "latency" ? [3, 8] : [0.006, 0.02];
  const rawXDomain = chartRows.length > 0 ? paddedDomain(xValues, 0.12) : fallbackX;
  const rawYDomain = chartRows.length > 0 ? paddedDomain(yValues, 0.12) : ([0, 100] as const);
  const xDomain: readonly [number, number] =
    metric === "cost" ? [Math.max(0, rawXDomain[0]), rawXDomain[1]] : rawXDomain;
  const yDomain: readonly [number, number] = [
    Math.max(0, rawYDomain[0]),
    Math.min(100, rawYDomain[1]),
  ];
  const xTicks = [0, 1, 2, 3, 4].map((step) => xDomain[0] + ((xDomain[1] - xDomain[0]) * step) / 4);
  const yTicks = [0, 1, 2, 3, 4].map((step) => yDomain[0] + ((yDomain[1] - yDomain[0]) * step) / 4);
  const chartId = `lb-${metric}-chart`;
  const xLabel = metric === "latency" ? "p50 latency" : "Cost per task";
  const formatX = (value: number) =>
    metric === "latency" ? `${value.toFixed(1)}s` : costFormatter.format(value);
  const xPosition = (value: number) =>
    margin.left + ((value - xDomain[0]) / (xDomain[1] - xDomain[0])) * plotWidth;
  const yPosition = (value: number) =>
    margin.top + (1 - (value - yDomain[0]) / (yDomain[1] - yDomain[0])) * plotHeight;

  return (
    <div className="lb-chart-wrap">
      <svg
        className="lb-scatterplot"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-labelledby={`${chartId}-title ${chartId}-description`}
      >
        <title id={`${chartId}-title`}>Pass rate compared with {xLabel}</title>
        <desc id={`${chartId}-description`}>
          {chartRows.length > 0
            ? `${chartRows.length} visible models for ${family}. Higher on the chart means a higher pass rate.`
            : `No models match the current ${family} filter and search.`}
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
          {xLabel}
        </text>
        <text
          className="lb-chart-axis-label"
          transform={`translate(13 ${margin.top + plotHeight / 2}) rotate(-90)`}
          textAnchor="middle"
        >
          Pass rate
        </text>
        {chartRows.length === 0 && (
          <text
            className="lb-chart-empty"
            x={margin.left + plotWidth / 2}
            y={margin.top + plotHeight / 2}
            textAnchor="middle"
          >
            No matching models to plot
          </text>
        )}
        {chartRows.map((row, index) => {
          const xValue =
            row.kind === "measured" ? row.result.latencyMs.p50 / 1000 : row.model[metric];
          const yValue = row.kind === "measured" ? row.result.passRateSortKey : row.passRate;
          const x = xPosition(xValue);
          const y = yPosition(yValue);
          const labelOnLeft = x > width - margin.right - 108;
          return (
            <g className="lb-chart-model" key={row.model.id}>
              <title>
                {row.model.name}: {yValue.toFixed(1)}% pass rate, {formatX(xValue)}{" "}
                {xLabel.toLowerCase()}
              </title>
              <circle className="lb-chart-point-halo" cx={x} cy={y} r="7" />
              <circle className="lb-chart-point" cx={x} cy={y} r="4.2" fill={row.model.color} />
              <text
                className="lb-chart-model-label"
                x={labelOnLeft ? x - 9 : x + 9}
                y={y + (index % 2 === 0 ? -8 : 14)}
                textAnchor={labelOnLeft ? "end" : "start"}
              >
                {row.model.name}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
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

export function LeaderboardPage({
  initialFamily = "Spot",
  initialSearch = "",
}: {
  initialFamily?: LeaderboardFamily;
  initialSearch?: string;
}) {
  const [family, setFamily] = useState<LeaderboardFamily>(initialFamily);
  const [search, setSearch] = useState(initialSearch);
  const [sortMetric, setSortMetric] = useState<SortMetric>("passRate");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const rows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const illustrativeRows: IllustrativeRow[] = models
      .filter(
        (model) =>
          query.length === 0 ||
          `${model.name} ${model.provider}`.toLocaleLowerCase().includes(query),
      )
      .map((model): IllustrativeRow => {
        const metrics = familyMetrics(model, family);
        return {
          kind: "illustrative",
          model,
          passRate: metrics.passRate,
          accuracy: metrics.accuracy,
        };
      });
    const measuredRows: MeasuredRow[] = measuredModels
      .filter(
        (model) =>
          model.families[family] !== undefined &&
          (query.length === 0 ||
            `${model.name} ${model.provider}`.toLocaleLowerCase().includes(query)),
      )
      .map((model) => ({
        kind: "measured",
        model,
        result: model.families[family]!,
      }));
    const syntheticRows: SyntheticRow[] = canonicalRuns
      .filter(
        (run) =>
          run.family === family &&
          canonicalModelById.get(run.modelId)?.origin === "synthetic" &&
          (query.length === 0 ||
            `${canonicalModelById.get(run.modelId)?.name ?? ""} ${canonicalModelById.get(run.modelId)?.provider ?? ""}`
              .toLocaleLowerCase()
              .includes(query)),
      )
      .map((run) => ({
        kind: "synthetic",
        model: canonicalModelById.get(run.modelId)!,
        run,
      }));
    const visible: (IllustrativeRow | MeasuredRow)[] = [...illustrativeRows, ...measuredRows];

    const sorted = visible.sort((left, right) => {
      if ((sortMetric === "accuracy" || sortMetric === "cost") && left.kind !== right.kind) {
        return left.kind === "illustrative" ? -1 : 1;
      }
      const leftValue =
        left.kind === "measured"
          ? sortMetric === "passRate"
            ? left.result.passRateSortKey
            : sortMetric === "latency"
              ? left.result.latencyMs.p50 / 1000
              : undefined
          : sortMetric === "passRate" || sortMetric === "accuracy"
            ? left[sortMetric]
            : left.model[sortMetric];
      const rightValue =
        right.kind === "measured"
          ? sortMetric === "passRate"
            ? right.result.passRateSortKey
            : sortMetric === "latency"
              ? right.result.latencyMs.p50 / 1000
              : undefined
          : sortMetric === "passRate" || sortMetric === "accuracy"
            ? right[sortMetric]
            : right.model[sortMetric];
      if (leftValue === undefined || rightValue === undefined) {
        return left.model.name.localeCompare(right.model.name);
      }
      const difference = leftValue - rightValue;
      if (difference === 0) return left.model.name.localeCompare(right.model.name);
      return sortDirection === "asc" ? difference : -difference;
    });
    return [...sorted, ...syntheticRows];
  }, [family, search, sortDirection, sortMetric]);

  const sort = (nextMetric: SortMetric) => {
    if (nextMetric === sortMetric) {
      setSortDirection((current) => (current === "desc" ? "asc" : "desc"));
      return;
    }
    setSortMetric(nextMetric);
    setSortDirection(nextMetric === "latency" || nextMetric === "cost" ? "asc" : "desc");
  };

  const resetFilters = () => {
    setFamily("Spot");
    setSearch("");
  };

  const tableCaption = `Model results for the ${family} family, one of four ${numberFormatter.format(dataset.tasksPerFamily)}-task families.`;
  const displayedUniverse =
    models.length +
    measuredModels.filter((model) => model.families[family] !== undefined).length +
    canonicalRuns.filter(
      (run) => run.family === family && canonicalModelById.get(run.modelId)?.origin === "synthetic",
    ).length;

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
                {dataset.label} · {numberFormatter.format(dataset.tasks)} tasks ·{" "}
                {dataset.repetitions} runs each
              </span>
              {measuredCampaigns.map((campaign) => (
                <span className="lb-measured-indicator" key={campaign.id}>
                  Measured {campaign.date} · {campaign.harness} · {campaign.repetitions} reps
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
            <FamilyTabs value={family} onChange={setFamily} options={leaderboardFamilies} />
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

          <Panel
            className="lb-table-panel"
            title="Ranked results"
            description={`${rows.length} of ${displayedUniverse} models shown · ranked by ${metricLabels[sortMetric]} · measured rows are small unranked conformance samples · synthetic rows are labelled previews`}
          >
            {rows.length > 0 ? (
              <div className="lb-table-scroll">
                <table className="eval-table lb-table">
                  <caption className="lb-visually-hidden">{tableCaption}</caption>
                  <thead>
                    <tr>
                      <th className="lb-rank-column" scope="col">
                        Rank
                      </th>
                      <th className="lb-model-column" scope="col">
                        Model / harness
                      </th>
                      <th
                        scope="col"
                        aria-sort={
                          sortMetric === "passRate"
                            ? sortDirection === "desc"
                              ? "descending"
                              : "ascending"
                            : "none"
                        }
                      >
                        <SortButton
                          label="Pass rate"
                          metric="passRate"
                          activeMetric={sortMetric}
                          direction={sortDirection}
                          onSort={sort}
                        />
                      </th>
                      <th
                        scope="col"
                        aria-sort={
                          sortMetric === "accuracy"
                            ? sortDirection === "desc"
                              ? "descending"
                              : "ascending"
                            : "none"
                        }
                      >
                        <SortButton
                          label="Accuracy"
                          metric="accuracy"
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
                      <th
                        scope="col"
                        aria-sort={
                          sortMetric === "cost"
                            ? sortDirection === "desc"
                              ? "descending"
                              : "ascending"
                            : "none"
                        }
                      >
                        <SortButton
                          label="Cost / task"
                          metric="cost"
                          activeMetric={sortMetric}
                          direction={sortDirection}
                          onSort={sort}
                        />
                      </th>
                      <th scope="col">Tasks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const rank =
                        row.kind === "illustrative"
                          ? models.reduce(
                              (position, candidate) =>
                                position +
                                Number(familyMetrics(candidate, family).passRate > row.passRate),
                              1,
                            )
                          : undefined;
                      return (
                        <tr
                          key={row.model.id}
                          className={row.kind === "synthetic" ? "lb-row-synthetic" : undefined}
                        >
                          <td className="lb-rank-cell">
                            {rank === undefined ? (
                              <span
                                className="lb-rank-unranked"
                                aria-label="Unranked measured sample"
                              >
                                —
                              </span>
                            ) : (
                              <span
                                className="lb-rank-medal"
                                data-rank={rank <= 3 ? rank : undefined}
                              >
                                {rank}
                              </span>
                            )}
                          </td>
                          <th scope="row">
                            <div className="lb-model-cell">
                              <ModelAvatar model={row.model} />
                              <span className="lb-model-copy">
                                {row.kind === "synthetic" ? (
                                  <span>{row.model.name}</span>
                                ) : (
                                  <a href={`#/models/${row.model.id}`}>{row.model.name}</a>
                                )}
                                <small>
                                  <span>{row.model.provider}</span>
                                  <span aria-hidden="true"> · </span>
                                  <code>
                                    {row.kind === "measured"
                                      ? row.model.campaign.harness
                                      : row.kind === "synthetic"
                                        ? `${row.run.cohort.target} · ${row.run.cohort.evidenceCategory}`
                                        : dataset.harness}
                                  </code>
                                  {row.kind === "measured" && (
                                    <span className="lb-measured-pill">Measured</span>
                                  )}
                                  {row.kind === "synthetic" && (
                                    <span className="lb-synthetic-pill">Synthetic</span>
                                  )}
                                </small>
                              </span>
                            </div>
                          </th>
                          <td>
                            {row.kind === "measured" ? (
                              <span className="lb-count">
                                {numberFormatter.format(row.result.passed)} /{" "}
                                {numberFormatter.format(row.result.total)}
                              </span>
                            ) : row.kind === "synthetic" ? (
                              <span className="lb-count">
                                {numberFormatter.format(row.run.counts.passed)} /{" "}
                                {numberFormatter.format(row.run.counts.started)}
                              </span>
                            ) : (
                              <ScoreBadge
                                value={row.passRate}
                                uncertainty={row.model.uncertainty}
                              />
                            )}
                          </td>
                          <td>{row.kind === "illustrative" ? `${row.accuracy}%` : "—"}</td>
                          <td>
                            {row.kind === "measured"
                              ? `${(row.result.latencyMs.p50 / 1000).toFixed(1)}s`
                              : row.kind === "synthetic"
                                ? "p50" in row.run.metrics.latencyMs
                                  ? `${(row.run.metrics.latencyMs.p50 / 1000).toFixed(1)}s`
                                  : "—"
                                : `${row.model.latency.toFixed(1)}s`}
                          </td>
                          <td>
                            {row.kind === "illustrative"
                              ? costFormatter.format(row.model.cost)
                              : "—"}
                          </td>
                          <td>
                            {numberFormatter.format(
                              row.kind === "measured"
                                ? row.result.total
                                : row.kind === "synthetic"
                                  ? row.run.counts.planned
                                  : dataset.tasksPerFamily,
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="lb-empty-state" role="status">
                <span className="lb-empty-mark" aria-hidden="true">
                  0
                </span>
                <h3>No models found</h3>
                <p>
                  No model or provider matches "{search.trim()}" in {family.toLocaleLowerCase()}.
                </p>
                <div className="lb-empty-actions">
                  <Button
                    className="lb-reset-button"
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setSearch("")}
                  >
                    Clear search
                  </Button>
                  <Button
                    className="lb-reset-button"
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={resetFilters}
                  >
                    Reset filters
                  </Button>
                </div>
              </div>
            )}
          </Panel>
        </section>

        <section className="eval-two-column lb-charts" aria-label="Model trade-off charts">
          <Panel
            className="lb-chart-panel"
            title="Quality vs. latency"
            description={`Pass rate and median response time · ${family}`}
          >
            <ScatterPlot rows={rows} metric="latency" family={family} />
          </Panel>
          <Panel
            className="lb-chart-panel"
            title="Quality vs. cost"
            description={`Pass rate and cost per task · ${family}`}
          >
            <ScatterPlot rows={rows} metric="cost" family={family} />
          </Panel>
        </section>
      </div>
    </PageShell>
  );
}
