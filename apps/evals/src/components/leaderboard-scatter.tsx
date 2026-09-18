import { useEffect, useId, useRef, useState } from "react";
import type { LeaderboardModelRow } from "../canonical/selectors";
import { dollars, percent, seconds } from "./results-ui";
import {
  scatterDomain,
  scatterLabels,
  scatterSeries,
  type ScatterPoint,
} from "./leaderboard-scatter-layout";
import "./leaderboard-scatter.css";

const rowLabel = (row: LeaderboardModelRow) =>
  row.configurationLabel ? `${row.model.name}, ${row.configurationLabel}` : row.model.name;

/** Plot every eligible configuration supplied, including earlier graded settings. */
export function LeaderboardScatter({
  rows,
  initialMetric = "time",
  compact = false,
}: {
  rows: readonly LeaderboardModelRow[];
  initialMetric?: "time" | "cost";
  compact?: boolean;
}) {
  const [metric, setMetric] = useState<"time" | "cost">(initialMetric);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);
  const [canvasWidth, setCanvasWidth] = useState(0);
  const canvasRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const width = canvasWidth || (compact ? 360 : 1100);
  const height = compact
    ? Math.round((width * 280) / 360)
    : Math.min(380, Math.round((width * 380) / 960));
  const margin = compact
    ? { top: 30, right: 16, bottom: 48, left: 52 }
    : { top: 30, right: 24, bottom: 48, left: 62 };
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
  const xDomain = scatterDomain(points.map((point) => point.value));
  const yDomain = scatterDomain(
    points.map((point) => point.score),
    true,
  );
  const xPosition = (value: number) =>
    margin.left + ((value - xDomain.min) / (xDomain.max - xDomain.min)) * plotWidth;
  const yPosition = (value: number) =>
    margin.top + ((yDomain.max - value) / (yDomain.max - yDomain.min)) * plotHeight;
  const plotted: ScatterPoint[] = points.map((point) => ({
    ...point,
    key: point.row.rowId ?? point.row.model.id,
    x: xPosition(point.value),
    y: yPosition(point.score),
  }));
  const series = scatterSeries(plotted);
  const labels = scatterLabels(
    series,
    {
      left: margin.left + 4,
      right: width - 4,
      top: 4,
      bottom: height - margin.bottom - 4,
    },
    compact,
  );
  const activeKey = hoveredKey ?? focusedKey ?? pinnedKey;
  const active = plotted.find((point) => point.key === activeKey);
  const activeRun = active && Object.values(active.row.runs)[0];
  const activeClient = active?.row.configurationLabel?.split(" · ").at(-1);
  const omitted = rows.filter((row) => !points.some((point) => point.row === row));
  const hasPoints = points.length > 0;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0) setCanvasWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [hasPoints]);
  const axisValue = (value: number) =>
    metric === "time"
      ? seconds(value).replace(".0s", "s")
      : `$${value.toFixed(xDomain.step < 0.01 ? 3 : 2)}`;
  const range = `${Math.round(yDomain.min * 100)}–${Math.round(yDomain.max * 100)}%`;

  function changeMetric(next: "time" | "cost") {
    setMetric(next);
    setHoveredKey(null);
    setFocusedKey(null);
    setPinnedKey(null);
  }

  function nearestPoint(event: { currentTarget: SVGSVGElement; clientX: number; clientY: number }) {
    const matrix = event.currentTarget.getScreenCTM();
    if (!matrix) return undefined;
    const cursor = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const nearest = [...plotted].sort(
      (a, b) =>
        Math.hypot(a.x - cursor.x, a.y - cursor.y) - Math.hypot(b.x - cursor.x, b.y - cursor.y),
    )[0];
    return nearest && Math.hypot(nearest.x - cursor.x, nearest.y - cursor.y) * matrix.a <= 24
      ? nearest
      : undefined;
  }

  return (
    <section className="lb-chart-section" aria-labelledby={`${id}-heading`}>
      <div className="lb-chart-heading">
        <div>
          <h2 id={`${id}-heading`}>Score and efficiency</h2>
          <p>
            Higher scores, {metric === "time" ? "less time" : "lower cost"}: look toward the top
            left.
          </p>
          <p>
            {points.length} of {rows.length} recorded settings · complete grading only
          </p>
        </div>
        <div className="lb-chart-controls" role="group" aria-label="Scatter plot horizontal axis">
          <button
            type="button"
            aria-pressed={metric === "time"}
            onClick={() => changeMetric("time")}
          >
            Average time
          </button>
          <button
            type="button"
            aria-pressed={metric === "cost"}
            onClick={() => changeMetric("cost")}
          >
            Cost / task
          </button>
        </div>
      </div>
      {points.length ? (
        <div
          className="lb-chart-wrap"
          role="region"
          aria-label="Score and efficiency chart"
          tabIndex={0}
          onPointerLeave={(event) => {
            if (event.pointerType !== "touch") setHoveredKey(null);
          }}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setFocusedKey(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setHoveredKey(null);
              setFocusedKey(null);
              setPinnedKey(null);
            }
          }}
        >
          <div className="lb-chart-canvas" ref={canvasRef}>
            <svg
              className={compact ? "lb-scatterplot lb-scatterplot-compact" : "lb-scatterplot"}
              viewBox={`0 0 ${width} ${height}`}
              role="group"
              aria-labelledby={`${id}-title ${id}-description`}
              onPointerMove={(event) => {
                if (event.pointerType === "touch") return;
                const nearest = nearestPoint(event);
                if (nearest) setHoveredKey(nearest.key);
              }}
              onPointerDown={(event) => {
                const nearest = nearestPoint(event);
                if (nearest) event.preventDefault();
                setHoveredKey(nearest?.key ?? null);
                setPinnedKey(nearest?.key ?? null);
                setFocusedKey(null);
              }}
            >
              <title id={`${id}-title`}>{`Overall score versus ${label.toLowerCase()}`}</title>
              <desc id={`${id}-description`}>
                Each point is an eligible model and reasoning setting. Lines join consecutive
                reasoning levels from the same model, route and benchmark cohort. Scores span{" "}
                {range}. Focus or select a point for exact values and its model profile. Press
                Escape to dismiss details.
              </desc>
              <g className="lb-chart-grid" aria-hidden="true">
                {yDomain.ticks.map((value) => (
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
                {xDomain.ticks.map((value, index) => (
                  <g key={value}>
                    <line
                      className="lb-chart-grid-vertical"
                      x1={xPosition(value)}
                      x2={xPosition(value)}
                      y1={margin.top}
                      y2={height - margin.bottom}
                    />
                    {(!compact || index % 2 === 0 || index === xDomain.ticks.length - 1) && (
                      <text
                        x={xPosition(value)}
                        y={height - margin.bottom + 23}
                        textAnchor="middle"
                      >
                        {axisValue(value)}
                      </text>
                    )}
                  </g>
                ))}
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
                transform={`translate(${compact ? 10 : 15} ${margin.top + plotHeight / 2}) rotate(-90)`}
                textAnchor="middle"
              >
                Overall score
              </text>
              <text className="lb-chart-range" x={width - margin.right} y={16} textAnchor="end">
                {range} range
              </text>
              <g aria-hidden="true" className="lb-chart-series">
                {series.flatMap((group) =>
                  group.segments.map(([from, to]) => (
                    <line
                      key={`${from.key}:${to.key}`}
                      x1={from.x}
                      x2={to.x}
                      y1={from.y}
                      y2={to.y}
                      stroke={from.row.model.color}
                    />
                  )),
                )}
              </g>
              {active && (
                <line
                  className="lb-chart-guide"
                  x1={active.x}
                  x2={active.x}
                  y1={active.y}
                  y2={height - margin.bottom}
                  stroke={active.row.model.color}
                  aria-hidden="true"
                />
              )}
              {labels.map((placed) => (
                <g key={placed.key} aria-hidden="true" className="lb-chart-family-label">
                  {Math.abs(placed.y - placed.point.y) > 25 && (
                    <line
                      className="lb-chart-label-line"
                      x1={placed.point.x}
                      y1={placed.point.y}
                      x2={Math.max(placed.x, Math.min(placed.x + placed.textWidth, placed.point.x))}
                      y2={placed.y - 4}
                    />
                  )}
                  <text
                    className="lb-chart-model-label"
                    x={placed.x}
                    y={placed.y}
                    fill={placed.color}
                  >
                    {placed.name}
                  </text>
                </g>
              ))}
              {plotted.map((point) => (
                <g
                  className="lb-chart-model"
                  key={point.key}
                  role="button"
                  tabIndex={0}
                  aria-pressed={active?.key === point.key}
                  aria-label={`${rowLabel(point.row)}: ${percent(point.score)} overall, ${format(point.value)} ${label.toLowerCase()}. Show details.`}
                  aria-describedby={active?.key === point.key ? `${id}-detail` : undefined}
                  onFocus={() => {
                    setHoveredKey(null);
                    setFocusedKey(point.key);
                  }}
                  onClick={(event) => {
                    // Pointer selection uses the closest dot, even where hit areas overlap.
                    if (event.detail === 0) {
                      setHoveredKey(null);
                      setPinnedKey(point.key);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setPinnedKey(point.key);
                    }
                  }}
                >
                  <circle className="lb-chart-hit" cx={point.x} cy={point.y} r={20} />
                  <circle
                    className="lb-chart-point-halo"
                    cx={point.x}
                    cy={point.y}
                    r={7}
                    stroke={point.row.model.color}
                  />
                  <circle
                    className="lb-chart-point"
                    cx={point.x}
                    cy={point.y}
                    r={compact ? 3.5 : 4.5}
                    fill={point.row.model.color}
                  />
                </g>
              ))}
            </svg>
            {active && (
              <div
                className="lb-chart-detail"
                id={`${id}-detail`}
                role="group"
                aria-label="Selected setting details"
                style={{
                  left:
                    active.x > width * 0.65
                      ? `max(8px, calc(${(active.x / width) * 100}% - 248px))`
                      : `min(calc(${(active.x / width) * 100}% + 12px), calc(100% - 244px))`,
                  top:
                    active.y > height * 0.6
                      ? `max(8px, calc(${(active.y / height) * 100}% - 90px))`
                      : `min(calc(${(active.y / height) * 100}% + 12px), calc(100% - 82px))`,
                }}
              >
                <a href={`#/models/${active.row.model.id}`}>
                  {active.row.model.name}
                  {activeRun?.configuration.reasoning && (
                    <>
                      {" "}
                      ·{" "}
                      <span className="lb-chart-detail-effort">
                        {activeRun.configuration.reasoning}
                      </span>
                    </>
                  )}
                </a>
                <span>
                  {percent(active.score)} overall ·{" "}
                  {active.row.averageTime.availability === "available"
                    ? seconds(active.row.averageTime.value)
                    : "Time unavailable"}
                </span>
                <span>
                  {active.row.estimatedCost.availability === "available"
                    ? `Est. ${dollars(active.row.estimatedCost.value)} / task`
                    : "Cost unavailable"}
                  {activeClient && ` · ${activeClient}`}
                </span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <p className="lb-chart-empty" role="status">
          No matching models have both an Overall score and {label.toLowerCase()} available.
        </p>
      )}
      {compact && points.length > 0 && (
        <details className="lb-chart-legend">
          <summary>{points.length} plotted settings: names and values</summary>
          <ol>
            {points.map((point) => (
              <li key={point.row.rowId ?? point.row.model.id}>
                <a href={`#/models/${point.row.model.id}`}>{rowLabel(point.row)}</a>
                <span>
                  {percent(point.score)} overall · {format(point.value)}
                </span>
              </li>
            ))}
          </ol>
        </details>
      )}
      {omitted.length > 0 && (
        <details className="results-footnote">
          <summary>{omitted.length} settings not plotted</summary>
          <p>
            {omitted
              .map(
                (row) =>
                  `${rowLabel(row)} (${row.overall === null ? "Overall score unavailable" : `${label.toLowerCase()} unavailable`})`,
              )
              .join("; ")}
            .
          </p>
        </details>
      )}
      <p className="results-footnote">
        Shows all fully graded settings in the latest sweep, including earlier reasoning levels.
        Each point uses the same score and measurement rules as the table. Models used different
        clients; see run details for coverage and cost sources.
      </p>
    </section>
  );
}
