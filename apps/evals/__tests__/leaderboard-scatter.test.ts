import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { configurationLeaderboardRows, type LeaderboardModelRow } from "../src/canonical/selectors";
import { LeaderboardScatter } from "../src/components/leaderboard-scatter";

describe("scatter plot configuration rows", () => {
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
});
