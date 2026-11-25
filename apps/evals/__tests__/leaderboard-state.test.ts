import { expect, test } from "vitest";
import { configurationLeaderboardRows, type LeaderboardModelRow } from "../src/canonical/selectors";
import {
  leaderboardHash,
  readLeaderboardState,
  visibleLeaderboardRows,
  providerOverviewRows,
} from "../src/lib/leaderboard-state";
import { modelRowHref, rowMetricValue } from "../src/components/leaderboard-results";

const rows = configurationLeaderboardRows();

test("a shared link round-trips every desktop/mobile exploration control", () => {
  const state = {
    ...readLeaderboardState(""),
    search: "Grok & Astra",
    campaign: "all",
    grading: "incomplete" as const,
    metric: "cost" as const,
    direction: "asc" as const,
    group: "models" as const,
    view: "efficiency" as const,
    page: 3,
    category: "Predictions" as const,
    efficiency: "cost" as const,
    overview: true,
  };
  expect(readLeaderboardState(leaderboardHash(state))).toEqual(state);
});

test("time can be displayed independently while sorting by cost", () => {
  const state = readLeaderboardState("#/leaderboard?metric=cost&efficiency=time");
  expect(state.direction).toBe("asc");
  expect(state.efficiency).toBe("time");
  expect(readLeaderboardState(leaderboardHash(state))).toEqual(state);
});

test.each(["overall", "Spot", "Perps", "Predictions", "time", "cost"] as const)(
  "links preserve either sort direction and independent columns for %s",
  (metric) => {
    for (const direction of ["asc", "desc"] as const) {
      const state = {
        ...readLeaderboardState(""),
        metric,
        direction,
        category: "Spot" as const,
        efficiency: "time" as const,
      };
      expect(readLeaderboardState(leaderboardHash(state))).toEqual(state);
    }
  },
);

test.each(["Perps", "Predictions"] as const)(
  "a direct %s sort displays that category on tablet",
  (metric) => {
    expect(readLeaderboardState(`#/leaderboard?metric=${metric}`).category).toBe(metric);
  },
);

test.each(["-1", "NaN", "Infinity", "1.5", "9007199254740992"])(
  "invalid overview page %s recovers to the first page",
  (page) => {
    expect(readLeaderboardState(`#/leaderboard?page=${page}`).page).toBe(0);
  },
);

test("incomplete grading filters apply after latest-setting selection", () => {
  const shown = visibleLeaderboardRows(
    rows,
    readLeaderboardState("#/leaderboard?search=Astra&grading=incomplete"),
  );
  expect(shown).toHaveLength(1);
  expect(shown[0]?.runs.Spot?.runId).toBe("recovery-astra-xhigh-spot-1");
});

test.each(["asc", "desc"] as const)(
  "missing cost remains after measured zero cost when sorting %s",
  (direction) => {
    const shown = visibleLeaderboardRows(
      rows,
      readLeaderboardState(`#/leaderboard?metric=cost&direction=${direction}`),
    );
    const firstMissing = shown.findIndex((row) => rowMetricValue(row, "cost") === null);
    expect(firstMissing).toBeGreaterThan(0);
    expect(shown.slice(firstMissing).every((row) => rowMetricValue(row, "cost") === null)).toBe(
      true,
    );
    expect(shown.some((row) => rowMetricValue(row, "cost") === 0)).toBe(true);
  },
);

test("model navigation retains the clicked setting's real run, including non-Spot rows", () => {
  const row = rows.find((entry) => entry.runs.Spot?.runId === "astra-low-spot-1")!;
  expect(modelRowHref(row)).toBe("#/models/astra?run=astra-low-spot-1");
  const perpsOnly: LeaderboardModelRow = { ...row, runs: { Perps: row.runs.Perps } };
  expect(modelRowHref(perpsOnly)).toBe("#/models/astra?run=astra-low-perps-1");
});

test("the overview includes each provider once without changing ranked settings", () => {
  const shown = visibleLeaderboardRows(rows, readLeaderboardState(""));
  const originalOrder = shown.map((row) => row.rowId);
  const overview = providerOverviewRows(shown);
  expect(overview.map((row) => row.model.provider)).toEqual([
    "OpenAI",
    "xAI",
    "Muse",
    "Anthropic",
    "Google",
    "Devin",
  ]);
  for (const row of overview)
    expect(row).toBe(shown.find((entry) => entry.model.provider === row.model.provider));
  expect(shown.map((row) => row.rowId)).toEqual(originalOrder);
  expect(shown).toHaveLength(45);
});

test("provider representatives respect filtering and the active sort", () => {
  const shown = visibleLeaderboardRows(
    rows,
    readLeaderboardState("#/leaderboard?search=Astra&metric=cost"),
  );
  const overview = providerOverviewRows(shown);
  expect(overview).toHaveLength(1);
  expect(overview[0]).toBe(shown[0]);
  expect(overview[0]?.runs.Spot?.runId).toBe("astra-low-spot-1");
  expect(providerOverviewRows([])).toEqual([]);
});
