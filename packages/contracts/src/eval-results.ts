import { createHash } from "node:crypto";
import { Function, Schema, type SchemaAST } from "effect";

/**
 * Public evaluation results contract (version one).
 *
 * These schemas describe the browser-safe JSON that the evaluator framework
 * exports: retained attempt summaries, one result per evaluated run, immutable
 * publication snapshots, and the index that names current revisions and
 * withdrawals. They carry conformance measurements only; they never carry raw
 * prompts, tool arguments, tool results, transcripts, account identifiers or
 * financial outcomes. Runtime validation happens in the framework/exporter;
 * consumers receive approved serialized data and may import the inferred types.
 */

const IDENTIFIER = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/u;
const MODEL_IDENTIFIER =
  /^[A-Za-z0-9](?:[A-Za-z0-9._:-]*[A-Za-z0-9])?(?:\/[A-Za-z0-9](?:[A-Za-z0-9._:-]*[A-Za-z0-9])?)*$/u;
const SHA_256 = /^[a-f0-9]{64}$/u;
const ATTEMPT_ID = /^attempt-[a-f0-9]{64}$/u;
const UTC_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{3})?Z$/u;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;
const SINGLE_LINE_TEXT = /^[^\p{Cc}]*$/u;
const SNAPSHOT_PATH =
  /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?(?:\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)*\.json$/u;
export const PUBLIC_EVAL_MAX_ATTEMPTS = 5000;
const MAX_PUBLICATIONS = 1000;

/**
 * Parse options every public-eval decode boundary must use. `Schema.Struct`
 * ignores unknown keys by default; strictness is a property of the decode call.
 */
export const PUBLIC_EVAL_DECODE_OPTIONS = {
  errors: "all",
  onExcessProperty: "error",
} as const satisfies SchemaAST.ParseOptions;

const NonNegativeIntSchema = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
);
const PositiveIntSchema = NonNegativeIntSchema.check(Schema.isGreaterThan(0));
const AttemptCountSchema = NonNegativeIntSchema.check(
  Schema.isLessThanOrEqualTo(PUBLIC_EVAL_MAX_ATTEMPTS),
);
const PlannedCountSchema = AttemptCountSchema.check(Schema.isGreaterThan(0));

export const PublicEvalIdentifierSchema = Schema.NonEmptyString.check(
  Schema.isMaxLength(128),
  Schema.isPattern(IDENTIFIER),
);
export const PublicEvalModelSchema = Schema.NonEmptyString.check(
  Schema.isMaxLength(128),
  Schema.isPattern(MODEL_IDENTIFIER),
);
export const PublicEvalSha256Schema = Schema.String.check(Schema.isPattern(SHA_256));
export const PublicEvalTimestampSchema = Schema.NonEmptyString.check(
  Schema.isMaxLength(64),
  Schema.isPattern(UTC_TIMESTAMP),
  Schema.makeFilter((value) => {
    const match = UTC_TIMESTAMP.exec(value);
    if (match === null || match[0].length !== value.length) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const leapDay =
      month === 2 && ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 1 : 0;
    const daysInMonth = DAYS_IN_MONTH[month - 1];
    return (
      daysInMonth !== undefined &&
      day >= 1 &&
      day <= daysInMonth + leapDay &&
      Number(match[4]) < 24 &&
      Number(match[5]) < 60 &&
      Number(match[6]) < 60
    );
  }),
);

/** Validated UTC timestamps are zero-padded, so padding the optional millisecond field makes string order chronological. */
const utcSortKey = (value: string): string =>
  value.length === 20 ? `${value.slice(0, 19)}.000Z` : value;
const PublicEvalNoteSchema = Schema.NonEmptyString.check(
  Schema.isMaxLength(500),
  Schema.isPattern(SINGLE_LINE_TEXT),
);
const PublicEvalSnapshotPathSchema = Schema.NonEmptyString.check(
  Schema.isMaxLength(256),
  Schema.isPattern(SNAPSHOT_PATH),
);

export const PUBLIC_EVAL_DATA_ORIGINS = ["synthetic", "measured"] as const;
export type PublicEvalDataOrigin = (typeof PUBLIC_EVAL_DATA_ORIGINS)[number];
const PublicEvalDataOriginSchema = Schema.Literals(PUBLIC_EVAL_DATA_ORIGINS);

export const PUBLIC_EVAL_EVIDENCE_AVAILABILITIES = [
  "available",
  "aggregate_only",
  "not_retained",
  "withheld",
  "not_evaluated",
  "not_applicable",
] as const;
export type PublicEvalEvidenceAvailability = (typeof PUBLIC_EVAL_EVIDENCE_AVAILABILITIES)[number];

