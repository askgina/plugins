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
import results from "../src/results/2026-09-22/grok-4.7/results.json";
import snapshot from "../src/results/2026-09-22/grok-4.7/snapshot.json";

const runs = canonicalRuns.filter((run) => run.campaignId === results.campaignId);
const rows = configurationLeaderboardRows().filter((row) => row.campaignId === results.campaignId);
const attempts = runs.flatMap((run) =>
  run.attempts.availability === "available" ? run.attempts.value : [],
);

test("publishes every terminal slot with execution failures separate from graded failures", () => {
  expect(runs).toHaveLength(12);
  expect(attempts).toHaveLength(420);
  expect(recordedOutcomes(runs)).toEqual({
    planned: 420,
    started: 420,
    graded: 314,
    passed: 263,
    failed: 51,
    timedOut: 67,
    runtimeFailure: 39,
    pending: 0,
    unstarted: 0,
    unknown: 0,
  });
  expect(new Set(runs.map((run) => run.timeoutMs))).toEqual(new Set([120000]));
  expect(canonicalRuns.some((run) => run.modelId === "grok")).toBe(true);
});

test("scores all four completed settings with zero credit for errors and retains actual grading coverage", () => {
  expect(rows).toHaveLength(4);
  for (const [reasoning, graded, passed, failed] of [
    ["low", 87, 68, 19],
    ["medium", 79, 66, 13],
    ["high", 73, 64, 9],
    ["xhigh", 75, 65, 10],
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
    expect(html).toContain(`${105 - graded} ungraded · zero credit`);
    expect(html).toContain("Grok 4.7");
    expect(html).not.toContain("$0.000");
  }
});

test("retains the fresh price check separately from historical regrades", () => {
  const checks = results.models.flatMap((row) => row.runs.flatMap((run) => run.priceChecks));
  expect(checks).toHaveLength(36);
  expect(checks.filter((check) => check.outcome === "fail")).toHaveLength(16);
  expect(
    checks.filter((check) => check.nativeVerdict === "pass" && check.outcome === "fail"),
  ).toHaveLength(2);
  const grounded = attempts.filter((attempt) => attempt.priceGrounding !== undefined);
  expect(grounded).toHaveLength(36);
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
      yield* sha("apps/evals/src/results/2026-09-22/grok-4.7/snapshot.json"),
    );
    expect(snapshot.exporterSha256).toBe(yield* sha("tools/project-eval-grok47.py"));
    expect(snapshot.files.find((file) => file.path === "plan.json")?.sha256).toBe(
      results.sourcePlanSha256,
    );
    expect(snapshot.files.find((file) => file.path === "results/run/progress.json")?.sha256).toBe(
      results.sourceStatusSha256,
    );
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
