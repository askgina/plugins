import { useId, useState } from "react";
import type { LeaderboardModelRow } from "../canonical/selectors";
import { dollars, percent, seconds } from "./results-ui";
import "./leaderboard-scatter.css";

interface PlottedScatterPoint {
  row: LeaderboardModelRow;
  value: number;
  score: number;
  x: number;
  y: number;
  name: string;
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

/** Uses the same derived metrics and filtered model rows as the table. */
export function LeaderboardScatter({ rows }: { rows: readonly LeaderboardModelRow[] }) {
  const [metric, setMetric] = useState<"time" | "cost">("time");
  const id = useId();
  const width = 720;
  const height = 310;
  const margin = { top: 28, right: 100, bottom: 48, left: 62 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const label = metric === "time" ? "Average time" : "Estimated cost / task";
  const format = metric === "time" ? seconds : dollars;
  const points = rows.flatMap((row) => {
    const value = metric === "time" ? row.averageTime : row.estimatedCost;
    return row.overall !== null && value.availability === "available"
      ? [{ row, value: value.value, score: row.overall }]
      : [];
  });
  // Padding also gives a single point (or all-zero values) a valid domain.
  const values = points.map((point) => point.value);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const padding = (high - low || high * 0.2 || 1) * 0.2;
  const xMin = points.length ? Math.max(0, low - padding) : 0;
  const xMax = points.length ? high + padding : 1;
  const xPosition = (value: number) => margin.left + ((value - xMin) / (xMax - xMin)) * plotWidth;
  const yPosition = (value: number) => margin.top + (1 - value) * plotHeight;
  const plotted = placeScatterLabels(
    points.map((point) => ({
      ...point,
      name: point.row.model.name,
      x: xPosition(point.value),
      y: yPosition(point.score),
    })),
    width,
    height,
  );
  const omitted = rows.filter(
    (row) => !points.some((point) => point.row.model.id === row.model.id),
  );

  return (
    <section className="lb-chart-section" aria-labelledby={`${id}-heading`}>
      <div className="lb-chart-heading">
        <div>
          <h2 id={`${id}-heading`}>Score and efficiency</h2>
          <p>
            Higher scores, {metric === "time" ? "less time" : "lower cost"}: look toward the top
            left.
          </p>
        </div>
        <div className="lb-chart-controls" role="group" aria-label="Scatter plot horizontal axis">
          <button type="button" aria-pressed={metric === "time"} onClick={() => setMetric("time")}>
            Average time
          </button>
          <button type="button" aria-pressed={metric === "cost"} onClick={() => setMetric("cost")}>
            Cost / task
          </button>
        </div>
      </div>
      {points.length ? (
        <div
          className="lb-chart-wrap"
          role="region"
          aria-label="Score and efficiency chart, scroll horizontally on small screens"
          tabIndex={0}
        >
          <svg
            className="lb-scatterplot"
            viewBox={`0 0 ${width} ${height}`}
            role="group"
            aria-labelledby={`${id}-title ${id}-description`}
          >
            <title id={`${id}-title`}>Overall score versus {label.toLowerCase()}</title>
            <desc id={`${id}-description`}>
              Each point is a model from the table with both metrics available. Model links include
              exact values and open its profile. Scores use a zero to 100 percent scale.
            </desc>
            <g className="lb-chart-grid" aria-hidden="true">
              {[0, 0.25, 0.5, 0.75, 1].map((value) => (
                <g key={`y-${value}`}>
                  <line
                    x1={margin.left}
                    x2={width - margin.right}
                    y1={yPosition(value)}
                    y2={yPosition(value)}
                  />
                  <text x={margin.left - 10} y={yPosition(value) + 4} textAnchor="end">
                    {Math.round(value * 100)}%
                  </text>
                </g>
              ))}
              {[0, 1, 2, 3, 4].map((step) => {
                const value = xMin + ((xMax - xMin) * step) / 4;
                return (
                  <g key={step}>
                    <line
                      x1={xPosition(value)}
                      x2={xPosition(value)}
                      y1={margin.top}
                      y2={height - margin.bottom}
                    />
                    <text x={xPosition(value)} y={height - margin.bottom + 23} textAnchor="middle">
                      {format(value)}
                    </text>
                  </g>
                );
              })}
            </g>
            <text
              className="lb-chart-axis-label"
              x={margin.left + plotWidth / 2}
              y={height - 5}
              textAnchor="middle"
            >
              {label}
            </text>
            <text
              className="lb-chart-axis-label"
              transform={`translate(15 ${margin.top + plotHeight / 2}) rotate(-90)`}
              textAnchor="middle"
            >
              Overall score
            </text>
            {plotted.map((point) => (
              <a
                className="lb-chart-model"
                key={point.row.model.id}
                href={`#/models/${point.row.model.id}`}
                aria-label={`${point.name}: ${percent(point.score)} overall, ${format(point.value)} ${label.toLowerCase()}. View model profile.`}
              >
                <title>{`${point.name}: ${percent(point.score)} overall, ${format(point.value)} ${label.toLowerCase()}`}</title>
                <circle className="lb-chart-hit" cx={point.x} cy={point.y} r="16" />
                <circle className="lb-chart-point-halo" cx={point.x} cy={point.y} r="8" />
                <circle
                  className="lb-chart-point"
                  cx={point.x}
                  cy={point.y}
                  r="4.5"
                  fill={point.row.model.color}
                />
                <text
                  className="lb-chart-model-label"
                  x={point.labelX}
                  y={point.labelY}
                  textAnchor={point.labelAnchor}
                >
                  {point.name}
                </text>
              </a>
            ))}
          </svg>
        </div>
      ) : (
        <p className="lb-chart-empty" role="status">
          No matching models have both an Overall score and {label.toLowerCase()} available.
        </p>
      )}
      {omitted.length > 0 && (
        <p className="results-footnote">
          Not plotted:{" "}
          {omitted
            .map(
              (row) =>
                `${row.model.name} (${row.overall === null ? "Overall score unavailable" : `${label.toLowerCase()} unavailable`})`,
            )
            .join("; ")}
          .
        </p>
      )}
      <p className="results-footnote">
        Uses the same scores and metrics as the table. Models used different clients; see run
        details for measurement coverage.
      </p>
    </section>
  );
}
