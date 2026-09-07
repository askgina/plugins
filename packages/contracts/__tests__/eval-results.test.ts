import { createHash } from "node:crypto";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  type PublicEvalAttemptCapture,
  type PublicEvalAttemptSummary,
  type PublicEvalIndex,
  type PublicEvalPublication,
  type PublicEvalResult,
  decodePublicEvalAttemptCapture,
  decodePublicEvalIndex,
  decodePublicEvalPublication,
  decodePublicEvalResult,
} from "@askgina/contracts";

// All data, including approval records and measured labels, is test-only.
const SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const UNAVAILABLE = { availability: "not_evaluated", reason: "no_declared_method" } as const;
const attemptId = (runId: string, caseId: string): string =>
  `attempt-${createHash("sha256")
    .update(JSON.stringify([runId, caseId, 1]))
    .digest("hex")}`;

const PASS: PublicEvalAttemptSummary = {
  id: attemptId("synthetic-run", "case-one"),
  runId: "synthetic-run",
  caseId: "case-one",
  repetition: 1,
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
  durationMs: 10,
  tokenUsage: null,
  replacementOf: null,
};
const FAIL: PublicEvalAttemptSummary = {
  ...PASS,
  id: attemptId("synthetic-run", "case-two"),
  caseId: "case-two",
  verdict: "fail",
  checks: { ...PASS.checks, routing: "fail" },
  failureCategories: ["routing_mismatch"],
  durationMs: 20,
};
const CAPTURE: PublicEvalAttemptCapture = {
  schemaVersion: "eval-attempts.v1",
  runId: "synthetic-run",
  sourceReportSha256: SHA,
  attempts: [PASS, FAIL],
};

const RESULT: PublicEvalResult = {
  schemaVersion: "eval-result.v1",
  resultId: "synthetic-result",
  dataOrigin: "synthetic",
  measures: "conformance",
  run: { runId: "synthetic-run", startedAt: "2026-09-07T10:00:00Z" },
  source: {
    kind: "sanitized_aggregate",
    reportSchemaVersion: "v1",
    reportSha256: SHA,
    attemptCaptureSha256: null,
  },
  benchmark: {
    suiteId: "synthetic-suite",
    suiteVersion: 1,
    fixtureVersion: 1,
    catalogSha: SHA,
    target: "codex-cli",
    accountClass: "test-account",
    cleanChat: true,
    repetitions: 1,
  },
  configuration: {
    availability: "pinned",
    candidate: "synthetic-candidate",
    model: "synthetic-model",
    reasoning: null,
    pinnedSha256: SHA,
  },
  coverage: {
    planSource: "run_manifest",
    planSha256: null,
    statusSha256: null,
    status: "complete",
    plannedCases: 2,
    plannedAttempts: 2,
  },
  counts: {
    attempts: { total: 2, passed: 1, failed: 1 },
    cases: { total: 2, passedEveryAttempt: null, failedAnyAttempt: null },
  },
  dimensions: {
    routing: { passed: 1, failed: 1, notApplicable: 0 },
    arguments: { passed: 2, failed: 0, notApplicable: 0 },
    safety: { passed: 0, failed: 0, notApplicable: 2 },
    completion: { passed: 2, failed: 0, notApplicable: 0 },
    skillActivation: { passed: 0, failed: 0, notApplicable: 2 },
  },
  metrics: {
    passRate: {
      availability: "available",
      unit: "ratio",
      value: 0.5,
      numerator: 1,
      denominator: 2,
    },
    latencyMs: {
      availability: "available",
      unit: "milliseconds",
      p50: 10,
      p95: 20,
      max: 20,
      sampleCount: 2,
    },
    tokenUsage: { availability: "not_retained", reason: "not_captured" },
    answerAccuracy: UNAVAILABLE,
    usdCost: UNAVAILABLE,
    uncertainty: UNAVAILABLE,
  },
  evidence: { attemptDetail: "aggregate_only" },
  ranking: { status: "unranked", reasons: ["pilot", "synthetic"] },
  attempts: null,
};

