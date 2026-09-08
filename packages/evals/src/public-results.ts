import { createHash } from "node:crypto";

import {
  PUBLIC_EVAL_DECODE_OPTIONS,
  PublicEvalAttemptCaptureSchema,
  PublicEvalIdentifierSchema,
  PublicEvalSha256Schema,
  PublicEvalTimestampSchema,
  decodePublicEvalResult,
  publicEvalAttemptIdentityInput,
  type PublicEvalAttemptSummary,
  type PublicEvalCheckName,
  type PublicEvalDataOrigin,
  type PublicEvalResult,
  type PublicEvalUnrankedReason,
} from "@askgina/contracts";
import { Data, Effect, Schema } from "effect";

import { SanitizedEvalRunReportSchema, type SanitizedEvalRunReport } from "./report";
import {
  hasSafePublicEvalFields,
  isSafePublicEvalText,
  sanitizeEvalAggregate,
  type SanitizedEvalAggregate,
  type SanitizedEvalAggregateProvenance,
} from "./sanitize";

/**
 * Projects a saved sanitized aggregate report and optional companions onto
 * `eval-result.v1`. No grading, discarded-detail reconstruction or filesystem
 * access occurs here. Hashes bind exact input text; they do not approve publication.
 */

export interface PublicEvalAdapterOptions {
  /** Exact UTF-8 text of the saved sanitized aggregate report, including any trailing newline. */
  readonly reportJson: string;
  readonly resultId: string;
  readonly dataOrigin: PublicEvalDataOrigin;
  /** Independently supplied provenance the report must match; never read from the report itself. */
  readonly expectedProvenance: SanitizedEvalAggregateProvenance;
  /** Exact UTF-8 text of an `eval-attempts.v1` companion bound to `reportJson`. */
  readonly attemptCaptureJson?: string;
  /** Exact UTF-8 text of an `eval-configuration.v1` declaration; see `PublicEvalConfigurationSchema`. */
  readonly configurationJson?: string;
  /** Authoritative cohort plan and status; without it the run manifest is the plan. */
  readonly declaredCoverage?: {
    readonly plannedCases: number;
    readonly plannedAttempts: number;
    readonly planSha256: string;
    readonly statusSha256: string;
  };
  /** Publish aggregate-only detail although a capture was supplied; requires `attemptCaptureJson`. */
  readonly withholdAttempts?: boolean;
}

type PublicEvalResultErrorReason =
  | "invalid_result_id"
  | "invalid_report"
  | "provenance_mismatch"
  | "report_rejected"
  | "no_observations"
  | "repetition_mismatch"
  | "invalid_attempt_capture"
  | "attempt_capture_hash_mismatch"
  | "attempt_capture_run_mismatch"
  | "attempt_capture_coverage_mismatch"
  | "attempt_capture_aggregate_mismatch"
  | "withhold_without_attempts"
  | "invalid_configuration"
  | "configuration_mismatch"
  | "invalid_declared_coverage"
  | "invalid_result";

/** A fixed reason code only: never source text, labels, or schema issue messages. */
export class PublicEvalResultError extends Data.TaggedError("PublicEvalResultError")<{
  readonly reason: PublicEvalResultErrorReason;
}> {}

const PositiveIntSchema = Schema.Int.check(Schema.isGreaterThan(0));

/**
 * `eval-configuration.v1`: an independently declared, public-safe system
 * configuration. `candidate`, `model`, `target` and `reasoning` must equal the
 * sanitized report labels. `suiteId`, `suiteVersion`, `fixtureVersion` and
 * `catalogSha` must all equal the independently supplied expected provenance.
 * `settings` requires `cleanChat: true`, `accountClass` and `repetitions`,
 * each matching the report. Every `identity` field is a SHA-256 digest of an
 * immutable component or run-settings record. A component record may declare
 * that it is not applicable, but its digest is still required. Labels alone
 * never pin, and the adapter does not fetch or attest the referenced records.
 * Unknown keys are rejected. Matching declarations do not attest that the
 * configuration ran or establish the provider's actual identity.
 * The exact declaration text is hashed into `configuration.pinnedSha256`.
 */
