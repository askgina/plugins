import { createHash } from "node:crypto";
import {
  PublicEvalAttemptCaptureSchema,
  PublicEvalAttemptSummarySchema,
  PublicEvalIdentifierSchema,
  PUBLIC_EVAL_MAX_ATTEMPTS,
  PUBLIC_EVAL_DECODE_OPTIONS,
  publicEvalAttemptIdentityInput,
  publicEvalFailureCategories,
  decodePublicEvalAttemptCapture,
  type PublicEvalAttemptCapture,
  type PublicEvalAttemptSummary,
} from "@askgina/contracts";
import { Data, Effect, FileSystem, Function, Path, Schema } from "effect";

import type {
  PluginEvalCaseScore,
  PluginEvalDimensionScore,
  PluginEvalObservationSet,
} from "./contracts";
import { SanitizedEvalRunReportSchema } from "./report";
import { isSafePublicEvalText } from "./sanitize";

export class PublicEvalAttemptCaptureError extends Data.TaggedError(
  "PublicEvalAttemptCaptureError",
)<{
  readonly reasons: readonly string[];
}> {}

export class PublicEvalAttemptWriteError extends Data.TaggedError("PublicEvalAttemptWriteError")<{
  readonly reason: "output-conflict" | "output-exists" | "write-failed";
}> {}

/** Identity is attached at the grading junction, not reconstructed from score order. */
export interface PublicEvalGradedAttempt {
  readonly runId: string;
  readonly caseId: string;
  readonly repetition: number;
  readonly score: PluginEvalCaseScore;
}

export interface PublicEvalAttemptCaptureSource {
  readonly runId: string;
  /** Exact UTF-8 aggregate report content, including the trailing newline. */
  readonly reportContent: string;
  readonly attempts: readonly PublicEvalAttemptSummary[];
}

export interface PublicEvalAttemptCaptureWriteOptions {
  readonly outputPath: string;
  readonly reportPath: string;
  readonly capture: PublicEvalAttemptCapture;
}

const decodeSummaries = Schema.decodeUnknownEffect(
  Schema.Array(PublicEvalAttemptSummarySchema),
  PUBLIC_EVAL_DECODE_OPTIONS,
);
const decodeReport = Schema.decodeUnknownEffect(
  Schema.fromJsonString(SanitizedEvalRunReportSchema),
  PUBLIC_EVAL_DECODE_OPTIONS,
);
const encodeCapture = Schema.encodeEffect(
  Schema.fromJsonString(PublicEvalAttemptCaptureSchema, { space: 2 }),
);
const captureError = () =>
  new PublicEvalAttemptCaptureError({
    reasons: ["attempt data does not match the public capture contract"],
  });
const writeError = () => new PublicEvalAttemptWriteError({ reason: "write-failed" });
const sha256Hex = (content: string): string =>
  createHash("sha256").update(content, "utf8").digest("hex");
const checkVerdict = (dimension: PluginEvalDimensionScore | undefined) =>
  dimension === undefined
    ? ("not_applicable" as const)
    : dimension.score === 1
      ? ("pass" as const)
      : ("fail" as const);
const hasInvalidGrade = (dimension: PluginEvalDimensionScore | undefined): boolean =>
  dimension !== undefined && dimension?.score !== 0 && dimension?.score !== 1;
const isPublicIdentifier = Schema.is(PublicEvalIdentifierSchema);

/** Rejects unsupported public identities and bounds before an opted-in run begins. */
export const assertPublicEvalAttemptPlan = Function.dual<
  (
    caseIds: readonly string[],
    repetitions: number,
  ) => (runId: string) => Effect.Effect<void, PublicEvalAttemptCaptureError>,
  (
    runId: string,
    caseIds: readonly string[],
    repetitions: number,
  ) => Effect.Effect<void, PublicEvalAttemptCaptureError>
>(3, (runId, caseIds, repetitions) =>
  Effect.gen(function* () {
    if (
      !Number.isSafeInteger(repetitions) ||
      repetitions < 1 ||
      caseIds.length === 0 ||
      caseIds.length > PUBLIC_EVAL_MAX_ATTEMPTS / repetitions ||
      !isPublicIdentifier(runId) ||
      !isSafePublicEvalText(runId)
    )
      return yield* captureError();
    const seen = new Set<string>();
    for (const caseId of caseIds) {
      if (seen.has(caseId) || !isPublicIdentifier(caseId) || !isSafePublicEvalText(caseId))
        return yield* captureError();
      seen.add(caseId);
    }
  }),
);

