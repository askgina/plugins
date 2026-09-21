import { expect, test } from "vitest";
import { configurationLeaderboardRows, deduplicateEvidenceRows } from "../src/canonical/selectors";

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