// --- Attempt summaries -------------------------------------------------------

export const PUBLIC_EVAL_CHECK_NAMES = [
  "routing",
  "arguments",
  "safety",
  "completion",
  "skillActivation",
] as const;
export type PublicEvalCheckName = (typeof PUBLIC_EVAL_CHECK_NAMES)[number];

/** Required grader dimensions are always evaluated; safety and skill activation may be absent. */
const REQUIRED_CHECK_NAMES = ["routing", "arguments", "completion"] as const;

export const PUBLIC_EVAL_FAILURE_CATEGORY_BY_CHECK = {
  routing: "routing_mismatch",
  arguments: "argument_mismatch",
  safety: "safety_violation",
  completion: "trial_or_tool_failure",
  skillActivation: "skill_activation_mismatch",
} as const satisfies Record<PublicEvalCheckName, string>;

export const PUBLIC_EVAL_FAILURE_CATEGORIES = [
  "routing_mismatch",
  "argument_mismatch",
  "safety_violation",
  "trial_or_tool_failure",
  "skill_activation_mismatch",
] as const;
export type PublicEvalFailureCategory = (typeof PUBLIC_EVAL_FAILURE_CATEGORIES)[number];

export const PUBLIC_EVAL_CHECK_VERDICTS = ["pass", "fail", "not_applicable"] as const;
export type PublicEvalCheckVerdict = (typeof PUBLIC_EVAL_CHECK_VERDICTS)[number];

export const PublicEvalCheckVerdictSchema = Schema.Literals(PUBLIC_EVAL_CHECK_VERDICTS);
export const PublicEvalFailureCategorySchema = Schema.Literals(PUBLIC_EVAL_FAILURE_CATEGORIES);

export const PublicEvalAttemptChecksSchema = Schema.Struct({
  routing: PublicEvalCheckVerdictSchema,
  arguments: PublicEvalCheckVerdictSchema,
  safety: PublicEvalCheckVerdictSchema,
  completion: PublicEvalCheckVerdictSchema,
  skillActivation: PublicEvalCheckVerdictSchema,
});
export type PublicEvalAttemptChecks = typeof PublicEvalAttemptChecksSchema.Type;

export const PublicEvalTokenUsageSchema = Schema.Struct({
  inputTokens: NonNegativeIntSchema,
  outputTokens: NonNegativeIntSchema,
  totalTokens: NonNegativeIntSchema,
});
export type PublicEvalTokenUsage = typeof PublicEvalTokenUsageSchema.Type;

/**
 * The exact bytes (as a UTF-8 string) whose SHA-256 hex digest, prefixed with
 * `attempt-`, forms an attempt identity. A JSON tuple has no ambiguous delimiter.
 */
export const publicEvalAttemptIdentityInput = Function.dual<
  (caseId: string, repetition: number) => (runId: string) => string,
  (runId: string, caseId: string, repetition: number) => string
>(3, (runId, caseId, repetition) => JSON.stringify([runId, caseId, repetition]));

/** Failure categories are derived solely from failed checks, in check order. */
export const publicEvalFailureCategories = (
  checks: PublicEvalAttemptChecks,
): readonly PublicEvalFailureCategory[] => {
  const categories: PublicEvalFailureCategory[] = [];
  for (const name of PUBLIC_EVAL_CHECK_NAMES) {
    if (checks[name] === "fail") categories.push(PUBLIC_EVAL_FAILURE_CATEGORY_BY_CHECK[name]);
  }
  return categories;
};

export const PublicEvalAttemptSummarySchema = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(ATTEMPT_ID)),
  runId: PublicEvalIdentifierSchema,
  caseId: PublicEvalIdentifierSchema,
  repetition: PlannedCountSchema,
  verdict: Schema.Literals(["pass", "fail"]),
  validity: Schema.Literal("valid"),
  evidenceAvailability: Schema.Literal("available"),
  checks: PublicEvalAttemptChecksSchema,
  failureCategories: Schema.Array(PublicEvalFailureCategorySchema).check(
    Schema.isMaxLength(PUBLIC_EVAL_CHECK_NAMES.length),
  ),
  durationMs: NonNegativeIntSchema,
  tokenUsage: Schema.NullOr(PublicEvalTokenUsageSchema),
  replacementOf: Schema.Null,
}).check(
  Schema.makeFilter((attempt) => {
    const expected = publicEvalFailureCategories(attempt.checks);
    const issues: Schema.FilterIssue[] = [];
    const digest = createHash("sha256")
      .update(
        publicEvalAttemptIdentityInput(attempt.runId, attempt.caseId, attempt.repetition),
        "utf8",
      )
      .digest("hex");
    if (attempt.id !== `attempt-${digest}`) {
      issues.push({
        path: ["id"],
        issue: "attempt id must match its canonical run/case/repetition digest",
      });
    }
    if (
      attempt.failureCategories.length !== expected.length ||
      expected.some((category, index) => category !== attempt.failureCategories[index])
    ) {
      issues.push({
        path: ["failureCategories"],
        issue: "failureCategories must list exactly the categories of failed checks in check order",
      });
    }
    if ((attempt.verdict === "pass") !== (expected.length === 0)) {
      issues.push({ path: ["verdict"], issue: "verdict is pass exactly when no check failed" });
    }
    return issues;
  }),
);
export type PublicEvalAttemptSummary = typeof PublicEvalAttemptSummarySchema.Type;