/** Projects only identities, numeric measurements and grader verdicts. Never reads grader details. */
export const makePublicEvalAttemptSummaries = Function.dual<
  (
    gradedAttempts: readonly PublicEvalGradedAttempt[],
  ) => (
    observationSet: PluginEvalObservationSet,
  ) => Effect.Effect<readonly PublicEvalAttemptSummary[], PublicEvalAttemptCaptureError>,
  (
    observationSet: PluginEvalObservationSet,
    gradedAttempts: readonly PublicEvalGradedAttempt[],
  ) => Effect.Effect<readonly PublicEvalAttemptSummary[], PublicEvalAttemptCaptureError>
>(2, (observationSet, gradedAttempts) =>
  Effect.gen(function* () {
    const { manifest, observations } = observationSet;
    if (
      observations.length === 0 ||
      observations.length > PUBLIC_EVAL_MAX_ATTEMPTS ||
      observations.length !== gradedAttempts.length ||
      !Number.isSafeInteger(manifest.repetitions) ||
      manifest.repetitions < 1
    ) {
      return yield* captureError();
    }
    const byIdentity = new Map<string, (typeof observations)[number]>();
    for (const observation of observations) {
      const key = publicEvalAttemptIdentityInput(
        observation.run_id,
        observation.case_id,
        observation.repetition,
      );
      if (
        byIdentity.has(key) ||
        observation.run_id !== manifest.run_id ||
        observation.target !== manifest.target ||
        observation.model !== manifest.model ||
        !Number.isSafeInteger(observation.repetition) ||
        observation.repetition < 1 ||
        observation.repetition > manifest.repetitions
      )
        return yield* captureError();
      byIdentity.set(key, observation);
    }
    const attempts: PublicEvalAttemptSummary[] = [];
    for (const graded of gradedAttempts) {
      const key = publicEvalAttemptIdentityInput(graded.runId, graded.caseId, graded.repetition);
      const observation = byIdentity.get(key);
      const score = graded.score;
      if (
        observation === undefined ||
        score.case_id !== graded.caseId ||
        score.latency_ms !== observation.duration_ms ||
        typeof score.overall_pass !== "boolean" ||
        score.routing === undefined ||
        score.arguments === undefined ||
        score.completion === undefined ||
        hasInvalidGrade(score.routing) ||
        hasInvalidGrade(score.arguments) ||
        hasInvalidGrade(score.safety) ||
        hasInvalidGrade(score.completion) ||
        hasInvalidGrade(score.skill_activation) ||
        !isSafePublicEvalText(graded.runId) ||
        !isSafePublicEvalText(graded.caseId)
      )
        return yield* captureError();
      byIdentity.delete(key);
      const checks = {
        routing: checkVerdict(score.routing),
        arguments: checkVerdict(score.arguments),
        safety: checkVerdict(score.safety),
        completion: checkVerdict(score.completion),
        skillActivation: checkVerdict(score.skill_activation),
      };
      attempts.push({
        id: `attempt-${sha256Hex(key)}`,
        runId: graded.runId,
        caseId: graded.caseId,
        repetition: graded.repetition,
        verdict: score.overall_pass ? "pass" : "fail",
        validity: "valid",
        evidenceAvailability: "available",
        checks,
        failureCategories: publicEvalFailureCategories(checks),
        durationMs: observation.duration_ms,
        tokenUsage:
          observation.token_usage === undefined
            ? null
            : {
                inputTokens: observation.token_usage.input_tokens,
                outputTokens: observation.token_usage.output_tokens,
                totalTokens: observation.token_usage.total_tokens,
              },
        replacementOf: null,
      });
    }
    return yield* decodeSummaries(attempts).pipe(Effect.mapError(captureError));
  }),
);

/** Binds safe summaries to saved aggregate bytes, not to publication approval. */
export const makePublicEvalAttemptCapture = ({
  runId,
  reportContent,
  attempts,
}: PublicEvalAttemptCaptureSource): Effect.Effect<
  PublicEvalAttemptCapture,
  PublicEvalAttemptCaptureError
