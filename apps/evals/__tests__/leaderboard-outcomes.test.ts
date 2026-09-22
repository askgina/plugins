import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { LeaderboardPage } from "../src/pages/leaderboard";
import type { CanonicalRunCounts } from "../src/canonical/canonical";
import {
  configurationLeaderboardRows,
  leaderboardCampaignRows,
  processingProgress,
} from "../src/canonical/selectors";
import { RecordedResult } from "../src/components/leaderboard-results";

afterEach(() => vi.unstubAllGlobals());

const terminalCounts: CanonicalRunCounts = {
  planned: 5,
  started: 5,
  completed: 3,
  graded: 3,
  passed: 2,
  failed: 1,
  timedOut: 1,
  runtimeFailure: 1,
  pending: 0,
  unstarted: 0,
  unknown: 0,
};
const runWithCounts = (counts: CanonicalRunCounts) => ({
  ...configurationLeaderboardRows()[0]!.runs.Spot!,
  counts,
});

test("finished runs include terminal errors in processing but never invent grades", () => {
  const runs = [runWithCounts(terminalCounts)];
  expect(processingProgress(runs)).toEqual({ planned: 5, processed: 5, complete: true });
  const html = renderToStaticMarkup(
    createElement(RecordedResult, { runs, score: null, overall: true }),
  );
  expect(html).toContain(">Score unavailable</span>");
  expect(html).toContain("Completed · 5/5 processed");
  expect(html).toContain("5/5 processed");
  expect(html).toContain("3/5 graded");
  expect(html).toContain("1 timed out");
  expect(html).toContain("1 run errors");
  expect(html).toContain("Not ranked");
});

test.each(["pending", "unstarted", "unknown"] as const)(
  "%s trials prevent a completed label even when dispatch reports complete",
  (state) => {
    const runs = [
      {
        ...runWithCounts({
          ...terminalCounts,
          started: state === "unstarted" ? 4 : 5,
          runtimeFailure: 0,
          [state]: 1,
        }),
        dispatchCoverage: "complete" as const,
      },
    ];
    expect(processingProgress(runs)).toEqual({ planned: 5, processed: 4, complete: false });
    const html = renderToStaticMarkup(
      createElement(RecordedResult, { runs, score: null, overall: true }),
    );
    expect(html).not.toContain("Completed ·");
    expect(html).toContain("4/5 processed");
    expect(html).toContain("3/5 graded");
  },
);

test("processing completion does not depend on a verdict and requires recorded trials", () => {
  const runs = [runWithCounts({ ...terminalCounts, graded: 2, passed: 1 })];
  expect(processingProgress(runs).complete).toBe(true);
  expect(processingProgress([])).toEqual({ planned: 0, processed: 0, complete: false });
  expect(
    processingProgress([
      runWithCounts({
        planned: 0,
        started: 0,
        completed: 0,
        graded: 0,
        passed: 0,
        failed: 0,
        timedOut: 0,
        runtimeFailure: 0,
        pending: 0,
        unstarted: 0,
        unknown: 0,
      }),
    ]).complete,
  ).toBe(false);
});

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

test("shows the latest campaign for each model setting by default", () => {
  const configurations = leaderboardCampaignRows(configurationLeaderboardRows());
  const html = renderToStaticMarkup(createElement(LeaderboardPage));
  expect(html.match(/<tr data-configuration=/gu)).toHaveLength(configurations.length);
  for (const row of configurations) {
    expect(html).toContain(`data-configuration="${row.rowId}"`);
  }
  expect(new Set(configurations.map((row) => row.model.id)).size).toBe(11);
  expect(html).toContain("Latest per setting keeps each reasoning level separate");
  expect(html).toContain("Recovery ·");
  expect(html).not.toContain("Recorded setting</label>");
  expect(html).not.toMatch(/\bOMP\b/u);
});

test("desktop history retains older results behind the campaign selector", () => {
  vi.stubGlobal("window", { location: { hash: "#/leaderboard?campaign=all" } });
  const html = renderToStaticMarkup(createElement(LeaderboardPage));
  expect(html.match(/<tr data-configuration=/gu)).toHaveLength(55);
  expect(html).toContain("55 records");
  expect(html).toContain('data-configuration="astra-max-');
  expect(html).toContain('data-configuration="recovery-astra-max-');
});

test("Fable low, medium, high and incomplete max are visible without a setting switch", () => {
  const html = renderToStaticMarkup(createElement(LeaderboardPage));
  for (const [reasoning, result] of [
    ["low", "56.1%"],
    ["medium", "59.7%"],
    ["high", "58.4%"],
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
