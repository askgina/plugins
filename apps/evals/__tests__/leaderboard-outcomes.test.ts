import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { expect, test } from "vitest";
import { LeaderboardPage } from "../src/pages/leaderboard";
import { configurationLeaderboardRows } from "../src/canonical/selectors";

test("retains visible outcomes when a later configuration has incomplete grading", () => {
  const row = configurationLeaderboardRows().find(
    (entry) => entry.runs.Spot?.runId === "astra-max-spot-1",
  )!;
  const html = renderToStaticMarkup(createElement(LeaderboardPage, { rows: [row] }));
  expect(html).toContain("32/105 graded");
  expect(html).toContain("passed");
  expect(html).toContain("failed");
  expect(html).toContain("Not ranked");
  expect(html).not.toMatch(/>\s*—\s*</u);
  expect(html).toContain("run=astra-max-perps-1");
});

test("the page supplies all eligible sweep settings to the chart", () => {
  const html = renderToStaticMarkup(createElement(LeaderboardPage));
  expect(html.match(/class="lb-chart-model"/gu)).toHaveLength(13);
  expect(html).toContain("GPT-6 Astra, low reasoning");
  expect(html).toContain("GPT-6 Astra, high reasoning");
});
