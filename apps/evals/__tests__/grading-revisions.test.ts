import { describe, expect, test } from "vitest";
import { canonicalRuns, originalCanonicalRuns } from "../src/canonical/canonical";
import { gradingRevisionEntries, reviseAttempt } from "../src/lib/grading-revisions";
import { configurationLeaderboardRows, headlineFor } from "../src/canonical/selectors";
import receipt from "../src/results/2026-09-21/regrade/receipt.json";

describe("versioned search regrade", () => {
  test("every change binds to an original trial, preserving every other grading dimension and evidence reference", () => {
    expect(receipt.reviewedAttempts).toBe(841);
    expect(gradingRevisionEntries).toHaveLength(544);
    const keys = new Set<string>();
    for (const entry of gradingRevisionEntries) {
      const key = `${entry.runId}/${entry.caseId}/${entry.repetition}`;
      expect(keys.has(key)).toBe(false);
      keys.add(key);
      const source = originalCanonicalRuns.find((run) => run.runId === entry.runId)!;
      const current = canonicalRuns.find((run) => run.runId === entry.runId)!;
      expect(source.attempts.availability).toBe("available");
      expect(current.attempts.availability).toBe("available");
      if (
        source.attempts.availability !== "available" ||
        current.attempts.availability !== "available"
      )
        continue;
      const before = source.attempts.value.find(
        (a) => a.caseId === entry.caseId && a.repetition === entry.repetition,
      )!;
      const after = current.attempts.value.find(
        (a) => a.caseId === entry.caseId && a.repetition === entry.repetition,
      )!;
      expect(before.verdict).toBe(entry.previousVerdict);
      expect(after.verdict).toBe(entry.verdict);
      expect(after.conversation).toEqual(before.conversation);
      expect(after.recovery).toEqual(before.recovery);
      expect(after.gradingRevision?.previousChecks).toEqual(
        before.checks.availability === "available" ? before.checks.value : undefined,
      );
      if (
        entry.kind !== "bounded_search" ||
        before.checks.availability !== "available" ||
        after.checks.availability !== "available"
      )
        continue;
      for (const dimension of ["arguments", "safety", "completion", "skillActivation"] as const)
        expect(after.checks.value[dimension]).toBe(before.checks.value[dimension]);
      if (
        Object.entries(before.checks.value).some(
          ([name, value]) => name !== "routing" && value === "fail",
        )
      )
        expect(after.verdict).toBe("fail");
      expect(after.durationMs).toEqual(before.durationMs);
      expect(after.tokenUsage).toEqual(before.tokenUsage);
      if (
        !gradingRevisionEntries.some((e) => e.runId === entry.runId && e.kind === "provider_error")
      )
        expect(current.recordedCostEstimate).toEqual(source.recordedCostEstimate);
    }
  });
  test("rejects a correction against different evidence", () => {
    const entry = gradingRevisionEntries[0]!;
    const run = originalCanonicalRuns.find((r) => r.runId === entry.runId)!;
    if (run.attempts.availability !== "available") throw new Error("Missing original");
    const attempt = run.attempts.value.find(
      (a) => a.caseId === entry.caseId && a.repetition === entry.repetition,
    )!;
    expect(() =>
      reviseAttempt(attempt, { ...entry, sourceSummarySha256: "0".repeat(64) }),
    ).toThrow();
  });
  test("excludes the provider-error slot from grades, timing and cost without erasing its chat", () => {
    const run = canonicalRuns.find((r) => r.runId === "recovery-astra-xhigh-predictions-1")!;
    expect(run.counts).toMatchObject({
      planned: 39,
      completed: 38,
      graded: 38,
      runtimeFailure: 1,
      passed: 30,
      failed: 8,
    });
    expect(headlineFor(run).kind).toBe("counts_only");
    expect(run.recordedCostEstimate).toMatchObject({ sampleCount: 38 });
    if (run.recordedCostEstimate?.availability === "available")
      expect(run.recordedCostEstimate.usdTotal).toBeCloseTo(11.790386, 8);
    expect(run.metrics.latencyMs).toMatchObject({ sampleCount: 38 });
    expect(run.metrics.tokenUsage).toMatchObject({
      sampleCount: 38,
      inputTokens: 844464,
      outputTokens: 23889,
    });
  });
  test("applies the same rule across models while withholding incomplete rankings", () => {
    const rows = configurationLeaderboardRows();
    for (const [id, label, campaign, score] of [
      ["astra", "high", "reasoning-sweep-2026-09-16", 0.8105413105413106],
      ["astra", "max", "recovery-2026-09-21", 0.7488129154795821],
      ["grok", "low", "reasoning-sweep-2026-09-16", (12 / 12 + 40 / 54 + 30 / 39) / 3],
    ] as const) {
      expect(
        rows.find(
          (r) =>
            r.model.id === id &&
            r.configurationLabel?.startsWith(label + " ") &&
            r.campaignId === campaign,
        )?.overall,
      ).toBeCloseTo(score, 10);
    }
    expect(
      rows.find(
        (r) =>
          r.model.id === "astra" &&
          r.configurationLabel?.startsWith("xhigh ") &&
          r.campaignId === "recovery-2026-09-21",
      )?.overall,
    ).toBeNull();
  });
});