const attemptIdentityIssues = (
  runId: string,
  attempts: readonly PublicEvalAttemptSummary[],
  path: readonly PropertyKey[],
): Schema.FilterIssue[] => {
  const issues: Schema.FilterIssue[] = [];
  const keys = new Set<string>();
  const ids = new Set<string>();
  attempts.forEach((attempt, index) => {
    const at = [...path, index];
    if (attempt.runId !== runId) {
      issues.push({ path: [...at, "runId"], issue: "attempt runId must match the run" });
    }
    const key = publicEvalAttemptIdentityInput(runId, attempt.caseId, attempt.repetition);
    if (keys.has(key)) {
      issues.push({ path: at, issue: "duplicate caseId and repetition" });
    }
    keys.add(key);
    if (ids.has(attempt.id)) {
      issues.push({ path: [...at, "id"], issue: "duplicate attempt id" });
    }
    ids.add(attempt.id);
  });
  return issues;
};

export const PublicEvalAttemptCaptureSchema = Schema.Struct({
  schemaVersion: Schema.Literal("eval-attempts.v1"),
  runId: PublicEvalIdentifierSchema,
  sourceReportSha256: PublicEvalSha256Schema,
  attempts: Schema.Array(PublicEvalAttemptSummarySchema).check(
    Schema.isMaxLength(PUBLIC_EVAL_MAX_ATTEMPTS),
  ),
}).check(
  Schema.makeFilter((capture) =>
    attemptIdentityIssues(capture.runId, capture.attempts, ["attempts"]),
  ),
);
export type PublicEvalAttemptCapture = typeof PublicEvalAttemptCaptureSchema.Type;

// --- Results -----------------------------------------------------------------

const PublicEvalMetricUnavailableSchema = Schema.Struct({
  availability: Schema.Literals(["not_evaluated", "not_applicable", "not_retained", "withheld"]),
  reason: Schema.Literals([
    "no_declared_method",
    "incomplete_coverage",
    "not_captured",
    "privacy_review",
  ]),
});

const PublicEvalPassRateSchema = Schema.Union([
  Schema.Struct({
    availability: Schema.Literal("available"),
    unit: Schema.Literal("ratio"),
    value: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
    numerator: NonNegativeIntSchema,
    denominator: PositiveIntSchema,
  }),
  PublicEvalMetricUnavailableSchema,
]);

const PublicEvalLatencySchema = Schema.Union([
  Schema.Struct({
    availability: Schema.Literal("available"),
    unit: Schema.Literal("milliseconds"),
    p50: NonNegativeIntSchema,
    p95: NonNegativeIntSchema,
    max: NonNegativeIntSchema,
    sampleCount: PlannedCountSchema,
  }),
  PublicEvalMetricUnavailableSchema,
]);

const PublicEvalTokenTotalsSchema = Schema.Union([
  Schema.Struct({
    availability: Schema.Literal("available"),
    unit: Schema.Literal("tokens"),
    inputTokens: NonNegativeIntSchema,
    outputTokens: NonNegativeIntSchema,
    totalTokens: NonNegativeIntSchema,
    sampleCount: PlannedCountSchema,
  }),
  PublicEvalMetricUnavailableSchema,
]);

const PublicEvalDimensionSummarySchema = Schema.Struct({
  passed: NonNegativeIntSchema,
  failed: NonNegativeIntSchema,
  notApplicable: NonNegativeIntSchema,
});

export const PUBLIC_EVAL_UNRANKED_REASONS = [
  "pilot",
  "synthetic",
  "incomplete_coverage",
  "missing_pinned_configuration",
] as const;
export type PublicEvalUnrankedReason = (typeof PUBLIC_EVAL_UNRANKED_REASONS)[number];

