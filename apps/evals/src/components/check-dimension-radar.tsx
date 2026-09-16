import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart } from "recharts";
import { AvailabilityMark } from "../canonical/components";
import {
  buildCheckDimensionView,
  CHECK_AXIS_LABELS,
  type CheckDimensionSeriesInput,
} from "../canonical/radar-axes";
import { Panel } from "./eval-ui";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "./ui/chart";
import "./check-dimension-radar.css";

const DEFAULT_DESCRIPTION =
  "Pass rate per grader check as passed/(passed+failed). Checks with no pass or fail are omitted from the shape and listed in the table. The filled area is not a composite score.";

const CHART_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)"] as const;

function payloadCheck(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null || !("check" in payload)) {
    return undefined;
  }
  return typeof payload.check === "string" ? payload.check : undefined;
}

function blockedAvailability(
  series: readonly CheckDimensionSeriesInput[],
): "withheld" | "not_retained" | "not_recorded" | "no_declared_method" | undefined {
  for (const entry of series) {
    const availability = entry.dimensions.availability;
    if (availability !== "available") return availability;
  }
  return undefined;
}

export function CheckDimensionPanel({
  series,
  fill,
  title = "Check dimensions",
  description = DEFAULT_DESCRIPTION,
}: {
  readonly series: readonly CheckDimensionSeriesInput[];
  readonly fill: boolean;
  readonly title?: string;
  readonly description?: string;
}) {
  const view = buildCheckDimensionView(series);

  if (view.kind === "unavailable") {
    const availability = blockedAvailability(series);
    return (
      <Panel title={title} description={description} className="check-dimension-radar">
        <p className="eval-muted check-dimension-radar-note">
          {availability !== undefined ? (
            <>
              <AvailabilityMark availability={availability} />
              {" · "}
            </>
          ) : null}
          {view.reason}
        </p>
      </Panel>
    );
  }

  const chartConfig: ChartConfig = {};
  for (const [index, entry] of series.entries()) {
    chartConfig[entry.key] = {
      label: entry.label,
      color: CHART_COLORS[index % CHART_COLORS.length] ?? "var(--chart-1)",
    };
  }

  const data =
    view.chart === null
      ? []
      : view.chart.map((point) => ({
          ...point.values,
          check: point.check,
          label: point.label,
        }));

  const omittedCaption =
    view.omitted.length > 0
      ? `Omitted from the shape: ${view.omitted.map((check) => CHECK_AXIS_LABELS[check]).join(", ")}`
      : null;

  return (
    <Panel title={title} description={description} className="check-dimension-radar">
      {view.chart !== null ? (
        <div className="check-dimension-radar-chart" aria-hidden="true">
          <ChartContainer config={chartConfig}>
            <RadarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
              <PolarGrid gridType="circle" />
              <PolarAngleAxis dataKey="label" />
              <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
              {series.map((entry) => (
                <Radar
                  key={entry.key}
                  name={entry.key}
                  dataKey={entry.key}
                  fill={`var(--color-${entry.key})`}
                  stroke={`var(--color-${entry.key})`}
                  fillOpacity={fill ? 0.25 : 0}
                  dot={fill}
                />
              ))}
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelKey="label"
                    formatter={(value, name, item) => {
                      const key = String(name);
                      const check = payloadCheck(item.payload);
                      const sample =
                        check === undefined
                          ? undefined
                          : view.chart?.find((point) => point.check === check)?.samples[key];
                      const seriesLabel = series.find((entry) => entry.key === key)?.label ?? key;
                      const rate = typeof value === "number" ? `${value.toFixed(1)}%` : "—";
                      const counts =
                        sample === undefined
                          ? rate
                          : `${sample.passed}/${sample.passed + sample.failed} (${rate})`;
                      return (
                        <div className="flex flex-1 items-center justify-between gap-4">
                          <span className="text-muted-foreground">{seriesLabel}</span>
                          <span className="font-mono font-medium tabular-nums">{counts}</span>
                        </div>
                      );
                    }}
                  />
                }
              />
              {series.length > 1 ? <ChartLegend content={<ChartLegendContent />} /> : null}
            </RadarChart>
          </ChartContainer>
        </div>
      ) : (
        <p className="eval-muted check-dimension-radar-note">
          Fewer than three checks have pass or fail evidence, so no radar is drawn.
        </p>
      )}

      <div className="check-dimension-radar-table-wrap">
        <table className="eval-table">
          {omittedCaption !== null ? (
            <caption className="eval-muted">{omittedCaption}</caption>
          ) : null}
          <thead>
            {series.length > 1 ? (
              <tr>
                <th scope="col" rowSpan={2}>
                  Check
                </th>
                {series.map((entry) => (
                  <th key={entry.key} scope="colgroup" colSpan={4}>
                    {entry.label}
                  </th>
                ))}
              </tr>
            ) : null}
            <tr>
              {series.length === 1 ? <th scope="col">Check</th> : null}
              {series.map((entry) => [
                <th key={`${entry.key}-passed`} scope="col">
                  passed
                </th>,
                <th key={`${entry.key}-failed`} scope="col">
                  failed
                </th>,
                <th key={`${entry.key}-na`} scope="col">
                  n/a
                </th>,
                <th key={`${entry.key}-rate`} scope="col">
                  rate
                </th>,
              ])}
            </tr>
          </thead>
          <tbody>
            {view.table.map((row) => (
              <tr key={row.check}>
                <th scope="row">{row.label}</th>
                {series.map((entry) => {
                  const cell = row.cells[entry.key];
                  if (cell === undefined) {
                    return [
                      <td key={`${entry.key}-passed`}>
                        <span className="eval-muted">—</span>
                      </td>,
                      <td key={`${entry.key}-failed`}>
                        <span className="eval-muted">—</span>
                      </td>,
                      <td key={`${entry.key}-na`}>
                        <span className="eval-muted">—</span>
                      </td>,
                      <td key={`${entry.key}-rate`}>
                        <span className="eval-muted">—</span>
                      </td>,
                    ];
                  }
                  return [
                    <td key={`${entry.key}-passed`}>{cell.passed}</td>,
                    <td key={`${entry.key}-failed`}>{cell.failed}</td>,
                    <td key={`${entry.key}-na`}>
                      {cell.notApplicable === null &&
                      (cell.notEvaluated === null || cell.notEvaluated === 0) ? (
                        <span className="eval-muted">—</span>
                      ) : (
                        <>
                          {cell.notApplicable === null ? (
                            <span className="eval-muted">—</span>
                          ) : (
                            cell.notApplicable
                          )}
                          {cell.notEvaluated !== null && cell.notEvaluated > 0 ? (
                            <span className="eval-muted"> · {cell.notEvaluated} not eval</span>
                          ) : null}
                        </>
                      )}
                    </td>,
                    <td key={`${entry.key}-rate`}>
                      {cell.ratePct === null ? (
                        <span className="eval-muted">—</span>
                      ) : (
                        `${cell.ratePct.toFixed(1)}%`
                      )}
                    </td>,
                  ];
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
