import type {
  PublicComparisonRow,
  PublicDimensionId,
  PublicMetricId,
} from "../lib/public-comparison";
import { PUBLIC_DIMENSION_DEFINITIONS } from "../lib/public-comparison";
import { formatMetric } from "./public-comparison-ui";
import "../styles/public-comparison-charts.css";

const INTEGER = new Intl.NumberFormat("en-US");

const metricNumber = (row: PublicComparisonRow, id: PublicMetricId): number | null => {
  const metric = row.metrics[id];
  return metric.availability === "available" ? metric.value : null;
};

const paddedDomain = (values: readonly number[]): readonly [number, number] => {
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = maximum - minimum || Math.abs(maximum) * 0.2 || 1;
  return [Math.max(0, minimum - span * 0.12), maximum + span * 0.12];
};

export function ComparisonScatterPlot({
  rows,
  metric,
  title,
}: {
  rows: readonly PublicComparisonRow[];
  metric: "latencyP50" | "tokenUsage";
  title: string;
}) {
  const points = rows.flatMap((row) => {
    const x = metricNumber(row, metric);
    const y = metricNumber(row, "passRate");
    return x === null || y === null ? [] : [{ row, x, y }];
  });
  if (points.length < 2) return null;

  const width = 600;
  const height = 292;
  const margin = { top: 28, right: 112, bottom: 48, left: 54 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const [xMin, xMax] = paddedDomain(points.map((point) => point.x));
  const passRates = points.map((point) => point.y);
  const yMinimum = Math.min(...passRates);
  const yMaximum = Math.max(...passRates);
  const roundedYMin = Math.max(0, Math.floor(yMinimum * 10) / 10);
  const roundedYMax = Math.min(1, Math.ceil(yMaximum * 10) / 10);
  const yMin = roundedYMin === roundedYMax ? Math.max(0, roundedYMin - 0.1) : roundedYMin;
  const yMax = roundedYMin === roundedYMax && roundedYMax === 0 ? 0.1 : roundedYMax;
  const xPosition = (value: number) => margin.left + ((value - xMin) / (xMax - xMin)) * plotWidth;
  const yPosition = (value: number) =>
    margin.top + (1 - (value - yMin) / (yMax - yMin)) * plotHeight;
  const xTicks = [0, 1, 2, 3, 4].map((step) => xMin + ((xMax - xMin) * step) / 4);
  const yTicks = [0, 1, 2, 3, 4].map((step) => yMin + ((yMax - yMin) * step) / 4);
  const xLabel = metric === "latencyP50" ? "p50 latency" : "Total tokens";
  const formatX = (value: number) =>
    metric === "latencyP50"
      ? value >= 1000
        ? `${(value / 1000).toFixed(1)}s`
        : `${Math.round(value)}ms`
      : INTEGER.format(Math.round(value));

  return (
    <div className="comparison-scatter-wrap">
      <svg
        className="comparison-scatter"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${title}. ${points.length} synthetic candidates plotted by pass rate and ${xLabel}.`}
      >
        <g className="comparison-chart-grid" aria-hidden="true">
          {yTicks.map((value) => {
            const y = yPosition(value);
            return (
              <g key={`y-${value}`}>
                <line x1={margin.left} x2={width - margin.right} y1={y} y2={y} />
                <text x={margin.left - 10} y={y + 4} textAnchor="end">
                  {Math.round(value * 100)}%
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
        <text
          className="comparison-chart-axis-label"
          x={margin.left + plotWidth / 2}
          y={height - 6}
          textAnchor="middle"
        >
          {xLabel}
        </text>
        <text
          className="comparison-chart-axis-label"
          transform={`translate(13 ${margin.top + plotHeight / 2}) rotate(-90)`}
          textAnchor="middle"
        >
          Pass rate
        </text>
        {points.map((point, index) => {
          const x = xPosition(point.x);
          const y = yPosition(point.y);
          const labelOnLeft = x > width - margin.right - 90;
          const labelOffset = [-9, -9, -9, 16, 17][index % 5] ?? -9;
          return (
            <g className="comparison-chart-point" data-color={index % 5} key={point.row.revisionId}>
              <title>
                {point.row.candidate}: {formatMetric(point.row.metrics.passRate)},{" "}
                {formatX(point.x)}
              </title>
              <circle className="comparison-chart-point-halo" cx={x} cy={y} r="8" />
              <circle className="comparison-chart-point-dot" cx={x} cy={y} r="5" />
              <text
                x={labelOnLeft ? x - 10 : x + 10}
                y={y + labelOffset}
                textAnchor={labelOnLeft ? "end" : "start"}
              >
                {point.row.candidate}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function OutcomeBar({
  passed,
  failed,
  notApplicable,
  label,
}: {
  passed: number;
  failed: number;
  notApplicable: number;
  label: string;
}) {
  const total = passed + failed + notApplicable;
  const percentage = (value: number) => (total === 0 ? 0 : (value / total) * 100);
  return (
    <div
      className="comparison-outcome-track"
      role="img"
      aria-label={`${label}: ${passed} passed, ${failed} failed, ${notApplicable} not applicable`}
    >
      <span className="comparison-outcome-pass" style={{ width: `${percentage(passed)}%` }} />
      <span className="comparison-outcome-fail" style={{ width: `${percentage(failed)}%` }} />
      <span className="comparison-outcome-na" style={{ width: `${percentage(notApplicable)}%` }} />
    </div>
  );
}

export function DimensionOutcomeChart({ row }: { row: PublicComparisonRow }) {
  return (
    <div className="comparison-dimension-chart">
      <div className="comparison-outcome-legend" aria-hidden="true">
        <span data-kind="pass">Passed</span>
        <span data-kind="fail">Failed</span>
        <span data-kind="na">N/A</span>
      </div>
      {PUBLIC_DIMENSION_DEFINITIONS.map((definition) => {
        const value = row.dimensions[definition.id as PublicDimensionId];
        return (
          <div className="comparison-dimension-row" key={definition.id}>
            <span>{definition.label}</span>
            <OutcomeBar label={definition.label} {...value} />
            <strong>
              {value.passed}/{value.passed + value.failed}
            </strong>
          </div>
        );
      })}
    </div>
  );
}

export function LatencyEnvelopeChart({ row }: { row: PublicComparisonRow }) {
  const latencyP50 = row.metrics.latencyP50;
  const p50 = metricNumber(row, "latencyP50");
  const p95 = metricNumber(row, "latencyP95");
  const maximum = metricNumber(row, "latencyMax");
  if (p50 === null || p95 === null || maximum === null || latencyP50.availability !== "available") {
    return <p className="comparison-chart-empty">Latency was not retained for this result.</p>;
  }
  const domainMaximum = Math.max(maximum, p95, p50) * 1.08;
  const position = (value: number) => `${(value / domainMaximum) * 100}%`;
  return (
    <div
      className="comparison-latency-chart"
      role="img"
      aria-label={`Latency envelope: p50 ${formatMetric(row.metrics.latencyP50)}, p95 ${formatMetric(row.metrics.latencyP95)}, maximum ${formatMetric(row.metrics.latencyMax)}`}
    >
      <div className="comparison-latency-axis">
        <span>0</span>
        <span>{formatMetric(row.metrics.latencyMax)}</span>
      </div>
      <div className="comparison-latency-track">
        <span className="comparison-latency-range" style={{ width: position(maximum) }} />
        {[
          ["p50", p50],
          ["p95", p95],
          ["max", maximum],
        ].map(([label, value]) => (
          <span
            className="comparison-latency-marker"
            data-kind={label}
            key={label}
            style={{ left: position(value as number) }}
          >
            <strong>{label}</strong>
            <small>
              {formatMetric(
                row.metrics[
                  label === "p50" ? "latencyP50" : label === "p95" ? "latencyP95" : "latencyMax"
                ],
              )}
            </small>
          </span>
        ))}
      </div>
      <p>{INTEGER.format(latencyP50.sampleCount)} observed attempts</p>
    </div>
  );
}