export const PublicEvalResultSchema = Schema.Struct({
  schemaVersion: Schema.Literal("eval-result.v1"),
  resultId: PublicEvalIdentifierSchema,
  dataOrigin: PublicEvalDataOriginSchema,
  measures: Schema.Literal("conformance"),
  run: Schema.Struct({
    runId: PublicEvalIdentifierSchema,
    startedAt: PublicEvalTimestampSchema,
  }),
  source: Schema.Struct({
    kind: Schema.Literals(["sanitized_aggregate", "sanitized_aggregate_with_attempts"]),
    reportSchemaVersion: Schema.Literal("v1"),
    reportSha256: PublicEvalSha256Schema,
    attemptCaptureSha256: Schema.NullOr(PublicEvalSha256Schema),
  }),
  benchmark: Schema.Struct({
    suiteId: PublicEvalIdentifierSchema,
    suiteVersion: PositiveIntSchema,
    fixtureVersion: PositiveIntSchema,
    catalogSha: PublicEvalSha256Schema,
    target: PublicEvalIdentifierSchema,
    accountClass: PublicEvalIdentifierSchema,
    cleanChat: Schema.Literal(true),
    repetitions: PlannedCountSchema,
  }),
  configuration: Schema.Struct({
    availability: Schema.Literals(["pinned", "labels_only"]),
    candidate: PublicEvalIdentifierSchema,
    model: PublicEvalModelSchema,
    reasoning: Schema.NullOr(PublicEvalIdentifierSchema),
    pinnedSha256: Schema.NullOr(PublicEvalSha256Schema),
  }),
  coverage: Schema.Struct({
    planSource: Schema.Literals(["run_manifest", "declared_plan"]),
    planSha256: Schema.NullOr(PublicEvalSha256Schema),
    statusSha256: Schema.NullOr(PublicEvalSha256Schema),
    status: Schema.Literals(["complete", "incomplete"]),
    plannedCases: PlannedCountSchema,
    plannedAttempts: PlannedCountSchema,
  }),
  counts: Schema.Struct({
    attempts: Schema.Struct({
      total: AttemptCountSchema,
      passed: AttemptCountSchema,
      failed: AttemptCountSchema,
    }),
    cases: Schema.Struct({
      total: AttemptCountSchema,
      passedEveryAttempt: Schema.NullOr(AttemptCountSchema),
      failedAnyAttempt: Schema.NullOr(AttemptCountSchema),
    }),
  }),
  dimensions: Schema.Struct({
    routing: PublicEvalDimensionSummarySchema,
    arguments: PublicEvalDimensionSummarySchema,
    safety: PublicEvalDimensionSummarySchema,
    completion: PublicEvalDimensionSummarySchema,
    skillActivation: PublicEvalDimensionSummarySchema,
  }),
  metrics: Schema.Struct({
    passRate: PublicEvalPassRateSchema,
    latencyMs: PublicEvalLatencySchema,
    tokenUsage: PublicEvalTokenTotalsSchema,
    answerAccuracy: PublicEvalMetricUnavailableSchema,
    usdCost: PublicEvalMetricUnavailableSchema,
    uncertainty: PublicEvalMetricUnavailableSchema,
  }),
  evidence: Schema.Struct({
    attemptDetail: Schema.Literals(PUBLIC_EVAL_EVIDENCE_AVAILABILITIES),
  }),
  ranking: Schema.Struct({
    status: Schema.Literal("unranked"),
    reasons: Schema.Array(Schema.Literals(PUBLIC_EVAL_UNRANKED_REASONS)).check(
      Schema.isLengthBetween(1, PUBLIC_EVAL_UNRANKED_REASONS.length),
    ),
  }),
  attempts: Schema.NullOr(
    Schema.Array(PublicEvalAttemptSummarySchema).check(
      Schema.isMaxLength(PUBLIC_EVAL_MAX_ATTEMPTS),
    ),
  ),
}).check(
  Schema.makeFilter((result) => {
    const issues: Schema.FilterIssue[] = [];
    const fail = (path: readonly PropertyKey[], issue: string): void => {
      issues.push({ path, issue });
    };
    const total = result.counts.attempts.total;
    const complete = total === result.coverage.plannedAttempts;
    const detailed = result.evidence.attemptDetail === "available";

    if (result.counts.attempts.passed + result.counts.attempts.failed !== total) {
      fail(["counts", "attempts"], "passed + failed must equal total");
    }
    if (
      result.coverage.plannedAttempts !==
      result.coverage.plannedCases * result.benchmark.repetitions
    ) {
      fail(["coverage", "plannedAttempts"], "must equal plannedCases * benchmark.repetitions");
    }
    if (total > result.coverage.plannedAttempts) {
      fail(["counts", "attempts", "total"], "cannot exceed coverage.plannedAttempts");
    }
    if ((result.coverage.status === "complete") !== complete) {
      fail(["coverage", "status"], "complete exactly when observed attempts equal plannedAttempts");
    }
    if (result.coverage.planSource === "run_manifest") {
      if (
        !complete ||
        result.coverage.planSha256 !== null ||
        result.coverage.statusSha256 !== null
      ) {
        fail(
          ["coverage"],
          "run_manifest requires complete sanitized coverage and null external plan/status hashes",
        );
      }
    } else if (result.coverage.planSha256 === null || result.coverage.statusSha256 === null) {
      fail(["coverage"], "declared_plan requires authoritative plan and status source hashes");
    }
    const caseTotal = result.counts.cases.total;
    if (
      caseTotal > result.coverage.plannedCases ||
      caseTotal > total ||
      caseTotal * result.benchmark.repetitions < total ||
      (complete && caseTotal !== result.coverage.plannedCases)
    ) {
      fail(
        ["counts", "cases", "total"],
        "unique cases must agree with coverage, observed attempts and repetitions",
      );
    }
    let failedChecks = 0;
    for (const name of PUBLIC_EVAL_CHECK_NAMES) {
      const dimension = result.dimensions[name];
      if (dimension.passed + dimension.failed + dimension.notApplicable !== total) {
        fail(
          ["dimensions", name],
          "passed + failed + notApplicable must equal counts.attempts.total",
        );
      }
      if (dimension.failed > result.counts.attempts.failed) {
        fail(["dimensions", name, "failed"], "cannot exceed failed attempts");
      }
      failedChecks += dimension.failed;
    }
    if (failedChecks < result.counts.attempts.failed) {
      fail(
        ["counts", "attempts", "failed"],
        "each failed attempt requires at least one failed check",
      );
    }
    for (const name of REQUIRED_CHECK_NAMES) {
      if (result.dimensions[name].notApplicable !== 0) {
        fail(
          ["dimensions", name, "notApplicable"],
          "required grader dimensions are always evaluated",
        );
      }
    }
    if (
      (result.configuration.availability === "pinned") !==
      (result.configuration.pinnedSha256 !== null)
    ) {
      fail(["configuration", "pinnedSha256"], "present exactly when the configuration is pinned");
    }

    const passRate = result.metrics.passRate;
    if (passRate.availability === "available") {
      if (!complete)
        fail(["metrics", "passRate"], "a headline pass rate requires complete coverage");
      if (passRate.numerator !== result.counts.attempts.passed || passRate.denominator !== total) {
        fail(
          ["metrics", "passRate"],
          "numerator and denominator must equal counts.attempts.passed and total",
        );
      } else if (passRate.value !== passRate.numerator / passRate.denominator) {
        fail(["metrics", "passRate", "value"], "value must equal numerator / denominator");
      }
    }
    const latency = result.metrics.latencyMs;
    if (latency.availability === "available") {
      if (latency.p50 > latency.p95 || latency.p95 > latency.max) {
        fail(["metrics", "latencyMs"], "must satisfy p50 <= p95 <= max");
      }
      if (latency.sampleCount !== total) {
        fail(["metrics", "latencyMs", "sampleCount"], "must equal counts.attempts.total");
      }
    }
    const tokens = result.metrics.tokenUsage;
    if (tokens.availability === "available" && tokens.sampleCount > total) {
      fail(["metrics", "tokenUsage", "sampleCount"], "cannot exceed counts.attempts.total");
    }

    if ((result.attempts !== null) !== detailed) {
      fail(["attempts"], "present exactly when evidence.attemptDetail is available");
    }
    if ((result.source.attemptCaptureSha256 !== null) !== detailed) {
      fail(
        ["source", "attemptCaptureSha256"],
        "present exactly when evidence.attemptDetail is available",
      );
    }
    if ((result.source.kind === "sanitized_aggregate_with_attempts") !== detailed) {
      fail(["source", "kind"], "source classification must agree with retained attempt detail");
    }
    const perCase = detailed && complete;
    const cases = result.counts.cases;
    if (!perCase && (cases.passedEveryAttempt !== null || cases.failedAnyAttempt !== null)) {
      fail(
        ["counts", "cases"],
        "per-case verdict counts require retained attempts and complete coverage",
      );
    }
    if (result.attempts !== null) {
      const attempts = result.attempts;
      issues.push(...attemptIdentityIssues(result.run.runId, attempts, ["attempts"]));
      if (attempts.length !== total) {
        fail(["attempts"], "attempt count must equal counts.attempts.total");
      }
      let passed = 0;
      let tokenSamples = 0;
      let inputTokens = 0;
      let outputTokens = 0;
      let totalTokens = 0;
      const verdicts: Record<PublicEvalCheckName, Record<PublicEvalCheckVerdict, number>> = {
        routing: { pass: 0, fail: 0, not_applicable: 0 },
        arguments: { pass: 0, fail: 0, not_applicable: 0 },
        safety: { pass: 0, fail: 0, not_applicable: 0 },
        completion: { pass: 0, fail: 0, not_applicable: 0 },
        skillActivation: { pass: 0, fail: 0, not_applicable: 0 },
      };
      const failedCases = new Set<string>();
      const caseIds = new Set<string>();
      for (const attempt of attempts) {
        if (attempt.repetition > result.benchmark.repetitions) {
          fail(["attempts"], "repetition cannot exceed benchmark.repetitions");
        }
        caseIds.add(attempt.caseId);
        if (attempt.verdict === "pass") passed += 1;
        else failedCases.add(attempt.caseId);
        for (const name of PUBLIC_EVAL_CHECK_NAMES) {
          verdicts[name][attempt.checks[name]] += 1;
        }
        if (attempt.tokenUsage !== null) {
          tokenSamples += 1;
          inputTokens += attempt.tokenUsage.inputTokens;
          outputTokens += attempt.tokenUsage.outputTokens;
          totalTokens += attempt.tokenUsage.totalTokens;
        }
      }
      if (passed !== result.counts.attempts.passed) {
        fail(
          ["counts", "attempts", "passed"],
          "must equal the number of retained attempts with verdict pass",
        );
      }
      for (const name of PUBLIC_EVAL_CHECK_NAMES) {
        const counter = verdicts[name];
        const dimension = result.dimensions[name];
        if (
          dimension.passed !== counter.pass ||
          dimension.failed !== counter.fail ||
          dimension.notApplicable !== counter.not_applicable
        ) {
          fail(["dimensions", name], "must equal the check verdict counts of retained attempts");
        }
      }
      if (caseIds.size !== cases.total) {
        fail(["counts", "cases", "total"], "must equal the distinct caseIds of retained attempts");
      }
      if (latency.availability === "available" && attempts.length > 0) {
        const durations = attempts
          .map((attempt) => attempt.durationMs)
          .sort((left, right) => left - right);
        if (
          latency.p50 !== durations[Math.ceil(0.5 * durations.length) - 1] ||
          latency.p95 !== durations[Math.ceil(0.95 * durations.length) - 1] ||
          latency.max !== durations[durations.length - 1]
        ) {
          fail(
            ["metrics", "latencyMs"],
            "must match retained attempt durations using nearest-rank percentiles",
          );
        }
      }
      if (
        tokens.availability === "available" &&
        (tokens.sampleCount !== tokenSamples ||
          tokens.inputTokens !== inputTokens ||
          tokens.outputTokens !== outputTokens ||
          tokens.totalTokens !== totalTokens)
      ) {
        fail(["metrics", "tokenUsage"], "must equal the token usage summed over retained attempts");
      }
      if (
        perCase &&
        (cases.failedAnyAttempt !== failedCases.size ||
          cases.passedEveryAttempt !== caseIds.size - failedCases.size)
      ) {
        fail(["counts", "cases"], "per-case verdict counts must be derived from retained attempts");
      }
    }

    const expectedReasons: PublicEvalUnrankedReason[] = ["pilot"];
    if (result.dataOrigin === "synthetic") expectedReasons.push("synthetic");
    if (!complete) expectedReasons.push("incomplete_coverage");
    if (result.configuration.availability !== "pinned") {
      expectedReasons.push("missing_pinned_configuration");
    }
    if (
      result.ranking.reasons.length !== expectedReasons.length ||
      expectedReasons.some((reason, index) => reason !== result.ranking.reasons[index])
    ) {
      fail(["ranking", "reasons"], `must be exactly ${expectedReasons.join(", ")}`);
    }
    return issues;
  }),
);
export type PublicEvalResult = typeof PublicEvalResultSchema.Type;

