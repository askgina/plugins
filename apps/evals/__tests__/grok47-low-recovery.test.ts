import { createHash } from "node:crypto";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import { it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { canonicalRuns } from "../src/canonical/canonical";
import {
  configurationLeaderboardRows,
  leaderboardCampaignRows,
  modelProfileRows,
  recordedBudgetLabel,
  recordedOutcomes,
  sameCohort,
  cohortLabel,
} from "../src/canonical/selectors";
import { AttemptConversationPanel } from "../src/components/conversation-panel";
import { LeaderboardMobile } from "../src/components/leaderboard-mobile";
import { ModelSettingResults } from "../src/components/model-setting-results";
import { LeaderboardPage } from "../src/pages/leaderboard";
import results from "../src/results/2026-09-22/grok-4.7/low-recovery.json";
import snapshot from "../src/results/2026-09-22/grok-4.7/low-recovery-snapshot.json";
import original from "../src/results/2026-09-22/grok-4.7/results.json";

const runs = canonicalRuns.filter((run) => run.campaignId === results.campaignId);
const attempts = runs.flatMap((run) =>
  run.attempts.availability === "available" ? run.attempts.value : [],
);

test("publishes all 105 Low slots while retaining every original grade", () => {
  expect(runs).toHaveLength(3);
  expect(attempts).toHaveLength(105);
  expect(recordedOutcomes(runs)).toEqual({
    planned: 105,
    started: 105,
    graded: 92,
    passed: 70,
    failed: 22,
    timedOut: 0,
    runtimeFailure: 13,
    pending: 0,
    unstarted: 0,
    unknown: 0,
  });
  const prior = original.models.find((row) => row.reasoning === "low")!;
  for (const oldRun of prior.runs) {
    const nextRun = results.models[0]!.runs.find((run) => run.family === oldRun.family)!;
    for (const oldTrial of oldRun.trials.filter((trial) => trial.score !== null)) {
      expect(
        nextRun.trials.find(
          (trial) => trial.caseId === oldTrial.caseId && trial.repetition === oldTrial.repetition,
        ),
      ).toEqual(oldTrial);
    }
  }
  expect(
    recordedOutcomes(canonicalRuns.filter((run) => run.campaignId === original.campaignId)).graded,
  ).toBe(314);
});

test("selects Low recovery in latest views while other levels keep their original publication", () => {
  const rows = configurationLeaderboardRows();
  for (const selected of [
    leaderboardCampaignRows(rows).filter((row) => row.model.id === "grok-4-7"),
    modelProfileRows("grok-4-7", rows),
  ]) {
    expect(selected).toHaveLength(4);
    const low = selected.find((row) => row.runs.Perps?.configuration.reasoning === "low")!;
    expect(low.campaignId).toBe(results.campaignId);
    expect(low.overall).toBeCloseTo((11 / 12 + 36 / 54 + 23 / 39) / 3);
    expect(low.estimatedCost.availability).toBe("unavailable");
    const html = renderToStaticMarkup(createElement(LeaderboardPage, { rows: [low] }));
    expect(html).toContain(">72.4%</span>");
    expect(html).toContain("13 ungraded · zero credit");
    expect(html).toContain("105/105 processed");
    expect(html).toContain("92/105 graded");
    expect(html).toContain("13 run errors");
    expect(html).not.toContain("Not ranked");
    for (const row of selected.filter((row) => row !== low))
      expect(row.campaignId).toBe(original.campaignId);
  }
});

test("Low is marked completed on the profile and mobile leaderboard with grading separate", () => {
  const low = modelProfileRows("grok-4-7").find((row) => row.campaignId === results.campaignId)!;
  for (const view of [
    createElement(ModelSettingResults, { modelId: "grok-4-7" }),
    createElement(LeaderboardMobile, { rows: [low] }),
  ]) {
    const html = renderToStaticMarkup(view);
    expect(html).toContain(">72.4%</span>");
    expect(html).toContain("13 ungraded · zero credit");
    expect(html).toContain("Completed · 105/105 processed");
    expect(html).toContain("92/105 graded");
    expect(html).toContain("13 run errors");
    expect(html).toContain("13 ungraded");
  }
});

test("retains 120/720-second lineage without claiming original-budget comparability", () => {
  expect(recordedBudgetLabel(runs)).toBe("120 / 720s recorded budgets");
  const executions = results.models.flatMap((row) => row.runs.flatMap((run) => run.executions));
  expect(executions.filter((execution) => execution.timeoutMs === 720000)).toHaveLength(9);
  expect(executions.filter((execution) => execution.timeoutMs === 120000)).toHaveLength(96);
  expect(executions.reduce((sum, execution) => sum + execution.history.length, 0)).toBe(114);
  for (const execution of executions)
    expect(execution.history.filter((entry) => entry.selected)).toHaveLength(1);
  for (const run of runs) {
    const previous = canonicalRuns.find(
      (candidate) =>
        candidate.campaignId === original.campaignId &&
        candidate.family === run.family &&
        candidate.configuration.reasoning === "low",
    )!;
    expect(sameCohort(previous.cohort, run.cohort)).toBe(false);
    expect(cohortLabel(run.cohort)).toContain("120–720s");
    const previousPrices =
      previous.attempts.availability === "available"
        ? previous.attempts.value.map((attempt) => attempt.priceGrounding)
        : [];
    expect(
      run.attempts.availability === "available"
        ? run.attempts.value.map((attempt) => attempt.priceGrounding)
        : [],
    ).toEqual(previousPrices);
  }
});

test("keeps conversations withheld while showing numeric execution history", () => {
  for (const attempt of attempts) {
    expect(attempt.conversation).toBeUndefined();
    expect(attempt.recovery?.history.every((entry) => entry.conversation === undefined)).toBe(true);
    expect(attempt.answer.availability).not.toBe("available");
    if (attempt.execution !== "completed") expect(attempt.verdict).toBe("not_graded");
  }
  const retry = attempts.find((attempt) => attempt.recovery?.history.length === 2)!;
  const html = renderToStaticMarkup(
    createElement(AttemptConversationPanel, { attempt: retry, model: undefined }),
  );
  expect(html).toContain("720s");
  expect(html).toContain("Conversations are withheld");
  expect(html).not.toContain("failed executions remain available here");
});

it.effect("binds numeric results to the baseline, VM inventory and exporter", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const sha = (path: string) =>
      fs
        .readFile(path)
        .pipe(Effect.map((bytes) => createHash("sha256").update(bytes).digest("hex")));
    expect(results.sourceManifestSha256).toBe(
      yield* sha("apps/evals/src/results/2026-09-22/grok-4.7/low-recovery-snapshot.json"),
    );
    expect(snapshot.baselineResultsSha256).toBe(
      yield* sha("apps/evals/src/results/2026-09-22/grok-4.7/results.json"),
    );
    expect(snapshot.exporterSha256).toBe(yield* sha("tools/project-eval-grok47-low-recovery.py"));
    expect(snapshot.projectionHelperSha256).toBe(yield* sha("tools/project-eval-grok47.py"));
    expect(snapshot.recoveryCounts).toEqual({
      planned: 9,
      graded: 5,
      passed: 2,
      failed: 3,
      ungraded: 4,
      pending: 0,
    });
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