> =>
  Effect.gen(function* () {
    const report = yield* decodeReport(reportContent).pipe(Effect.mapError(captureError));
    const capture = yield* decodePublicEvalAttemptCapture({
      schemaVersion: "eval-attempts.v1",
      runId,
      sourceReportSha256: sha256Hex(reportContent),
      attempts,
    }).pipe(Effect.mapError(captureError));
    if (
      report.runId !== runId ||
      capture.attempts.length !== report.aggregate.overall.total ||
      !isSafePublicEvalText(runId)
    ) {
      return yield* captureError();
    }
    for (const attempt of capture.attempts) {
      if (
        attempt.repetition > report.repetitions ||
        attempt.id !==
          `attempt-${sha256Hex(publicEvalAttemptIdentityInput(runId, attempt.caseId, attempt.repetition))}` ||
        !isSafePublicEvalText(attempt.caseId)
      )
        return yield* captureError();
    }
    return capture;
  });

/** Checks path aliases and pre-existing output before a CLI performs any work. */
export const assertPublicEvalAttemptOutputPath = Function.dual<
  (
    reportPath: string,
  ) => (
    outputPath: string,
  ) => Effect.Effect<void, PublicEvalAttemptWriteError, FileSystem.FileSystem | Path.Path>,
  (
    outputPath: string,
    reportPath: string,
  ) => Effect.Effect<void, PublicEvalAttemptWriteError, FileSystem.FileSystem | Path.Path>
>(2, (outputPath, reportPath) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const fs = yield* FileSystem.FileSystem;
    if (outputPath.trim().length === 0 || reportPath.trim().length === 0) {
      return yield* new PublicEvalAttemptWriteError({ reason: "output-conflict" });
    }
    const resolvedOutput = path.resolve(outputPath);
    const resolvedReport = path.resolve(reportPath);
    const canonical = (input: string) =>
      Effect.gen(function* () {
        let parent = path.dirname(input);
        const suffix = [path.basename(input)];
        while (!(yield* fs.exists(parent).pipe(Effect.mapError(writeError)))) {
          suffix.unshift(path.basename(parent));
          const next = path.dirname(parent);
          if (next === parent) return yield* writeError();
          parent = next;
        }
        return path.join(yield* fs.realPath(parent).pipe(Effect.mapError(writeError)), ...suffix);
      });
    const output = yield* canonical(resolvedOutput);
    const report = yield* canonical(resolvedReport);
    if (
      output === report ||
      output.startsWith(`${report}${path.sep}`) ||
      report.startsWith(`${output}${path.sep}`)
    ) {
      return yield* new PublicEvalAttemptWriteError({ reason: "output-conflict" });
    }
    if (yield* fs.exists(resolvedOutput).pipe(Effect.mapError(writeError))) {
      return yield* new PublicEvalAttemptWriteError({ reason: "output-exists" });
    }
  }),
);

/** Validates again at persistence and writes exclusively with private permissions. */
export const writePublicEvalAttemptCapture = ({
  outputPath,
  reportPath,
  capture,
}: PublicEvalAttemptCaptureWriteOptions): Effect.Effect<
  void,
  PublicEvalAttemptCaptureError | PublicEvalAttemptWriteError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    yield* assertPublicEvalAttemptOutputPath(outputPath, reportPath);
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const resolvedOutput = path.resolve(outputPath);
    const reportBytes = yield* fs
      .readFile(path.resolve(reportPath))
      .pipe(Effect.mapError(writeError));
    const reportContent = yield* Effect.try({
      try: () => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(reportBytes),
      catch: writeError,
    });
    const validated = yield* makePublicEvalAttemptCapture({
      runId: capture.runId,
      reportContent,
      attempts: capture.attempts,
    });
    yield* decodePublicEvalAttemptCapture(capture).pipe(Effect.mapError(captureError));
    if (validated.sourceReportSha256 !== capture.sourceReportSha256) return yield* captureError();
    const encoded = yield* encodeCapture(validated).pipe(Effect.mapError(captureError));
    yield* fs
      .makeDirectory(path.dirname(resolvedOutput), { recursive: true })
      .pipe(Effect.mapError(writeError));
    yield* fs
      .writeFileString(resolvedOutput, `${encoded}\n`, { flag: "wx", mode: 0o600 })
      .pipe(Effect.mapError(writeError));
  });