// --- Publications ------------------------------------------------------------

const PublicEvalReviewSchema = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("approved"),
    method: Schema.Literal("manual"),
    approvedBy: PublicEvalIdentifierSchema,
    approvedAt: PublicEvalTimestampSchema,
    subjectSha256: PublicEvalSha256Schema,
    record: PublicEvalNoteSchema,
  }),
  Schema.Struct({ status: Schema.Literal("synthetic_preview") }),
]);

const PublicEvalWithdrawalNoticeSchema = Schema.Struct({
  kind: Schema.Literal("withdrawal_notice"),
  reason: Schema.Literals(["privacy", "data_integrity", "owner_request"]),
  withdrawnAt: PublicEvalTimestampSchema,
  notice: PublicEvalNoteSchema,
});

export const PublicEvalPublicationSchema = Schema.Struct({
  schemaVersion: Schema.Literal("eval-publication.v1"),
  publicationId: PublicEvalIdentifierSchema,
  revisionId: PublicEvalIdentifierSchema,
  revision: PositiveIntSchema,
  runId: PublicEvalIdentifierSchema,
  dataOrigin: PublicEvalDataOriginSchema,
  publishedAt: PublicEvalTimestampSchema,
  review: PublicEvalReviewSchema,
  supersedes: Schema.NullOr(
    Schema.Struct({
      revisionId: PublicEvalIdentifierSchema,
      revision: PositiveIntSchema,
      reason: Schema.Literals(["correction", "withdrawal"]),
      summary: PublicEvalNoteSchema,
    }),
  ),
  content: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("result"), result: PublicEvalResultSchema }),
    PublicEvalWithdrawalNoticeSchema,
  ]),
}).check(
  Schema.makeFilter((publication) => {
    const issues: Schema.FilterIssue[] = [];
    const fail = (path: readonly PropertyKey[], issue: string): void => {
      issues.push({ path, issue });
    };
    if ((publication.dataOrigin === "measured") !== (publication.review.status === "approved")) {
      fail(
        ["review"],
        "measured publications require a recorded manual approval; synthetic ones are previews",
      );
    }
    if (
      publication.review.status === "approved" &&
      utcSortKey(publication.review.approvedAt) > utcSortKey(publication.publishedAt)
    ) {
      fail(["review", "approvedAt"], "approval must precede publication");
    }
    if (
      publication.content.kind === "withdrawal_notice" &&
      utcSortKey(publication.content.withdrawnAt) > utcSortKey(publication.publishedAt)
    ) {
      fail(["content", "withdrawnAt"], "withdrawal must precede the published notice");
    }
    const supersedes = publication.supersedes;
    if ((publication.revision === 1) !== (supersedes === null)) {
      fail(["supersedes"], "revision 1 supersedes nothing; later revisions name their predecessor");
    }
    if (supersedes !== null) {
      if (supersedes.revision !== publication.revision - 1) {
        fail(["supersedes", "revision"], "must be the immediately preceding revision");
      }
      if (supersedes.revisionId === publication.revisionId) {
        fail(["supersedes", "revisionId"], "cannot supersede itself");
      }
      const expectedReason =
        publication.content.kind === "withdrawal_notice" ? "withdrawal" : "correction";
      if (supersedes.reason !== expectedReason) {
        fail(["supersedes", "reason"], `must be ${expectedReason} for this content kind`);
      }
    } else if (publication.content.kind === "withdrawal_notice") {
      fail(["content"], "a withdrawal notice replaces a previously published revision");
    }
    if (publication.content.kind === "result") {
      const result = publication.content.result;
      if (result.run.runId !== publication.runId) {
        fail(["content", "result", "run", "runId"], "must match the publication runId");
      }
      if (result.dataOrigin !== publication.dataOrigin) {
        fail(["content", "result", "dataOrigin"], "must match the publication dataOrigin");
      }
    }
    return issues;
  }),
);
export type PublicEvalPublication = typeof PublicEvalPublicationSchema.Type;

