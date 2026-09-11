// Illustrative UI restored from origin/main (apps/evals/src/pages/leaderboard.tsx).
// Scores come from the synthetic ../../data fixtures, not measured eval runs.
import { useMemo, useState } from "react";
import { BookOpen, BriefcaseBusiness, Search, ShieldCheck, X } from "lucide-react";
import { dataset, familyMetrics, models, type EvalModel, type FamilyFilter } from "../../data";
import { FamilyTabs, ModelAvatar, Panel, ScoreBadge } from "../../components/eval-ui";
import { PageShell } from "./page-shell";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import "../../pages/leaderboard.css";
import "./leaderboard.css";

type SortMetric = "passRate" | "accuracy" | "latency" | "cost";
type SortDirection = "asc" | "desc";
type ScatterMetric = "latency" | "cost";

type LeaderboardRow = {
  model: EvalModel;
  passRate: number;
  accuracy: number;
};

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
  const xValues = rows.map((row) => row.model[metric]);
  const yValues = rows.map((row) => row.passRate);
  const fallbackX: readonly [number, number] = metric === "latency" ? [3, 8] : [0.006, 0.02];
  const rawXDomain = rows.length > 0 ? paddedDomain(xValues, 0.12) : fallbackX;
  const rawYDomain = rows.length > 0 ? paddedDomain(yValues, 0.12) : ([0, 100] as const);
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
          {rows.length > 0
            ? `${rows.length} visible models for ${family}. Higher on the chart means a higher pass rate.`
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
        {rows.length === 0 && (
          <text
            className="lb-chart-empty"
            x={margin.left + plotWidth / 2}
            y={margin.top + plotHeight / 2}
            textAnchor="middle"
          >
            No matching models to plot
          </text>
        )}
        {rows.map((row, index) => {
          const x = xPosition(row.model[metric]);
          const y = yPosition(row.passRate);
          const labelOnLeft = x > width - margin.right - 108;
          return (
            <g className="lb-chart-model" key={row.model.id}>
              <title>
                {row.model.name}: {row.passRate}% pass rate, {formatX(row.model[metric])}{" "}
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
  initialFamily = "All tasks",
  initialSearch = "",
}: {
  initialFamily?: FamilyFilter;
  initialSearch?: string;
}) {
  const [family, setFamily] = useState<FamilyFilter>(initialFamily);
  const [search, setSearch] = useState(initialSearch);
  const [sortMetric, setSortMetric] = useState<SortMetric>("passRate");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const rows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const visible = models
      .filter(
        (model) =>
          query.length === 0 ||
          `${model.name} ${model.provider}`.toLocaleLowerCase().includes(query),
      )
      .map((model): LeaderboardRow => {
        const metrics = familyMetrics(model, family);
        return { model, passRate: metrics.passRate, accuracy: metrics.accuracy };
      });

    return visible.sort((left, right) => {
      const leftValue =
        sortMetric === "passRate" || sortMetric === "accuracy"
          ? left[sortMetric]
          : left.model[sortMetric];
      const rightValue =
        sortMetric === "passRate" || sortMetric === "accuracy"
          ? right[sortMetric]
          : right.model[sortMetric];
      const difference = leftValue - rightValue;
      if (difference === 0) return left.model.name.localeCompare(right.model.name);
      return sortDirection === "asc" ? difference : -difference;
    });
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
    setFamily("All tasks");
    setSearch("");
  };

  const tableCaption =
    family === "All tasks"
      ? `Model results across all ${numberFormatter.format(dataset.tasks)} illustrative tasks.`
      : `Model results for the ${family} family, one of four ${numberFormatter.format(dataset.tasksPerFamily)}-task families.`;

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
              {dataset.label} · {numberFormatter.format(dataset.tasks)} tasks ·{" "}
              {dataset.repetitions} runs each
            </span>
          </div>

          <div className="lb-toolbar">
            <FamilyTabs value={family} onChange={setFamily} />
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
            description={`${rows.length} of ${models.length} models shown · ranked by ${metricLabels[sortMetric]}`}
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
                      const rank = models.reduce(
                        (position, candidate) =>
                          position +
                          Number(familyMetrics(candidate, family).passRate > row.passRate),
                        1,
                      );
                      return (
                        <tr key={row.model.id}>
                          <td className="lb-rank-cell">
                            <span
                              className="lb-rank-medal"
                              data-rank={rank <= 3 ? rank : undefined}
                            >
                              {rank}
                            </span>
                          </td>
                          <th scope="row">
                            <div className="lb-model-cell">
                              <ModelAvatar model={row.model} />
                              <span className="lb-model-copy">
                                <a href={`#/models/${row.model.id}`}>{row.model.name}</a>
                                <small>
                                  <span>{row.model.provider}</span>
                                  <span aria-hidden="true"> · </span>
                                  <code>{dataset.harness}</code>
                                </small>
                              </span>
                            </div>
                          </th>
                          <td>
                            <ScoreBadge value={row.passRate} uncertainty={row.model.uncertainty} />
                          </td>
                          <td>{row.accuracy}%</td>
                          <td>{row.model.latency.toFixed(1)}s</td>
                          <td>{costFormatter.format(row.model.cost)}</td>
                          <td>
                            {numberFormatter.format(
                              family === "All tasks" ? dataset.tasks : dataset.tasksPerFamily,
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
