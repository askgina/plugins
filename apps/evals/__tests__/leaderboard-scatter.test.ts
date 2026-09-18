import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { configurationLeaderboardRows, type LeaderboardModelRow } from "../src/canonical/selectors";
import { LeaderboardScatter } from "../src/components/leaderboard-scatter";

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
    expect(html.match(/class="lb-chart-model"/gu)).toHaveLength(13);
    expect(html).toContain("13 plotted settings: names and values");
    expect(html).toContain("Grok 4.6, low reasoning · OMP");
    expect(html).toContain("65.7% overall · 30.3s");
    expect(html).toContain("27 settings not plotted");
  });
});