const APPROVED_PUBLICATION: PublicEvalPublication = {
  schemaVersion: "eval-publication.v1",
  publicationId: "synthetic-publication",
  revisionId: "synthetic-r1",
  revision: 1,
  runId: "synthetic-run",
  dataOrigin: "measured",
  publishedAt: "2026-09-07T12:00:00Z",
  review: {
    status: "approved",
    method: "manual",
    approvedBy: "test-owner",
    approvedAt: "2026-09-07T11:00:00Z",
    subjectSha256: SHA,
    record: "Test-only approval fixture, not actual publication approval",
  },
  supersedes: null,
  content: {
    kind: "result",
    result: {
      ...RESULT,
      dataOrigin: "measured",
      ranking: { status: "unranked", reasons: ["pilot"] },
    },
  },
};

const REMOVED_REVISION = {
  revisionId: "synthetic-r1",
  revision: 1,
  kind: "result",
  state: "removed",
  publishedAt: "2026-09-07T12:00:00Z",
  path: null,
  sha256: null,
} as const;
const NOTICE_REVISION = {
  revisionId: "synthetic-r2",
  revision: 2,
  kind: "withdrawal_notice",
  state: "current",
  publishedAt: "2026-09-07T13:00:00Z",
  path: "synthetic/r2.json",
  sha256: SHA,
} as const;
const WITHDRAWN_ENTRY = {
  publicationId: "synthetic-publication",
  runId: "synthetic-run",
  review: { status: "synthetic_preview" },
  status: "withdrawn",
  currentRevisionId: "synthetic-r2",
  summary: null,
  revisions: [REMOVED_REVISION, NOTICE_REVISION],
} as const;
const INDEX: PublicEvalIndex = {
  schemaVersion: "eval-index.v1",
  dataOrigin: "synthetic",
  generatedAt: "2026-09-07T14:00:00Z",
  publications: [WITHDRAWN_ENTRY],
};

const rejected = <A, E>(decode: Effect.Effect<A, E>): Effect.Effect<void> =>
  Effect.map(Effect.result(decode), (result) => {
    assert.strictEqual(result._tag, "Failure");
  });

