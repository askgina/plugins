import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { expect, test } from "vitest";
import { LeaderboardPage } from "../src/pages/leaderboard";
import { configurationLeaderboardRows, deduplicateEvidenceRows } from "../src/canonical/selectors";

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

test("the page supplies all eligible original and recovery settings to the chart", () => {
  const html = renderToStaticMarkup(createElement(LeaderboardPage));
  expect(html.match(/class="lb-chart-model"/gu)).toHaveLength(19);
  expect(html).toContain("GPT-6 Astra, low reasoning");
  expect(html).toContain("GPT-6 Astra, high reasoning");
});

test("shows every recorded model setting in its own row", () => {
  const configurations = deduplicateEvidenceRows(configurationLeaderboardRows());
  const html = renderToStaticMarkup(createElement(LeaderboardPage));
  expect(html.match(/<tr data-configuration=/gu)).toHaveLength(configurations.length);
  for (const row of configurations) {
    expect(html).toContain(`data-configuration="${row.rowId}"`);
  }
  expect(new Set(configurations.map((row) => row.model.id)).size).toBe(10);
  expect(html).toContain("Every recorded setting has its own row");
  expect(html).not.toContain("Recorded setting</label>");
  expect(html).not.toMatch(/\bOMP\b/u);
});

test("Fable low, medium, high and incomplete max are visible without a setting switch", () => {
  const html = renderToStaticMarkup(createElement(LeaderboardPage));
  for (const [reasoning, result] of [
    ["low", "61.7%"],
    ["medium", "64.1%"],
    ["high", "61.5%"],
    ["max", "75/105 graded"],
  ]) {
    const row = html.match(
      new RegExp(`<tr data-configuration="fable-${reasoning}-[^]*?</tr>`),
    )?.[0];
    expect(row).toBeDefined();
    expect(row).toContain(result);
    expect(row).toContain(`${reasoning} reasoning`);
    expect(row).toContain("120s timeout");
    expect(row).toMatch(/\$[0-9]+\.[0-9]{3}/u);
  }
});

test("expanded evidence uses separate identities for each setting of the same model", () => {
  const html = renderToStaticMarkup(
    createElement(LeaderboardPage, { initialExpandedModel: "claude-fable" }),
  );
  const ids = [...html.matchAll(/ id="([^"]+)"/gu)].map((match) => match[1]);
  expect(new Set(ids).size).toBe(ids.length);
  expect(html).toContain("Source artifact SHA-256");
  expect(html).toContain("Recorded tokens");
  expect(html).toContain("View Predictions tasks and conversations");
});