const PublicEvalConfigurationSchema = Schema.Struct({
  schemaVersion: Schema.Literal("eval-configuration.v1"),
  candidate: PublicEvalIdentifierSchema,
  model: PublicEvalIdentifierSchema,
  target: PublicEvalIdentifierSchema,
  reasoning: Schema.NullOr(PublicEvalIdentifierSchema),
  suiteId: PublicEvalIdentifierSchema,
  suiteVersion: PositiveIntSchema,
  fixtureVersion: PositiveIntSchema,
  catalogSha: PublicEvalSha256Schema,
  settings: Schema.Struct({
    cleanChat: Schema.Literal(true),
    accountClass: PublicEvalIdentifierSchema,
    repetitions: PositiveIntSchema,
  }),
  identity: Schema.Struct({
    evaluatorSha256: PublicEvalSha256Schema,
    skillsSha256: PublicEvalSha256Schema,
    toolchainSha256: PublicEvalSha256Schema,
    runSettingsSha256: PublicEvalSha256Schema,
  }),
});

const DeclaredCoverageSchema = Schema.Struct({
  plannedCases: PositiveIntSchema,
  plannedAttempts: PositiveIntSchema,
  planSha256: PublicEvalSha256Schema,
  statusSha256: PublicEvalSha256Schema,
});

const decodeResultId = Schema.decodeUnknownEffect(PublicEvalIdentifierSchema);
const decodeStartedAt = Schema.decodeUnknownEffect(PublicEvalTimestampSchema);
const decodeReport = Schema.decodeUnknownEffect(
  Schema.fromJsonString(SanitizedEvalRunReportSchema),
  PUBLIC_EVAL_DECODE_OPTIONS,
);
const decodeCapture = Schema.decodeUnknownEffect(
  Schema.fromJsonString(PublicEvalAttemptCaptureSchema),
  PUBLIC_EVAL_DECODE_OPTIONS,
);
const decodeConfiguration = Schema.decodeUnknownEffect(
  Schema.fromJsonString(PublicEvalConfigurationSchema),
  PUBLIC_EVAL_DECODE_OPTIONS,
);
const decodeDeclaredCoverage = Schema.decodeUnknownEffect(
  DeclaredCoverageSchema,
  PUBLIC_EVAL_DECODE_OPTIONS,
);

const failure = (reason: PublicEvalResultErrorReason) => new PublicEvalResultError({ reason });
const sha256Hex = (content: string): string =>
  createHash("sha256").update(content, "utf8").digest("hex");

/** Complements the strict capture decoder with report-bound identities and full repeated slots. */
const attemptIssue = (
  attempts: readonly PublicEvalAttemptSummary[],
  report: SanitizedEvalRunReport,
  aggregate: SanitizedEvalAggregate,
  caseTotal: number,
): PublicEvalResultErrorReason | null => {
  if (attempts.length !== aggregate.overall.total) return "attempt_capture_coverage_mismatch";
  const slotsByCase = new Map<string, number>();
  let tokenSamples = 0;
  for (const attempt of attempts) {
    const identity = publicEvalAttemptIdentityInput(
      report.runId,
      attempt.caseId,
      attempt.repetition,
    );
    if (attempt.id !== `attempt-${sha256Hex(identity)}` || !isSafePublicEvalText(attempt.caseId)) {
      return "invalid_attempt_capture";
    }
    if (attempt.repetition > report.repetitions) return "attempt_capture_coverage_mismatch";
    // The strict capture decoder already rejects duplicate slots and nonpositive repetitions.
    slotsByCase.set(attempt.caseId, (slotsByCase.get(attempt.caseId) ?? 0) + 1);
    if (attempt.tokenUsage !== null) tokenSamples += 1;
  }
  if (slotsByCase.size !== caseTotal) return "attempt_capture_coverage_mismatch";
  for (const slots of slotsByCase.values()) {
    if (slots !== report.repetitions) return "attempt_capture_coverage_mismatch";
  }
  // The result decoder checks token sums when available; check samples even when unavailable.
  if (tokenSamples !== aggregate.tokenUsage.observations)
    return "attempt_capture_aggregate_mismatch";
  return null;
};