describe("@askgina/contracts public eval boundaries", () => {
  it.effect("rejects nested unknown fields at every strict decode boundary", () =>
    Effect.gen(function* () {
      yield* decodePublicEvalAttemptCapture(CAPTURE);
      yield* decodePublicEvalResult(RESULT);
      yield* decodePublicEvalPublication(APPROVED_PUBLICATION);
      yield* decodePublicEvalIndex(INDEX);

      yield* rejected(
        decodePublicEvalAttemptCapture({
          ...CAPTURE,
          attempts: [{ ...PASS, checks: { ...PASS.checks, privateDetail: "not public" } }, FAIL],
        }),
      );
      yield* rejected(
        decodePublicEvalResult({
          ...RESULT,
          source: { ...RESULT.source, rawReport: "not public" },
        }),
      );
      yield* rejected(
        decodePublicEvalPublication({
          ...APPROVED_PUBLICATION,
          review: { ...APPROVED_PUBLICATION.review, privateReviewerEmail: "owner@example.invalid" },
        }),
      );
      yield* rejected(
        decodePublicEvalIndex({
          ...INDEX,
          publications: [
            {
              ...WITHDRAWN_ENTRY,
              revisions: [
                REMOVED_REVISION,
                { ...NOTICE_REVISION, privateStoragePath: "not public" },
              ],
            },
          ],
        }),
      );
    }),
  );

  it.effect("rejects duplicate attempts and attempts belonging to another run", () =>
    Effect.gen(function* () {
      const foreign = {
        ...FAIL,
        runId: "another-run",
        id: attemptId("another-run", "case-two"),
      };
      yield* decodePublicEvalAttemptCapture(CAPTURE);
      yield* decodePublicEvalAttemptCapture({
        ...CAPTURE,
        runId: "another-run",
        attempts: [foreign],
      });
      yield* rejected(decodePublicEvalAttemptCapture({ ...CAPTURE, attempts: [PASS, FAIL, FAIL] }));
      yield* rejected(decodePublicEvalAttemptCapture({ ...CAPTURE, attempts: [PASS, foreign] }));
    }),
  );

  it.effect("rejects a unique attempt digest that does not match its identity tuple", () =>
    Effect.gen(function* () {
      const canonical = {
        ...PASS,
        id: "attempt-47248853d0c9c9edd394942e7268030ebe15b9b2bc03e7e18701457dbde8f1fd",
        runId: "synthetic-run-2026-09-07-001",
        caseId: "synthetic-case-01",
      };
      const capture = { ...CAPTURE, runId: canonical.runId, attempts: [canonical] };
      yield* decodePublicEvalAttemptCapture(capture);
      yield* rejected(
        decodePublicEvalAttemptCapture({
          ...capture,
          attempts: [{ ...canonical, id: `attempt-${SHA}` }],
        }),
      );
    }),
  );

  it.effect("requires failure categories to correspond to the failed checks", () =>
    Effect.gen(function* () {
      yield* decodePublicEvalAttemptCapture(CAPTURE);
      yield* rejected(
        decodePublicEvalAttemptCapture({
          ...CAPTURE,
          attempts: [PASS, { ...FAIL, failureCategories: ["argument_mismatch"] }],
        }),
      );
      yield* rejected(
        decodePublicEvalAttemptCapture({
          ...CAPTURE,
          attempts: [PASS, { ...FAIL, failureCategories: [] }],
        }),
      );
    }),
  );

  it.effect("does not expose a headline pass rate for incomplete coverage", () =>
    Effect.gen(function* () {
      const incomplete: PublicEvalResult = {
        ...RESULT,
        coverage: {
          planSource: "declared_plan",
          planSha256: SHA,
          statusSha256: SHA,
          status: "incomplete",
          plannedCases: 3,
          plannedAttempts: 3,
        },
        metrics: {
          ...RESULT.metrics,
          passRate: { availability: "not_evaluated", reason: "incomplete_coverage" },
        },
        ranking: { status: "unranked", reasons: ["pilot", "synthetic", "incomplete_coverage"] },
      };
      yield* decodePublicEvalResult(incomplete);
      yield* rejected(
        decodePublicEvalResult({
          ...incomplete,
          metrics: { ...incomplete.metrics, passRate: RESULT.metrics.passRate },
        }),
      );
    }),
  );

  it.effect("bounds aggregate failures by failed dimensions without double-counting overlaps", () =>
    Effect.gen(function* () {
      yield* decodePublicEvalResult(RESULT);
      // The same failed attempt can fail both routing and arguments.
      yield* decodePublicEvalResult({
        ...RESULT,
        dimensions: { ...RESULT.dimensions, arguments: { passed: 1, failed: 1, notApplicable: 0 } },
      });
      yield* rejected(
        decodePublicEvalResult({
          ...RESULT,
          dimensions: { ...RESULT.dimensions, routing: { passed: 0, failed: 2, notApplicable: 0 } },
        }),
      );
      yield* rejected(
        decodePublicEvalResult({
          ...RESULT,
          dimensions: { ...RESULT.dimensions, routing: { passed: 2, failed: 0, notApplicable: 0 } },
        }),
      );
    }),
  );

  it.effect("does not promote a synthetic result through measured manual approval", () =>
    Effect.gen(function* () {
      yield* decodePublicEvalPublication(APPROVED_PUBLICATION);
      yield* decodePublicEvalPublication({
        ...APPROVED_PUBLICATION,
        dataOrigin: "synthetic",
        review: { status: "synthetic_preview" },
        content: { kind: "result", result: RESULT },
      });
      yield* rejected(
        decodePublicEvalPublication({
          ...APPROVED_PUBLICATION,
          content: { kind: "result", result: RESULT },
        }),
      );
    }),
  );

  it.effect("removes references to result bytes when an index entry is withdrawn", () =>
    Effect.gen(function* () {
      yield* decodePublicEvalIndex(INDEX);
      const addressedResult = { ...REMOVED_REVISION, path: "synthetic/r1.json", sha256: SHA };
      yield* rejected(
        decodePublicEvalIndex({
          ...INDEX,
          publications: [
            {
              ...WITHDRAWN_ENTRY,
              revisions: [{ ...addressedResult, state: "superseded" }, NOTICE_REVISION],
            },
          ],
        }),
      );
      yield* rejected(
        decodePublicEvalIndex({
          ...INDEX,
          publications: [{ ...WITHDRAWN_ENTRY, revisions: [addressedResult, NOTICE_REVISION] }],
        }),
      );
    }),
  );
});
