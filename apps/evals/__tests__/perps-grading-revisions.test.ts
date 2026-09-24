import { configurationLeaderboardRows, scoringCoverageFor } from "../src/canonical/selectors";
import { describe, expect, test } from "vitest";
import { canonicalRuns, originalCanonicalRuns } from "../src/canonical/canonical";
import {
  PERPS_GRADING_POLICY,
  perpsGradingEntries,
  reviseAttempt,
} from "../src/lib/grading-revisions";
import receipt from "../src/results/2026-09-21/regrade/perps-receipt.json";

describe("versioned Perps price regrade", () => {
  test("every fully graded setting has all nine price-task attempts reviewed", () => {
    for (const row of configurationLeaderboardRows().filter(
      (r) =>
        r.overall !== null &&
        Object.values(r.runs).every((run) => scoringCoverageFor(run) === "complete"),
    )) {
      const run = row.runs.Perps!;
      const nativeChecks =
        run.attempts.availability === "available"
          ? run.attempts.value.filter((attempt) => attempt.priceGrounding !== undefined).length
          : 0;
      expect(perpsGradingEntries.filter((e) => e.runId === run.runId).length + nativeChecks).toBe(
        9,
      );
    }
  });
  test("scoring execution errors does not give credit to failed price checks", () => {
    const reviewedCampaigns = new Set([
      "reasoning-sweep-2026-09-16",
      "recovery-2026-09-21",
      "grok47-20260921",
      "grok47-low-recovery-20260922",
      "opus55-20260922",
    ]);
    const priceCases = new Set([
      "perps-single-price",
      "perps-multiple-prices",
      "perps-asset-price",
      "perps-market-prices",
      "perps-hip3-price",
    ]);
    for (const row of configurationLeaderboardRows().filter(
      (r) => r.overall !== null && reviewedCampaigns.has(r.campaignId ?? ""),
    )) {
      const run = row.runs.Perps!;
      expect(run.attempts.availability).toBe("available");
      if (run.attempts.availability !== "available") continue;
      for (const attempt of run.attempts.value.filter((a) => priceCases.has(a.caseId))) {
        if (attempt.execution !== "completed") expect(attempt.verdict).toBe("not_graded");
        if (attempt.verdict === "pass") {
          expect(
            attempt.priceGrounding?.outcome ?? attempt.gradingRevision?.priceGrounding?.outcome,
          ).toBe("pass");
        }
      }
    }
  });
  test("binds every review and preserves other checks, costs, timing, and original transcript identities", () => {
    expect(receipt.policyId).toBe(PERPS_GRADING_POLICY);
    expect(
      receipt.inputs.some((input) => input.path === "packages/evals/src/price-claims.ts"),
    ).toBe(true);
    expect(receipt.reviewedAttempts).toBe(382);
    expect(receipt.skipped.filter((e) => e.reason === "execution_incomplete")).toHaveLength(32);
    expect(
      receipt.skipped.filter((e) => e.reason === "retained_evidence_unavailable"),
    ).toHaveLength(36);
    const keys = new Set();
    for (const entry of perpsGradingEntries) {
      const key = `${entry.runId}/${entry.caseId}/${entry.repetition}`;
      expect(keys.has(key)).toBe(false);
      keys.add(key);
      const original = originalCanonicalRuns.find((r) => r.runId === entry.runId)!;
      const current = canonicalRuns.find((r) => r.runId === entry.runId)!;
      if (
        original.attempts.availability !== "available" ||
        current.attempts.availability !== "available"
      )
        throw new Error("Missing attempts");
      const before = original.attempts.value.find(
        (a) => a.caseId === entry.caseId && a.repetition === entry.repetition,
      )!;
      const after = current.attempts.value.find(
        (a) => a.caseId === entry.caseId && a.repetition === entry.repetition,
      )!;
      expect(before.verdict).toBe(entry.previousVerdict);
      expect(after.verdict).toBe(entry.verdict);
      expect(after.conversation).toEqual(before.conversation);
      expect(after.recovery).toEqual(before.recovery);
      expect(after.durationMs).toEqual(before.durationMs);
      expect(after.tokenUsage).toEqual(before.tokenUsage);
      expect(current.recordedCostEstimate).toEqual(original.recordedCostEstimate);
      expect(current.metrics).toEqual(original.metrics);
      if (before.checks.availability !== "available" || after.checks.availability !== "available")
        throw new Error("Missing checks");
      expect(after.gradingRevision?.previousChecks).toEqual(before.checks.value);
      expect(after.gradingRevision?.policyId).toBe(PERPS_GRADING_POLICY);
      for (const dimension of ["safety", "completion", "skillActivation"] as const) {
        expect(after.checks.value[dimension]).toBe(before.checks.value[dimension]);
        if (before.checks.value[dimension] === "fail") expect(after.verdict).toBe("fail");
      }
      expect(() =>
        reviseAttempt(before, { ...entry, previousArguments: "not_evaluated" }),
      ).toThrow();
    }
  });
  test("removes false passes and restores supported failures across providers, including Grok", () => {
    const entries = (runId: string) => perpsGradingEntries.filter((e) => e.runId === runId);
    for (const runId of ["recovery-astra-xhigh-perps-1", "recovery-astra-max-perps-1"]) {
      expect(entries(runId)).toHaveLength(9);
      expect(
        entries(runId).every((e) => e.previousVerdict === "fail" && e.verdict === "pass"),
      ).toBe(true);
    }
    const grok = entries("grok-low-perps-1");
    expect(grok.filter((e) => e.previousVerdict === "pass" && e.verdict === "fail")).toHaveLength(
      8,
    );
    expect(grok.find((e) => e.caseId === "perps-single-price" && e.repetition === 1)?.verdict).toBe(
      "pass",
    );
    expect(
      perpsGradingEntries.some(
        (e) => e.runId.startsWith("muse-") && e.previousVerdict === "fail" && e.verdict === "pass",
      ),
    ).toBe(true);
    expect(
      perpsGradingEntries.some(
        (e) => e.runId.startsWith("fable-") && e.previousVerdict === "pass" && e.verdict === "fail",
      ),
    ).toBe(true);
    expect(
      perpsGradingEntries.some(
        (e) => e.runId.startsWith("devin-") && e.previousVerdict === "fail" && e.verdict === "pass",
      ),
    ).toBe(true);
  });
  test("keeps every unreviewed attempt unchanged", () => {
    for (const run of originalCanonicalRuns.filter((r) => r.family === "Perps")) {
      const current = canonicalRuns.find((r) => r.runId === run.runId)!;
      if (
        run.attempts.availability !== "available" ||
        current.attempts.availability !== "available"
      )
        continue;
      for (const before of run.attempts.value) {
        if (
          perpsGradingEntries.some(
            (e) =>
              e.runId === run.runId &&
              e.caseId === before.caseId &&
              e.repetition === before.repetition,
          )
        )
          continue;
        expect(
          current.attempts.value.find(
            (a) => a.caseId === before.caseId && a.repetition === before.repetition,
          ),
        ).toEqual(before);
      }
      expect(current.counts.graded).toBe(run.counts.graded);
      expect(current.counts.passed + current.counts.failed).toBe(current.counts.graded);
    }
  });
});