const configurationIssue = (
  declared: typeof PublicEvalConfigurationSchema.Type,
  report: SanitizedEvalRunReport,
  expected: SanitizedEvalAggregateProvenance,
): PublicEvalResultErrorReason | null => {
  if (!hasSafePublicEvalFields(declared)) return "invalid_configuration";
  const settings = declared.settings;
  if (
    declared.candidate !== report.candidate ||
    declared.model !== report.model ||
    declared.target !== report.target ||
    declared.reasoning !== (report.reasoning ?? null) ||
    declared.suiteId !== expected.suiteId ||
    declared.suiteVersion !== expected.suiteVersion ||
    declared.fixtureVersion !== expected.fixtureVersion ||
    declared.catalogSha !== expected.catalogSha ||
    settings.cleanChat !== report.cleanChat ||
    settings.accountClass !== report.accountClass ||
    settings.repetitions !== report.repetitions
  ) {
    return "configuration_mismatch";
  }
  return null;
};

/**
 * Builds a public result from exact source text.
 *
 * Metadata rules: `source.*Sha256` are SHA-256 digests of the exact input text;
 * provenance is pinned from `expectedProvenance` through the existing
 * sanitizer, never trusted from the report; `counts.cases.total` is
 * `aggregate.overall.total / repetitions`, which the complete-run gate makes
 * exact (every case ran every repetition), so observations are never counted as
 * unique tasks; coverage follows the run manifest unless an authoritative
 * declared plan is supplied, and an incomplete plan withholds the headline pass
 * rate; retained attempt detail requires a companion that reproduces the
 * aggregate, and withholding it is explicit; configuration is `labels_only`
 * unless an independent matching declaration is pinned by content hash; answer
 * accuracy, USD cost and uncertainty have no declared method; every result is
 * an unranked pilot. The output must pass the shared strict decoder.
 */
