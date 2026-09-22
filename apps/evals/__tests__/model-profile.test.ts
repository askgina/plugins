import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import {
  configurationLeaderboardRows,
  modelProfileRows,
  recordedBudgetLabel,
} from "../src/canonical/selectors";
import { ModelSettingResults } from "../src/components/model-setting-results";
import { ModelProfilePage } from "../src/pages/model-profile";

test("expanded run details appear immediately after their history row", () => {
  const runId = "recovery-astra-max-perps-1";
  const html = renderToStaticMarkup(
    createElement(ModelProfilePage, {
      modelId: "astra",
      initialRunId: runId,
    }),
  );
  const row = html.slice(html.indexOf(`id="run-row-${runId}"`));
  expect(row).toMatch(/^id="run-row-[^]*?aria-expanded="true"/u);
  expect(row).toContain(`aria-controls="run-details-${runId}"`);
  expect(row).toMatch(
    new RegExp(`</tr><tr><td colSpan="8"[^>]*><section id="run-details-${runId}"`),
  );
  expect(row.indexOf(`id="run-details-${runId}"`)).toBeLessThan(
    row.indexOf('id="run-row-recovery-astra-max-predictions-1"'),
  );
  expect(html.match(/class="model-profile-run-detail"/gu)).toHaveLength(1);
});

test("Astra overview includes every effort and selects the latest whole setting without mixing campaigns", () => {
  const rows = modelProfileRows("astra");
  expect(rows.map((row) => Object.values(row.runs)[0]!.configuration.reasoning)).toEqual([
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ]);
  const max = rows.find((row) => row.runs.Spot?.configuration.reasoning === "max")!;
  expect(Object.values(max.runs).every((run) => run.campaignId === "recovery-2026-09-21")).toBe(
    true,
  );
  expect(max.overall).toBeCloseTo(0.804368471);
  const xhigh = rows.find((row) => row.runs.Spot?.configuration.reasoning === "xhigh")!;
  expect(xhigh.overall).toBeNull();
  expect(xhigh.runs.Predictions?.counts.graded).toBe(38);
  expect(configurationLeaderboardRows().filter((row) => row.model.id === "astra")).toHaveLength(7);
});

test("a newer incomplete setting remains visible instead of an older higher-scoring setting", () => {
  const original = modelProfileRows("astra").find((row) => row.overall !== null)!;
  const newer = {
    ...original,
    rowId: "newer-incomplete",
    campaignId: "newer-campaign",
    overall: null,
    runs: Object.fromEntries(
      Object.entries(original.runs).map(([family, run]) => [
        family,
        {
          ...run,
          startedAt: "2099-01-01T00:00:00Z",
          counts: { ...run.counts, graded: 0 },
        },
      ]),
    ),
  };
  expect(modelProfileRows("astra", [original, newer])).toEqual([newer]);
});

test("profiles keep distinct client routes and benchmark versions separate", () => {
  const original = modelProfileRows("astra")[0]!;
  const otherRoute = {
    ...original,
    rowId: "other-route",
    runs: Object.fromEntries(
      Object.entries(original.runs).map(([family, run]) => [
        family,
        {
          ...run,
          cohort: { ...run.cohort, target: "other-client" },
        },
      ]),
    ),
  };
  const otherFixture = {
    ...original,
    rowId: "other-fixture",
    runs: Object.fromEntries(
      Object.entries(original.runs).map(([family, run]) => [
        family,
        {
          ...run,
          cohort: { ...run.cohort, fixtureVersion: "different-fixture" },
        },
      ]),
    ),
  };
  expect(modelProfileRows("astra", [original, otherRoute, otherFixture])).toHaveLength(3);
});

test("Astra profile shows leaderboard percentages, incomplete grades and recorded budgets", () => {
  const html = renderToStaticMarkup(createElement(ModelSettingResults, { modelId: "astra" }));
  expect(html.match(/data-setting=/gu)).toHaveLength(5);
  expect(html).toContain("86.6%");
  expect(html).toContain("80.4%");
  expect(html).toContain("104/105 graded");
  expect(html).toContain("1 run errors");
  expect(html).toContain("120 / 300s recorded budgets");
  expect(html).not.toContain("600s timeout");
  expect(html).toContain("$0.349");
  expect(html).toContain("view=conversation");
});

test("recorded budgets reflect the attempts instead of the campaign ceiling", () => {
  const rows = modelProfileRows("astra");
  expect(
    recordedBudgetLabel(
      Object.values(rows.find((row) => row.runs.Spot?.configuration.reasoning === "max")!.runs),
    ),
  ).toBe("120 / 300s recorded budgets");
  expect(recordedBudgetLabel(Object.values(rows[0]!.runs))).toBe("120s timeout");
  expect(recordedBudgetLabel([])).toBe("Timeout not recorded");
});

test("model profiles retain earlier runs and source downloads below the setting summary", () => {
  const html = renderToStaticMarkup(createElement(ModelProfilePage, { modelId: "astra" }));
  expect(html).toContain("astra-max-predictions-1");
  expect(html).toContain("Original Reasoning sweep (2026-09-16) JSON");
  expect(html.indexOf("Results by reasoning level")).toBeLessThan(
    html.indexOf('class="eval-panel model-profile-history-panel"'),
  );
  expect(html).toContain("Configuration fingerprints &amp; original downloads");
  expect(html).not.toContain("Latest recorded run per family");
  expect(html).toContain("Latest recorded max reasoning");
  expect(html).toContain("model-profile-metrics");
  expect(html).toContain("How to read these results");
  expect(html.match(/Full campaign notes &amp; sources/gu)).toHaveLength(2);
  expect(html).toContain("209/210 graded");
  expect(html).not.toContain("600s timeout");
  expect(html).not.toContain('href="#/exports"');
});
