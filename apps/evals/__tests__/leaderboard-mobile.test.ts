import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import { configurationLeaderboardRows, leaderboardCampaignRows } from "../src/canonical/selectors";
import { LeaderboardMobile } from "../src/components/leaderboard-mobile";

const rows = configurationLeaderboardRows();
function render(hash: string) {
  vi.stubGlobal("window", { location: { hash } });
  return renderToStaticMarkup(createElement(LeaderboardMobile, { rows }));
}
afterEach(() => vi.unstubAllGlobals());

test("a shared mobile view restores model, campaign, grading, metric and sort direction", () => {
  const html = render(
    "#/leaderboard?search=Astra&campaign=reasoning-sweep-2026-09-16&grading=complete&metric=cost&direction=asc",
  );
  const settings = [...html.matchAll(/data-mobile-configuration="([^"]+)"/gu)].map(
    (match) => match[1],
  );
  expect(settings).toEqual([
    "astra-low-perps-1+astra-low-predictions-1+astra-low-spot-1",
    "astra-medium-perps-1+astra-medium-predictions-1+astra-medium-spot-1",
    "astra-high-perps-1+astra-high-predictions-1+astra-high-spot-1",
  ]);
  expect(html).toContain("3 settings");
  expect(html).toContain("$0.238");
  expect(html).toContain("105 attempts · 0 excluded");
});

test("mobile scores give execution errors zero credit while preserving their counts", () => {
  const html = render(
    "#/leaderboard?search=Astra&campaign=reasoning-sweep-2026-09-16&grading=incomplete",
  );
  const max = html.match(/<li data-mobile-configuration="astra-max-[^"]+"[^]*?<\/li>/u)?.[0];
  expect(max).toBeDefined();
  expect(max).toContain("32/105 graded");
  expect(max).toContain("73 ungraded · zero credit");
  expect(max).toContain("run errors");
  expect(max).toContain("timed out");
  // No Predictions grades means zero credit for that category, not a smaller denominator.
  expect(max).toContain("38.3%");
  expect(max).not.toContain("Score unavailable");
});

test("grouping keeps latest settings without inventing a combined model score", () => {
  const html = render("#/leaderboard?group=models");
  expect(html.match(/class="lb-mobile-group-trigger"/gu)).toHaveLength(11);
  const distinct = leaderboardCampaignRows(rows);
  expect(html.match(/data-mobile-configuration=/gu)).toHaveLength(distinct.length);
  expect(html).toContain("No settings are combined into a model score");
  for (const row of distinct) expect(html).toContain(`data-mobile-configuration="${row.rowId}"`);
});

test("grading filters do not bring superseded campaigns back into the latest view", () => {
  const html = render("#/leaderboard?search=Astra&grading=incomplete");
  expect(html.match(/data-mobile-configuration=/gu)).toHaveLength(1);
  expect(html).toContain('data-mobile-configuration="recovery-astra-xhigh-');
  expect(html).toContain("104/105 graded");
  expect(html).toContain("Recovery ·");
  expect(html).toContain("120 / 300s recorded budgets");
  expect(html).not.toContain('data-mobile-configuration="astra-max-');
});

test("mobile history can be shared and restores earlier campaigns", () => {
  const html = render("#/leaderboard?campaign=all");
  expect(html.match(/data-mobile-configuration=/gu)).toHaveLength(55);
  expect(html).toContain("55 records");
  expect(html).toContain('data-mobile-configuration="astra-max-');
  expect(html).toContain('data-mobile-configuration="recovery-astra-max-');
});

test("invalid view parameters recover to usable defaults and empty filters can be cleared", () => {
  const html = render("#/leaderboard?metric=invalid&view=invalid&search=no-such-model");
  expect(html).toContain("About Overall");
  expect(html).toContain("No matching results");
  expect(html).toContain("Clear filters");
});
