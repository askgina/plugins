import { createHash } from "node:crypto";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import { it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { canonicalRuns } from "../src/canonical/canonical";
import { configurationLeaderboardRows, recordedOutcomes } from "../src/canonical/selectors";
import { AttemptChecks } from "../src/components/task-evidence";
import { LeaderboardPage } from "../src/pages/leaderboard";
import results from "../src/results/2026-09-24/claude-opus-5.5/results.json";
import snapshot from "../src/results/2026-09-24/claude-opus-5.5/snapshot.json";

const runs = canonicalRuns.filter((run) => run.campaignId === results.campaignId);
const rows = configurationLeaderboardRows().filter((row) => row.campaignId === results.campaignId);
const attempts = runs.flatMap((run) =>
  run.attempts.availability === "available" ? run.attempts.value : [],
);

test("publishes every terminal slot with execution failures separate from graded failures", () => {
  expect(runs).toHaveLength(15);
  expect(attempts).toHaveLength(525);
  expect(recordedOutcomes(runs)).toEqual({
    planned: 525,
    started: 525,
    graded: 524,
    passed: 300,
    failed: 224,
    timedOut: 1,
    runtimeFailure: 0,
    pending: 0,
    unstarted: 0,
    unknown: 0,
  });
  expect(new Set(runs.map((run) => run.timeoutMs))).toEqual(new Set([720000]));
  expect(canonicalRuns.some((run) => run.modelId === "claude-opus")).toBe(true);
});

test("scores all five completed settings with zero credit for errors and retains actual grading coverage", () => {
  expect(rows).toHaveLength(5);
  for (const [reasoning, graded, passed, failed] of [
    ["low", 105, 55, 50],
    ["medium", 105, 57, 48],
    ["high", 105, 57, 48],
    ["xhigh", 105, 66, 39],
    ["max", 104, 65, 39],
  ] as const) {
    const selected = runs.filter((run) => run.configuration.reasoning === reasoning);
    expect(recordedOutcomes(selected)).toMatchObject({ planned: 105, graded, passed, failed });
    const row = rows.find((entry) => entry.runs.Spot?.configuration.reasoning === reasoning)!;
    expect(row.overall).toBeCloseTo(
      selected.reduce((sum, run) => sum + run.counts.passed / run.counts.planned, 0) / 3,
    );
    expect(row.estimatedCost.availability).toBe("unavailable");
    const html = renderToStaticMarkup(createElement(LeaderboardPage, { rows: [row] }));
    expect(html).toContain(`${graded}/105 graded`);
    if (graded < 105) expect(html).toContain(`${105 - graded} ungraded · zero credit`);
    expect(html).toContain("Claude Opus 5.5");
    expect(html).not.toContain("$0.000");
  }
});

test("retains the fresh price check separately from historical regrades", () => {
  const checks = results.models.flatMap((row) => row.runs.flatMap((run) => run.priceChecks));
  expect(checks).toHaveLength(45);
  expect(checks.filter((check) => check.outcome === "fail")).toHaveLength(27);
  expect(
    checks.filter((check) => check.nativeVerdict === "pass" && check.outcome === "fail"),
  ).toHaveLength(4);
  const grounded = attempts.filter((attempt) => attempt.priceGrounding !== undefined);
  expect(grounded).toHaveLength(45);
  for (const attempt of grounded) {
    expect(attempt.gradingRevision).toBeUndefined();
    if (attempt.priceGrounding?.outcome === "fail") expect(attempt.verdict).toBe("fail");
  }
  const html = renderToStaticMarkup(
    createElement(AttemptChecks, {
      attempt: grounded.find((attempt) => attempt.priceGrounding?.outcome === "fail")!,
    }),
  );
  expect(html).toContain("Price grounding");
  expect(html).toContain("perps-price-evidence-v2");
  expect(html).not.toContain("Regraded");
});

test("retains original grades and applies only the evidence envelope correction", () => {
  expect(results.originalCounts).toMatchObject({
    graded: 524,
    passed: 282,
    failed: 242,
    timeouts: 1,
  });
  const revision = results.gradingRevision;
  expect(revision.modelReruns).toBe(0);
  expect(revision.rawEvidenceUnchanged).toBe(true);
  expect(revision.entries).toHaveLength(45);
  expect(
    revision.entries.filter((entry) => entry.originalPass !== entry.correctedPass),
  ).toHaveLength(18);
  for (const entry of revision.entries) {
    expect(entry.correctedPass).toBe(entry.nativePass && entry.correctedPriceScore === 1);
    expect(entry.originalPriceScore).toBe(0);
  }
  const timeout = attempts.find((attempt) => attempt.execution === "timed_out")!;
  expect(timeout.caseId).toBe("predictions-fetch-history-data");
  expect(timeout.repetition).toBe(3);
  expect(timeout.verdict).toBe("not_graded");
});

test("withholds private conversations without borrowing an older campaign's transcript", () => {
  for (const attempt of attempts) {
    expect(attempt.conversation).toBeUndefined();
    expect(attempt.answer.availability).not.toBe("available");
    expect(attempt.toolCalls.availability).not.toBe("available");
    if (attempt.execution !== "completed") expect(attempt.verdict).toBe("not_graded");
  }
});

it.effect("binds the publication to the evidence inventory and checked-in exporter", () =>
  Effect.gen(function* () {
    const sha = (path: string) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        return createHash("sha256")
          .update(yield* fs.readFile(path))
          .digest("hex");
      });
    expect(results.sourceManifestSha256).toBe(
      yield* sha("apps/evals/src/results/2026-09-24/claude-opus-5.5/snapshot.json"),
    );
    expect(results.gradingRevision.correctedGraderSha256).toBe(
      yield* sha("packages/evals/src/perps-price.ts"),
    );
    expect(results.gradingRevision.exporterSha256).toBe(
      yield* sha("tools/regrade-opus55-price-envelopes.mjs"),
    );
    expect(snapshot.exporterSha256).toBe(yield* sha("tools/project-eval-opus55.py"));
    expect(snapshot.files.find((file) => file.path === "plan.json")?.sha256).toBe(
      results.sourcePlanSha256,
    );
    expect(snapshot.files.find((file) => file.path === "results/run/progress.json")?.sha256).toBe(
      results.sourceStatusSha256,
    );
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