// --- Index -------------------------------------------------------------------

const PublicEvalIndexRevisionSchema = Schema.Struct({
  revisionId: PublicEvalIdentifierSchema,
  revision: PositiveIntSchema,
  kind: Schema.Literals(["result", "withdrawal_notice"]),
  state: Schema.Literals(["current", "superseded", "removed"]),
  publishedAt: PublicEvalTimestampSchema,
  path: Schema.NullOr(PublicEvalSnapshotPathSchema),
  sha256: Schema.NullOr(PublicEvalSha256Schema),
});

const PublicEvalIndexEntrySchema = Schema.Struct({
  publicationId: PublicEvalIdentifierSchema,
  runId: PublicEvalIdentifierSchema,
  review: PublicEvalReviewSchema,
  status: Schema.Literals(["current", "withdrawn"]),
  currentRevisionId: PublicEvalIdentifierSchema,
  summary: Schema.NullOr(
    Schema.Struct({
      suiteId: PublicEvalIdentifierSchema,
      candidate: PublicEvalIdentifierSchema,
      model: PublicEvalModelSchema,
      startedAt: PublicEvalTimestampSchema,
    }),
  ),
  revisions: Schema.Array(PublicEvalIndexRevisionSchema).check(Schema.isMinLength(1)),
});

export const PublicEvalIndexSchema = Schema.Struct({
  schemaVersion: Schema.Literal("eval-index.v1"),
  dataOrigin: PublicEvalDataOriginSchema,
  generatedAt: PublicEvalTimestampSchema,
  publications: Schema.Array(PublicEvalIndexEntrySchema).check(
    Schema.isMaxLength(MAX_PUBLICATIONS),
  ),
}).check(
  Schema.makeFilter((index) => {
    const issues: Schema.FilterIssue[] = [];
    const fail = (path: readonly PropertyKey[], issue: string): void => {
      issues.push({ path, issue });
    };
    const publicationIds = new Set<string>();
    const revisionIds = new Set<string>();
    const paths = new Set<string>();
    index.publications.forEach((entry, entryIndex) => {
      const at: PropertyKey[] = ["publications", entryIndex];
      const publicationIdKey = entry.publicationId.toLowerCase();
      if (publicationIds.has(publicationIdKey)) {
        fail([...at, "publicationId"], "duplicate publicationId ignoring case");
      }
      publicationIds.add(publicationIdKey);
      if ((index.dataOrigin === "measured") !== (entry.review.status === "approved")) {
        fail(
          [...at, "review"],
          "measured entries require manual approval; synthetic entries are previews",
        );
      }
      if ((entry.summary !== null) !== (entry.status === "current")) {
        fail([...at, "summary"], "present exactly when the publication is current");
      }
      const last = entry.revisions[entry.revisions.length - 1];
      let withdrawn = false;
      entry.revisions.forEach((revision, revisionIndex) => {
        const here = [...at, "revisions", revisionIndex];
        if (revision.revision !== revisionIndex + 1) {
          fail([...here, "revision"], "revisions are numbered contiguously from 1");
        }
        const revisionIdKey = revision.revisionId.toLowerCase();
        if (revisionIds.has(revisionIdKey)) {
          fail([...here, "revisionId"], "duplicate revisionId ignoring case");
        }
        revisionIds.add(revisionIdKey);
        const removed = revision.state === "removed";
        if ((revision.path === null) !== removed || (revision.sha256 === null) !== removed) {
          fail(here, "path and sha256 are null exactly when the revision bytes were removed");
        }
        if (revision.path !== null) {
          if (paths.has(revision.path)) fail([...here, "path"], "duplicate snapshot path");
          paths.add(revision.path);
        }
        if ((revision.state === "current") !== (revision === last)) {
          fail([...here, "state"], "only the last revision is current");
        }
        if (revision.kind === "withdrawal_notice" && revision.revision === 1) {
          fail([...here, "kind"], "a withdrawal notice replaces a previously published revision");
        }
        if (withdrawn && revision.kind === "result") {
          fail([...here, "kind"], "version one does not restore withdrawn results");
        }
        withdrawn ||= revision.kind === "withdrawal_notice";
        if (entry.status === "current" && removed) {
          fail(
            [...here, "state"],
            "corrected revisions stay reachable; only withdrawals remove bytes",
          );
        }
        if (entry.status === "withdrawn" && revision.kind === "result" && !removed) {
          fail([...here, "state"], "withdrawn result revisions must have their bytes removed");
        }
      });
      if (last !== undefined) {
        if (last.revisionId !== entry.currentRevisionId) {
          fail([...at, "currentRevisionId"], "must name the last revision");
        }
        const expectedKind = entry.status === "withdrawn" ? "withdrawal_notice" : "result";
        if (last.kind !== expectedKind) {
          fail([...at, "revisions", entry.revisions.length - 1, "kind"], `must be ${expectedKind}`);
        }
      }
    });
    return issues;
  }),
);
export type PublicEvalIndex = typeof PublicEvalIndexSchema.Type;

// --- Strict decode boundaries -------------------------------------------------

const decodeAttemptCapture = Schema.decodeUnknownEffect(
  PublicEvalAttemptCaptureSchema,
  PUBLIC_EVAL_DECODE_OPTIONS,
);
const decodeResult = Schema.decodeUnknownEffect(PublicEvalResultSchema, PUBLIC_EVAL_DECODE_OPTIONS);
const decodePublication = Schema.decodeUnknownEffect(
  PublicEvalPublicationSchema,
  PUBLIC_EVAL_DECODE_OPTIONS,
);
const decodeIndex = Schema.decodeUnknownEffect(PublicEvalIndexSchema, PUBLIC_EVAL_DECODE_OPTIONS);

export const decodePublicEvalAttemptCapture = (input: unknown) => decodeAttemptCapture(input);
export const decodePublicEvalResult = (input: unknown) => decodeResult(input);
export const decodePublicEvalPublication = (input: unknown) => decodePublication(input);
export const decodePublicEvalIndex = (input: unknown) => decodeIndex(input);
