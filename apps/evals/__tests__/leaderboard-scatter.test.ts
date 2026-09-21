import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { configurationLeaderboardRows, type LeaderboardModelRow } from "../src/canonical/selectors";
import { LeaderboardScatter } from "../src/components/leaderboard-scatter";
import {
  scatterDomain,
  scatterSeries,
  type ScatterPoint,
} from "../src/components/leaderboard-scatter-layout";

const asPoint = (row: LeaderboardModelRow, index: number): ScatterPoint => ({
  row,
  key: row.rowId ?? String(index),
  value: index,
  score: row.overall ?? 0,
  x: index,
  y: 0,
});

describe("research chart comparisons", () => {
  const eligible = configurationLeaderboardRows().filter(
    (row) => row.overall !== null && row.campaignId !== "recovery-2026-09-21",
  );
  const astra = eligible.filter((row) => row.model.name === "GPT-6 Astra");

  test("connects the six existing model series in reasoning order without changing eligible results", () => {
    const groups = scatterSeries(eligible.map(asPoint));
    expect(groups).toHaveLength(6);
    expect(groups.flatMap((group) => group.points)).toHaveLength(13);
    expect(groups.flatMap((group) => group.segments)).toHaveLength(7);
    const ordered = scatterSeries(astra.map(asPoint))[0]!;
    expect(
      ordered.points.map((point) => Object.values(point.row.runs)[0]!.configuration.reasoning),
    ).toEqual(["low", "medium", "high"]);
  });

  test("does not connect across campaigns, clients, time limits, or authentication routes", () => {
    const low = astra.find((row) => row.configurationLabel?.startsWith("low"))!;
    const medium = astra.find((row) => row.configurationLabel?.startsWith("medium"))!;
    const changedRuns = (
      change: (run: NonNullable<typeof medium.runs.Spot>) => NonNullable<typeof medium.runs.Spot>,
    ) => ({
      ...medium,
      runs: Object.fromEntries(
        Object.entries(medium.runs).map(([family, run]) => [family, change(run)]),
      ),
    });
    const alternatives = [
      { ...medium, campaignId: "another-campaign" },
      changedRuns((run) => ({ ...run, cohort: { ...run.cohort, target: "another-client" } })),
      changedRuns((run) => ({ ...run, timeoutMs: 999999 })),
      changedRuns((run) => ({
        ...run,
        configuration: { ...run.configuration, candidate: "api-route-medium" },
      })),
    ];
    for (const alternative of alternatives) {
      const groups = scatterSeries([low, alternative].map(asPoint));
      expect(groups).toHaveLength(2);
      expect(groups.flatMap((group) => group.segments)).toHaveLength(0);
    }
  });

  test("does not bridge an unplotted reasoning level", () => {
    const points = astra
      .filter((row) => !row.configurationLabel?.startsWith("medium"))
      .map(asPoint);
    expect(scatterSeries(points).flatMap((group) => group.segments)).toHaveLength(0);
  });

  test("uses a declared score range containing every point, including equal and boundary scores", () => {
    const domain = scatterDomain(
      eligible.map((row) => row.overall!),
      true,
    );
    expect(domain.min).toBeCloseTo(0.2);
    expect(domain.max).toBeCloseTo(0.7);
    for (const values of [[0], [1], [0.64, 0.64], [0, 1]]) {
      const range = scatterDomain(values, true);
      expect(range.min).toBeLessThanOrEqual(Math.min(...values));
      expect(range.max).toBeGreaterThanOrEqual(Math.max(...values));
      expect(range.max).toBeGreaterThan(range.min);
      expect(range.ticks.every(Number.isFinite)).toBe(true);
    }
  });
});

describe("scatter plot configuration rows", () => {
  test("plots all 13 fully graded sweep settings on both efficiency axes", () => {
    const rows = configurationLeaderboardRows().filter(
      (row) => row.campaignId === "reasoning-sweep-2026-09-16",
    );
    for (const initialMetric of ["time", "cost"] as const) {
      const html = renderToStaticMarkup(createElement(LeaderboardScatter, { rows, initialMetric }));
      expect(html.match(/class="lb-chart-model"/gu)).toHaveLength(13);
      expect(html).toContain("22 settings not plotted");
      expect(html).toContain("Grok 4.6, low reasoning");
    }
  });
  test("distinguishes settings and reports omitted settings of a plotted model", () => {
    const base = configurationLeaderboardRows().find((row) => row.overall !== null)!;
    const rows: LeaderboardModelRow[] = [
      {
        ...base,
        rowId: "setting-low",
        configurationLabel: "low reasoning · OMP",
        overall: 0.5,
        averageTime: { availability: "available", value: 1000, sampleCount: 105, excluded: 0 },
      },
      {
        ...base,
        rowId: "setting-high",
        configurationLabel: "high reasoning · OMP",
        overall: 0.7,
        averageTime: { availability: "available", value: 2000, sampleCount: 105, excluded: 0 },
      },
      { ...base, rowId: "setting-max", configurationLabel: "max reasoning · OMP", overall: null },
    ];
    const html = renderToStaticMarkup(createElement(LeaderboardScatter, { rows }));
    expect(html.match(/class="lb-chart-model"/gu)).toHaveLength(2);
    expect(html).toContain(`${base.model.name}, low reasoning · OMP: 50.0% overall`);
    expect(html).toContain(`${base.model.name}, high reasoning · OMP: 70.0% overall`);
    expect(html).toContain(`${base.model.name}, max reasoning · OMP (Overall score unavailable)`);
  });

  test("renders the unavailable state when no rows can be plotted", () => {
    const html = renderToStaticMarkup(createElement(LeaderboardScatter, { rows: [] }));
    expect(html).toContain(
      "No matching models have both an Overall score and average time available.",
    );
    expect(html).not.toContain("<svg");
  });

  test("the compact chart preserves plotted settings and exact values in its numbered legend", () => {
    const html = renderToStaticMarkup(
      createElement(LeaderboardScatter, {
        rows: configurationLeaderboardRows(),
        compact: true,
      }),
    );
    expect(html).toContain('viewBox="0 0 360 280"');
    expect(html.match(/class="lb-chart-model"/gu)).toHaveLength(21);
    expect(html).toContain("21 plotted settings: names and values");
    expect(html).toContain("Grok 4.6, low reasoning · OMP");
    expect(html).toContain("65.7% overall · 30.3s");
    expect(html).toContain("30 settings not plotted");
  });
});
