import { createHash } from "node:crypto";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import type { PublicEvalAttemptSummary } from "@askgina/contracts";
import {
  makePublicEvalResult,
  PublicEvalResultError,
  type PublicEvalAdapterOptions,
} from "../src/public-results";
import type { SanitizedEvalRunReport } from "../src/report";

const RUN_ID = "synthetic-result-run";
const CATALOG_SHA = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const PLAN_SHA = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
const STATUS_SHA = "1111111111111111111111111111111111111111111111111111111111111111";
const COMPONENT_SHA = "2222222222222222222222222222222222222222222222222222222222222222";

const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");
/** Saved files end in a newline; the adapter must hash exactly these bytes. */
const serialize = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
/** Attempt identity is the SHA-256 of the literal JSON tuple, independent of the adapter. */
const attemptId = (runId: string, caseId: string, repetition: number): string =>
  `attempt-${sha256(JSON.stringify([runId, caseId, repetition]))}`;

const attempt = (
  caseId: string,
  repetition: number,
  durationMs: number,
  tokenUsage: PublicEvalAttemptSummary["tokenUsage"],
  overrides: Partial<PublicEvalAttemptSummary> = {},
): PublicEvalAttemptSummary => ({
  id: attemptId(RUN_ID, caseId, repetition),
  runId: RUN_ID,
  caseId,
  repetition,
  verdict: "pass",
  validity: "valid",
  evidenceAvailability: "available",
  checks: {
    routing: "pass",
    arguments: "pass",
    safety: "not_applicable",
    completion: "pass",
    skillActivation: "not_applicable",
  },
  failureCategories: [],
  durationMs,
  tokenUsage,
  replacementOf: null,
  ...overrides,
});

const routingFailure = {
  verdict: "fail",
  checks: {
    routing: "fail",
    arguments: "pass",
    safety: "not_applicable",
    completion: "pass",
    skillActivation: "not_applicable",
  },
  failureCategories: ["routing_mismatch"],
} as const;

/** Two cases, two repetitions each: 3 of 4 pass, durations 5/7/6/8, tokens on one case only. */
const attempts = [
  attempt("exact-routing", 1, 5, { inputTokens: 3, outputTokens: 4, totalTokens: 9 }),
  attempt("exact-routing", 2, 7, { inputTokens: 2, outputTokens: 2, totalTokens: 4 }, routingFailure),
  attempt("argument-shape", 1, 6, null),
  attempt("argument-shape", 2, 8, null),
] as const;

const provenance = { suiteId: "synthetic-suite", suiteVersion: 1, fixtureVersion: 1, catalogSha: CATALOG_SHA };

const report: SanitizedEvalRunReport = {
  schemaVersion: "v1",
  runId: RUN_ID,
  candidate: "synthetic-candidate",
  target: "fixture",
  model: "synthetic-model",
  repetitions: 2,
  startedAt: "2026-08-25T00:00:00.000Z",
  cleanChat: true,
  accountClass: "synthetic",
  aggregate: {
    schemaVersion: "v1",
    ...provenance,
    overall: { passed: 3, total: 4 },
    dimensions: {
      routing: { passed: 3, failed: 1 },
      arguments: { passed: 4, failed: 0 },
      safety: { passed: 0, failed: 0 },
      completion: { passed: 4, failed: 0 },
    },
    skillActivation: { passed: 0, failed: 0 },
    latencyMs: { p50: 6, p95: 8, max: 8 },
    totalResultBytes: { p50: 0, p95: 0, max: 0 },
    tokenUsage: { observations: 2, inputTokens: 5, outputTokens: 6, totalTokens: 13 },
    artifactPolicy: "sanitized",
  },
};

const reportJson = serialize(report);

const captureJson = (
  sourceReportJson: string,
  captured: readonly PublicEvalAttemptSummary[] = attempts,
  runId: string = RUN_ID,
): string =>
  serialize({
    schemaVersion: "eval-attempts.v1",
    runId,
    sourceReportSha256: sha256(sourceReportJson),
    attempts: captured,
  });

const runSettings = { cleanChat: true, accountClass: "synthetic", repetitions: 2 } as const;
/** Synthetic digests stand for declared immutable records, not measured runtime attestation. */
const identity = {
  evaluatorSha256: COMPONENT_SHA,
  skillsSha256: COMPONENT_SHA,
  toolchainSha256: COMPONENT_SHA,
  runSettingsSha256: STATUS_SHA,
} as const;

