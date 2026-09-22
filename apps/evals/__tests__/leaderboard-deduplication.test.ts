import { expect, test } from "vitest";
import {
  configurationLeaderboardRows,
  deduplicateEvidenceRows,
  leaderboardCampaignRows,
  type LeaderboardModelRow,
} from "../src/canonical/selectors";

const rows = configurationLeaderboardRows();
const grok = rows.filter(
  (row) => row.model.id === "grok" && row.configurationLabel === "low reasoning",
);

test("shows imported Grok low evidence once, preferring its original campaign regardless of order", () => {
  expect(grok).toHaveLength(2);
  for (const input of [grok, [...grok].reverse()]) {
    const distinct = deduplicateEvidenceRows(input);
    expect(distinct).toHaveLength(1);
    expect(distinct[0]?.campaignId).toBe("reasoning-sweep-2026-09-16");
  }
  expect(deduplicateEvidenceRows(rows)).toHaveLength(rows.length - 1);
  // Filtering happens first, so the retained baseline is still available when
  // the user explicitly selects that campaign.
  expect(
    deduplicateEvidenceRows(grok.filter((row) => row.campaignId === "recovery-2026-09-21")),
  ).toHaveLength(1);
});

test("equal scores do not hide independent executions", () => {
  const original = grok[0]!;
  const independent = {
    ...original,
    rowId: "independent-execution",
    runs: Object.fromEntries(
      Object.entries(original.runs).map(([family, run]) => [
        family,
        {
          ...run,
          attempts:
            run.attempts.availability === "available"
              ? {
                  ...run.attempts,
                  value: run.attempts.value.map((attempt) => ({
                    ...attempt,
                    conversation: attempt.conversation
                      ? { ...attempt.conversation, sourceSummarySha256: "f".repeat(64) }
                      : undefined,
                  })),
                }
              : run.attempts,
        },
      ]),
    ),
  };
  expect(deduplicateEvidenceRows([original, independent])).toHaveLength(2);
});

test("latest view keeps reasoning levels while hiding older campaigns and candidate aliases", () => {
  const latest = leaderboardCampaignRows(rows);
  expect(latest).toHaveLength(40);
  expect(new Set(latest.map((row) => `${row.model.id}/${row.configurationLabel}`)).size).toBe(40);
  expect(latest.filter((row) => row.model.id === "astra")).toHaveLength(5);
  expect(latest.filter((row) => row.model.id === "claude-fable")).toHaveLength(4);
  expect(
    latest.find((row) => row.runs.Perps?.runId === "recovery-astra-max-perps-1"),
  ).toBeDefined();
  expect(latest.some((row) => row.runs.Perps?.runId === "astra-max-perps-1")).toBe(false);
  expect(latest.some((row) => row.runs.Spot?.runId === "fable-spot-1")).toBe(false);
  expect(leaderboardCampaignRows([...rows].reverse())).toEqual(latest);
});

test("latest selection never falls back to an older complete or higher scoring result", () => {
  const original = grok[0]!;
  const later: LeaderboardModelRow = {
    ...original,
    rowId: "later-incomplete",
    campaignId: "later-campaign",
    overall: null,
    runs: Object.fromEntries(
      Object.entries(original.runs).map(([family, run]) => [
        family,
        {
          ...run,
          startedAt: "2099-01-01T00:00:00Z",
          recovery: undefined,
          counts: { ...run.counts, graded: 0 },
        },
      ]),
    ),
  };
  expect(leaderboardCampaignRows([original, later])).toEqual([later]);
  expect(leaderboardCampaignRows([original, { ...later, overall: 0.1 }])[0]?.rowId).toBe(
    "later-incomplete",
  );
});

test("history and campaign filters retain original records, including copied campaign baselines", () => {
  expect(leaderboardCampaignRows(rows, "all")).toEqual(deduplicateEvidenceRows(rows));
  expect(leaderboardCampaignRows(rows, "reasoning-sweep-2026-09-16")).toHaveLength(35);
  const recovery = leaderboardCampaignRows(rows, "recovery-2026-09-21");
  expect(recovery).toHaveLength(11);
  expect(
    recovery.some((row) => row.model.id === "grok" && row.configurationLabel === "low reasoning"),
  ).toBe(true);
});

test("different harnesses and benchmark definitions remain separate in the latest view", () => {
  const original = grok[0]!;
  for (const cohortChange of [{ target: "muse_cli" as const }, { fixtureVersion: 999 }]) {
    const different: LeaderboardModelRow = {
      ...original,
      rowId: "different-benchmark",
      runs: Object.fromEntries(
        Object.entries(original.runs).map(([family, run]) => [
          family,
          {
            ...run,
            cohort: { ...run.cohort, ...cohortChange },
            // No identity-bound copy: these are separate executions.
            attempts: { availability: "not_recorded" as const },
          },
        ]),
      ),
    };
    expect(leaderboardCampaignRows([original, different])).toHaveLength(2);
  }
});
