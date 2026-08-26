import { Data, Effect, Schema } from "effect";

import type { PluginEvalReplayReport, PluginEvalRunManifest } from "./contracts.js";
import {
  findPublicTextViolations,
  HermeticEvalSanitizationError,
  sanitizeEvalAggregate,
  SanitizedEvalAggregateSchema,
} from "./sanitize.js";

const SafeRunLabelSchema = Schema.NonEmptyString.check(
  Schema.isMaxLength(128),
  Schema.isPattern(/^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/u),
);
const PositiveIntSchema = Schema.Int.check(Schema.isGreaterThan(0));
const UtcTimestampSchema = Schema.NonEmptyString.check(
  Schema.isMaxLength(64),
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u),
);

export interface EvalReplayProvenance {
  readonly suiteId: string;
  readonly suiteVersion: number;
  readonly fixtureVersion: number;
  readonly catalogSha: string;
  readonly manifest: PluginEvalRunManifest;
  readonly report: PluginEvalReplayReport;
}

export const SanitizedEvalRunReportSchema = Schema.Struct({
  schemaVersion: Schema.Literal("v1"),
  runId: SafeRunLabelSchema,
  candidate: SafeRunLabelSchema,
  target: SafeRunLabelSchema,
  model: SafeRunLabelSchema,
  reasoning: SafeRunLabelSchema,
  repetitions: PositiveIntSchema,
  startedAt: UtcTimestampSchema,
  cleanChat: Schema.Literal(true),
  accountClass: SafeRunLabelSchema,
  aggregate: SanitizedEvalAggregateSchema,
});

export type SanitizedEvalRunReport = typeof SanitizedEvalRunReportSchema.Type;

export class SanitizedEvalRunReportError extends Data.TaggedError("SanitizedEvalRunReportError")<{
  readonly reasons: readonly string[];
}> {}

export const sanitizeEvalReplay = (
  source: EvalReplayProvenance,
): Effect.Effect<typeof SanitizedEvalAggregateSchema.Type, HermeticEvalSanitizationError> => {
  const report = source.report;
  if (report.observed !== report.expected_observations || report.coverage_rate !== 1) {
    return Effect.fail(
      new HermeticEvalSanitizationError({ reasons: ["eval replay coverage must be complete"] }),
    );
  }
  return sanitizeEvalAggregate(
    {
      schemaVersion: "v1",
      suiteId: source.suiteId,
      suiteVersion: source.suiteVersion,
      fixtureVersion: source.fixtureVersion,
      catalogSha: source.catalogSha,
      overall: {
        passed: report.overall.passed,
        total: report.overall.passed + report.overall.failed,
      },
      dimensions: {
        routing: { passed: report.routing.passed, failed: report.routing.failed },
        arguments: { passed: report.arguments.passed, failed: report.arguments.failed },
        safety: { passed: report.safety.passed, failed: report.safety.failed },
        completion: { passed: report.completion.passed, failed: report.completion.failed },
      },
      skillActivation: {
        passed: report.skill_activation.passed,
        failed: report.skill_activation.failed,
      },
      latencyMs: report.latency_ms,
      totalResultBytes: report.total_result_bytes,
      tokenUsage: {
        observations: report.token_usage.observations,
        inputTokens: report.token_usage.input_tokens,
        outputTokens: report.token_usage.output_tokens,
        totalTokens: report.token_usage.total_tokens,
      },
      artifactPolicy: "sanitized",
    },
    {
      suiteId: source.suiteId,
      suiteVersion: source.suiteVersion,
      fixtureVersion: source.fixtureVersion,
      catalogSha: source.catalogSha,
    },
  );
};

export const makeSanitizedEvalRunReport = (
  source: EvalReplayProvenance,
): Effect.Effect<
  SanitizedEvalRunReport,
  HermeticEvalSanitizationError | SanitizedEvalRunReportError
> =>
  Effect.gen(function* () {
    const reasons = [
      source.manifest.run_id,
      source.manifest.candidate,
      source.manifest.target,
      source.manifest.model,
      source.manifest.reasoning ?? "",
      source.manifest.account_class,
      source.manifest.started_at,
    ].flatMap((value) =>
      findPublicTextViolations(value).map(
        ({ kind, index }) => `run label contains ${kind} at offset ${index}`,
      ),
    );
    if (reasons.length > 0) return yield* new SanitizedEvalRunReportError({ reasons });
    const aggregate = yield* sanitizeEvalReplay(source);
    return yield* Schema.decodeUnknownEffect(SanitizedEvalRunReportSchema, {
      errors: "all",
      onExcessProperty: "error",
    })({
      schemaVersion: "v1",
      candidate: source.manifest.candidate,
      model: source.manifest.model,
      reasoning: source.manifest.reasoning,
      repetitions: source.manifest.repetitions,
      runId: source.manifest.run_id,
      target: source.manifest.target,
      startedAt: source.manifest.started_at,
      cleanChat: source.manifest.clean_chat,
      accountClass: source.manifest.account_class,
      aggregate,
    }).pipe(
      Effect.mapError(
        () =>
          new SanitizedEvalRunReportError({
            reasons: ["run metadata does not match the sanitized report schema"],
          }),
      ),
    );
  });