const configurationJson = (overrides: Record<string, unknown> = {}): string =>
  serialize({
    schemaVersion: "eval-configuration.v1",
    candidate: "synthetic-candidate",
    model: "synthetic-model",
    target: "fixture",
    reasoning: null,
    suiteId: "synthetic-suite",
    suiteVersion: 1,
    fixtureVersion: 1,
    catalogSha: CATALOG_SHA,
    settings: { ...runSettings },
    identity: { ...identity },
    ...overrides,
  });

const options = (overrides: Partial<PublicEvalAdapterOptions> = {}): PublicEvalAdapterOptions => ({
  reportJson,
  resultId: "synthetic-result",
  dataOrigin: "synthetic",
  expectedProvenance: provenance,
  ...overrides,
});

const failureOf = (input: PublicEvalAdapterOptions, label?: string) =>
  Effect.gen(function* () {
    const result = yield* Effect.result(makePublicEvalResult(input));
    assert.strictEqual(result._tag, "Failure", label);
    if (result._tag === "Success") return assert.fail(label ?? "expected a failure");
    assert.instanceOf(result.failure, PublicEvalResultError, label);
    return result.failure;
  });

describe("public eval result adapter", () => {
  it.effect("retains repeated outcomes and source token totals with a pinned declaration", () =>
    Effect.gen(function* () {
      const attemptCaptureJson = captureJson(reportJson);
      const declaration = configurationJson();
      const result = yield* makePublicEvalResult(options({ attemptCaptureJson, configurationJson: declaration }));

      assert.deepStrictEqual(result.counts, {
        attempts: { total: 4, passed: 3, failed: 1 },
        cases: { total: 2, passedEveryAttempt: 1, failedAnyAttempt: 1 },
      });
      assert.deepStrictEqual(result.metrics.tokenUsage, {
        availability: "available", unit: "tokens", inputTokens: 5, outputTokens: 6, totalTokens: 13, sampleCount: 2,
      });
      assert.strictEqual(result.configuration.availability, "pinned");
      assert.strictEqual(result.configuration.pinnedSha256, sha256(declaration));
      assert.strictEqual(result.evidence.attemptDetail, "available");
      assert.deepStrictEqual(result.attempts, attempts);
    }),
  );

  it.effect("rejects a report whose provenance disagrees with the independent expectation", () =>
    Effect.gen(function* () {
      const failure = yield* failureOf(options({
        expectedProvenance: { ...provenance, catalogSha: PLAN_SHA },
      }));
      assert.strictEqual(failure.reason, "provenance_mismatch");

      const token = `ghp_${"A".repeat(24)}`;
      const malformed = yield* failureOf(options({
        expectedProvenance: { ...provenance, credential: token } as PublicEvalAdapterOptions["expectedProvenance"],
      }));
      assert.strictEqual(malformed.reason, "report_rejected");
      assert.notInclude(JSON.stringify(malformed), token);
      assert.notInclude(String(malformed), token);
    }),
  );

  it.effect("binds the companion to the exact report bytes", () =>
    Effect.gen(function* () {
      // Same JSON document, one byte shorter: the saved hash no longer names these bytes.
      const failure = yield* failureOf(options({
        reportJson: reportJson.slice(0, -1),
        attemptCaptureJson: captureJson(reportJson),
      }));
      assert.strictEqual(failure.reason, "attempt_capture_hash_mismatch");
    }),
  );

  it.effect("rejects a companion captured from another run", () =>
    Effect.gen(function* () {
      const otherRun = "synthetic-other-run";
      const foreign = attempts.map((entry) => ({
        ...entry,
        runId: otherRun,
        id: attemptId(otherRun, entry.caseId, entry.repetition),
      }));
      const failure = yield* failureOf(options({
        attemptCaptureJson: captureJson(reportJson, foreign, otherRun),
      }));
      assert.strictEqual(failure.reason, "attempt_capture_run_mismatch");
    }),
  );

  it.effect("rejects attempt slots that are misidentified, duplicated, missing or out of range", () =>
    Effect.gen(function* () {
      const [first, second, third, fourth] = attempts;
      const rows = [
        {
          name: "id hashed from another run's tuple",
          attempts: [first, second, third, { ...fourth, id: attemptId("synthetic-other-run", "argument-shape", 2) }],
          reason: "invalid_attempt_capture",
        },
        {
          name: "same slot captured twice",
          attempts: [first, second, third, third],
          reason: "invalid_attempt_capture",
        },
        {
          name: "one attempt absent",
          attempts: [first, second, third],
          reason: "attempt_capture_coverage_mismatch",
        },
        {
          name: "second repetition replaced by a third case",
          attempts: [first, second, third, attempt("third-case", 1, 8, null)],
          reason: "attempt_capture_coverage_mismatch",
        },
        {
          name: "repetition beyond the planned two",
          attempts: [first, second, third, attempt("exact-routing", 3, 8, null)],
          reason: "attempt_capture_coverage_mismatch",
        },
      ] as const;
      for (const row of rows) {
        const failure = yield* failureOf(
          options({ attemptCaptureJson: captureJson(reportJson, row.attempts) }),
          row.name,
        );
        assert.strictEqual(failure.reason, row.reason, row.name);
      }
    }),
  );

  it.effect("rejects a companion whose verdicts, checks, latency ranks or token sums disagree with the aggregate", () =>
    Effect.gen(function* () {
      const [first, second, third, fourth] = attempts;
      const rows = [
        {
          name: "one more pass than the aggregate",
          attempts: [first, attempt("exact-routing", 2, 7, second.tokenUsage), third, fourth],
        },
        {
          name: "failure moved from routing to arguments",
          attempts: [
            first,
            {
              ...second,
              checks: { ...second.checks, routing: "pass", arguments: "fail" },
              failureCategories: ["argument_mismatch"],
            },
            third,
            fourth,
          ],
        },
        {
          name: "slower maximum than the aggregate",
          attempts: [first, second, third, { ...fourth, durationMs: 9 }],
        },
        {
          name: "token total beyond the aggregate sum",
          attempts: [{ ...first, tokenUsage: { inputTokens: 3, outputTokens: 4, totalTokens: 10 } }, second, third, fourth],
        },
      ] as const;
      for (const row of rows) {
        const failure = yield* failureOf(
          options({ attemptCaptureJson: captureJson(reportJson, row.attempts) }),
          row.name,
        );
        assert.strictEqual(failure.reason, "attempt_capture_aggregate_mismatch", row.name);
      }
    }),
  );

  it.effect("fails with fixed reasons that never carry planted source values", () =>
    Effect.gen(function* () {
      const token = `ghp_${"A".repeat(24)}`;
      const address = `0x${"a".repeat(40)}`;
      const privateHost = "10.0.0.5";
      const apiKey = `sk-proj-${"b".repeat(24)}`;
      const rawField = "private-error-marker";
      const rows = [
        {
          name: "unknown raw field on the report",
          marker: rawField,
          input: options({ reportJson: serialize({ ...report, error: rawField }) }),
          reason: "invalid_report",
        },
        {
          name: "credential in a run label",
          marker: token,
          input: options({ reportJson: serialize({ ...report, model: token }) }),
          reason: "invalid_report",
        },
        {
          name: "address in a run label",
          marker: address,
          input: options({ reportJson: serialize({ ...report, candidate: address }) }),
          reason: "invalid_report",
        },
        {
          name: "private host in a run label",
          marker: privateHost,
          input: options({ reportJson: serialize({ ...report, target: privateHost }) }),
          reason: "invalid_report",
        },
        {
          name: "credential in a configuration setting",
          marker: apiKey,
          input: options({ configurationJson: configurationJson({ settings: { ...runSettings, accountClass: apiKey } }) }),
          reason: "invalid_configuration",
        },
        {
          name: "address in a configuration setting",
          marker: address,
          input: options({ configurationJson: configurationJson({ settings: { ...runSettings, accountClass: address } }) }),
          reason: "invalid_configuration",
        },
        {
          name: "private host in a configuration setting",
          marker: privateHost,
          input: options({ configurationJson: configurationJson({ settings: { ...runSettings, accountClass: privateHost } }) }),
          reason: "invalid_configuration",
        },
      ] as const;
      for (const row of rows) {
        const failure = yield* failureOf(row.input, row.name);
        assert.strictEqual(failure.reason, row.reason, row.name);
        assert.notInclude(JSON.stringify(failure), row.marker, row.name);
        assert.notInclude(String(failure), row.marker, row.name);
      }
    }),
  );

  it.effect("keeps unmeasured token and financial metrics unavailable and derives unique cases from repetitions", () =>
    Effect.gen(function* () {
      const untracked = {
        ...report,
        aggregate: {
          ...report.aggregate,
          tokenUsage: { observations: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        },
      };
      const result = yield* makePublicEvalResult(options({ reportJson: serialize(untracked) }));
      assert.deepStrictEqual(result.metrics.tokenUsage, { availability: "not_evaluated", reason: "not_captured" });
      assert.deepStrictEqual(result.metrics.usdCost, { availability: "not_evaluated", reason: "no_declared_method" });
      assert.deepStrictEqual(result.metrics.answerAccuracy, { availability: "not_evaluated", reason: "no_declared_method" });
      assert.deepStrictEqual(result.metrics.uncertainty, { availability: "not_evaluated", reason: "no_declared_method" });
      assert.deepStrictEqual(result.counts, {
        attempts: { total: 4, passed: 3, failed: 1 },
        cases: { total: 2, passedEveryAttempt: null, failedAnyAttempt: null },
      });
      assert.deepStrictEqual(result.coverage, {
        planSource: "run_manifest",
        planSha256: null,
        statusSha256: null,
        status: "complete",
        plannedCases: 2,
        plannedAttempts: 4,
      });
      assert.strictEqual(result.source.kind, "sanitized_aggregate");
      assert.strictEqual(result.source.attemptCaptureSha256, null);
      assert.strictEqual(result.evidence.attemptDetail, "aggregate_only");
      assert.strictEqual(result.attempts, null);
    }),
  );

  it.effect("validates a withheld companion fully and withholds only the retained detail", () =>
    Effect.gen(function* () {
      const result = yield* makePublicEvalResult(options({
        attemptCaptureJson: captureJson(reportJson),
        withholdAttempts: true,
      }));
      assert.strictEqual(result.evidence.attemptDetail, "withheld");
      assert.strictEqual(result.attempts, null);
      assert.strictEqual(result.source.kind, "sanitized_aggregate");
      assert.strictEqual(result.source.attemptCaptureSha256, null);
      assert.deepStrictEqual(result.counts.cases, { total: 2, passedEveryAttempt: null, failedAnyAttempt: null });
      assert.strictEqual(result.metrics.passRate.availability, "available");

      const [first, second, third, fourth] = attempts;
      const stale = yield* failureOf(options({
        attemptCaptureJson: captureJson(reportJson, [first, second, third, { ...fourth, durationMs: 9 }]),
        withholdAttempts: true,
      }));
      assert.strictEqual(stale.reason, "attempt_capture_aggregate_mismatch");

      const nothingToWithhold = yield* failureOf(options({ withholdAttempts: true }));
      assert.strictEqual(nothingToWithhold.reason, "withhold_without_attempts");
    }),
  );

  it.effect("withholds the headline while an authoritative plan is incomplete", () =>
    Effect.gen(function* () {
      const result = yield* makePublicEvalResult(options({
        attemptCaptureJson: captureJson(reportJson),
        declaredCoverage: { plannedCases: 3, plannedAttempts: 6, planSha256: PLAN_SHA, statusSha256: STATUS_SHA },
      }));
      assert.deepStrictEqual(result.coverage, {
        planSource: "declared_plan",
        planSha256: PLAN_SHA,
        statusSha256: STATUS_SHA,
        status: "incomplete",
        plannedCases: 3,
        plannedAttempts: 6,
      });
      assert.deepStrictEqual(result.metrics.passRate, { availability: "withheld", reason: "incomplete_coverage" });
      assert.deepStrictEqual(result.counts.cases, { total: 2, passedEveryAttempt: null, failedAnyAttempt: null });
      assert.strictEqual(result.metrics.latencyMs.availability, "available");
      assert.include(result.ranking.reasons, "incomplete_coverage");

      const contradictory = yield* failureOf(options({
        declaredCoverage: { plannedCases: 3, plannedAttempts: 5, planSha256: PLAN_SHA, statusSha256: STATUS_SHA },
      }));
      assert.strictEqual(contradictory.reason, "invalid_declared_coverage");
    }),
  );

  it.effect("pins only a declaration that matches the report and leaves the default labels_only", () =>
    Effect.gen(function* () {
      const mismatches = [
        { reasoning: "medium" },
        { settings: { ...runSettings, repetitions: 3 } },
        { suiteId: "other-suite" },
      ];
      for (const mismatch of mismatches) {
        const overstated = yield* failureOf(options({ configurationJson: configurationJson(mismatch) }));
        assert.strictEqual(overstated.reason, "configuration_mismatch", JSON.stringify(mismatch));
      }
      // JSON.stringify drops the undefined key, so that declaration omits identity entirely:
      // identical report labels without an immutable identity cannot become pinned.
      const malformedRows = [
        { settings: { ...runSettings, provider: "synthetic-provider" } },
        { identity: undefined },
        { identity: { ...identity, runSettingsSha256: "not_applicable" } },
      ];
      for (const malformed of malformedRows) {
        const unsupported = yield* failureOf(options({ configurationJson: configurationJson(malformed) }));
        assert.strictEqual(unsupported.reason, "invalid_configuration", JSON.stringify(malformed));
      }

      const result = yield* makePublicEvalResult(options());
      assert.strictEqual(result.configuration.availability, "labels_only");
      assert.strictEqual(result.configuration.pinnedSha256, null);
      assert.include(result.ranking.reasons, "missing_pinned_configuration");
    }),
  );
});