export const makePublicEvalResult = (
  options: PublicEvalAdapterOptions,
): Effect.Effect<PublicEvalResult, PublicEvalResultError> =>
  Effect.gen(function* () {
    const resultId = yield* decodeResultId(options.resultId).pipe(
      Effect.mapError(() => failure("invalid_result_id")),
    );
    if (!isSafePublicEvalText(resultId)) return yield* failure("invalid_result_id");
    if (options.withholdAttempts === true && options.attemptCaptureJson === undefined) {
      return yield* failure("withhold_without_attempts");
    }

    const report = yield* decodeReport(options.reportJson).pipe(
      Effect.mapError(() => failure("invalid_report")),
    );
    const reportSha256 = sha256Hex(options.reportJson);
    if (!hasSafePublicEvalFields(report)) return yield* failure("invalid_report");
    yield* decodeStartedAt(report.startedAt).pipe(Effect.mapError(() => failure("invalid_report")));

    const expected = options.expectedProvenance;
    const aggregate = yield* sanitizeEvalAggregate(report.aggregate, expected).pipe(
      Effect.mapError(() =>
        failure(
          report.aggregate.suiteId !== expected?.suiteId ||
            report.aggregate.suiteVersion !== expected?.suiteVersion ||
            report.aggregate.fixtureVersion !== expected?.fixtureVersion ||
            report.aggregate.catalogSha !== expected?.catalogSha
            ? "provenance_mismatch"
            : "report_rejected",
        ),
      ),
    );
    const sourceTokens = aggregate.tokenUsage;
    if (
      sourceTokens.observations === 0 &&
      (sourceTokens.inputTokens !== 0 ||
        sourceTokens.outputTokens !== 0 ||
        sourceTokens.totalTokens !== 0)
    ) {
      return yield* failure("invalid_report");
    }
    const total = aggregate.overall.total;
    if (total === 0) return yield* failure("no_observations");
    if (total % report.repetitions !== 0) return yield* failure("repetition_mismatch");
    const caseTotal = total / report.repetitions;

    let coverage: PublicEvalResult["coverage"] = {
      planSource: "run_manifest",
      planSha256: null,
      statusSha256: null,
      status: "complete",
      plannedCases: caseTotal,
      plannedAttempts: total,
    };
    if (options.declaredCoverage !== undefined) {
      const declared = yield* decodeDeclaredCoverage(options.declaredCoverage).pipe(
        Effect.mapError(() => failure("invalid_declared_coverage")),
      );
      if (
        declared.plannedAttempts !== declared.plannedCases * report.repetitions ||
        declared.plannedAttempts < total
      ) {
        return yield* failure("invalid_declared_coverage");
      }
      coverage = {
        planSource: "declared_plan",
        planSha256: declared.planSha256,
        statusSha256: declared.statusSha256,
        status: declared.plannedAttempts === total ? "complete" : "incomplete",
        plannedCases: declared.plannedCases,
        plannedAttempts: declared.plannedAttempts,
      };
    }
    const complete = coverage.status === "complete";

    let attempts: readonly PublicEvalAttemptSummary[] | null = null;
    if (options.attemptCaptureJson !== undefined) {
      const capture = yield* decodeCapture(options.attemptCaptureJson).pipe(
        Effect.mapError(() => failure("invalid_attempt_capture")),
      );
      if (capture.sourceReportSha256 !== reportSha256) {
        return yield* failure("attempt_capture_hash_mismatch");
      }
      if (capture.runId !== report.runId) return yield* failure("attempt_capture_run_mismatch");
      const issue = attemptIssue(capture.attempts, report, aggregate, caseTotal);
      if (issue !== null) return yield* failure(issue);
      attempts = capture.attempts;
    }

    let configuration: PublicEvalResult["configuration"] = {
      availability: "labels_only",
      candidate: report.candidate,
      model: report.model,
      reasoning: report.reasoning ?? null,
      pinnedSha256: null,
    };
    if (options.configurationJson !== undefined) {
      const declared = yield* decodeConfiguration(options.configurationJson).pipe(
        Effect.mapError(() => failure("invalid_configuration")),
      );
      const issue = configurationIssue(declared, report, expected);
      if (issue !== null) return yield* failure(issue);
      configuration = {
        availability: "pinned",
        candidate: report.candidate,
        model: report.model,
        reasoning: report.reasoning ?? null,
        pinnedSha256: sha256Hex(options.configurationJson),
      };
    }

    let passedEveryAttempt: number | null = null;
    let failedAnyAttempt: number | null = null;
    if (attempts !== null && complete) {
      const failedCases = new Set<string>();
      for (const attempt of attempts) {
        if (attempt.verdict === "fail") failedCases.add(attempt.caseId);
      }
      failedAnyAttempt = failedCases.size;
      passedEveryAttempt = caseTotal - failedCases.size;
    }

    const dimension = (
      name: PublicEvalCheckName,
    ): PublicEvalResult["dimensions"][PublicEvalCheckName] => {
      const source =
        name === "skillActivation" ? aggregate.skillActivation : aggregate.dimensions[name];
      return {
        passed: source.passed,
        failed: source.failed,
        notApplicable: total - source.passed - source.failed,
      };
    };
    const noDeclaredMethod = {
      availability: "not_evaluated",
      reason: "no_declared_method",
    } as const;
    const reasons: PublicEvalUnrankedReason[] = ["pilot"];
    if (options.dataOrigin === "synthetic") reasons.push("synthetic");
    if (!complete) reasons.push("incomplete_coverage");
    if (configuration.availability !== "pinned") reasons.push("missing_pinned_configuration");

    const candidate: PublicEvalResult = {
      schemaVersion: "eval-result.v1",
      resultId,
      dataOrigin: options.dataOrigin,
      measures: "conformance",
      run: { runId: report.runId, startedAt: report.startedAt },
      source: {
        kind: attempts === null ? "sanitized_aggregate" : "sanitized_aggregate_with_attempts",
        reportSchemaVersion: "v1",
        reportSha256,
        attemptCaptureSha256:
          attempts === null || options.attemptCaptureJson === undefined
            ? null
            : sha256Hex(options.attemptCaptureJson),
      },
      benchmark: {
        suiteId: aggregate.suiteId,
        suiteVersion: aggregate.suiteVersion,
        fixtureVersion: aggregate.fixtureVersion,
        catalogSha: aggregate.catalogSha,
        target: report.target,
        accountClass: report.accountClass,
        cleanChat: true,
        repetitions: report.repetitions,
      },
      configuration,
      coverage,
      counts: {
        attempts: {
          total,
          passed: aggregate.overall.passed,
          failed: total - aggregate.overall.passed,
        },
        cases: { total: caseTotal, passedEveryAttempt, failedAnyAttempt },
      },
      dimensions: {
        routing: dimension("routing"),
        arguments: dimension("arguments"),
        safety: dimension("safety"),
        completion: dimension("completion"),
        skillActivation: dimension("skillActivation"),
      },
      metrics: {
        passRate: complete
          ? {
              availability: "available",
              unit: "ratio",
              value: aggregate.overall.passed / total,
              numerator: aggregate.overall.passed,
              denominator: total,
            }
          : { availability: "withheld", reason: "incomplete_coverage" },
        latencyMs: {
          availability: "available",
          unit: "milliseconds",
          p50: aggregate.latencyMs.p50,
          p95: aggregate.latencyMs.p95,
          max: aggregate.latencyMs.max,
          sampleCount: total,
        },
        tokenUsage:
          aggregate.tokenUsage.observations > 0
            ? {
                availability: "available",
                unit: "tokens",
                inputTokens: aggregate.tokenUsage.inputTokens,
                outputTokens: aggregate.tokenUsage.outputTokens,
                totalTokens: aggregate.tokenUsage.totalTokens,
                sampleCount: aggregate.tokenUsage.observations,
              }
            : { availability: "not_evaluated", reason: "not_captured" },
        answerAccuracy: noDeclaredMethod,
        usdCost: noDeclaredMethod,
        uncertainty: noDeclaredMethod,
      },
      evidence: { attemptDetail: attempts === null ? "aggregate_only" : "available" },
      ranking: { status: "unranked", reasons },
      attempts,
    };
    // Reuse the contract's aggregate, dimension, nearest-rank latency and token consistency checks.
    // Validate the supplied detail before any privacy withholding can remove it.
    const result = yield* decodePublicEvalResult(candidate).pipe(
      Effect.mapError(() =>
        failure(attempts === null ? "invalid_result" : "attempt_capture_aggregate_mismatch"),
      ),
    );
    if (!hasSafePublicEvalFields(result)) return yield* failure("invalid_result");
    if (options.withholdAttempts !== true) return result;
    return yield* decodePublicEvalResult({
      ...result,
      source: { ...result.source, kind: "sanitized_aggregate", attemptCaptureSha256: null },
      counts: {
        ...result.counts,
        cases: { total: caseTotal, passedEveryAttempt: null, failedAnyAttempt: null },
      },
      evidence: { attemptDetail: "withheld" },
      attempts: null,
    }).pipe(Effect.mapError(() => failure("invalid_result")));
  });
