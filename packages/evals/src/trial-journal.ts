import { publicEvalAttemptIdentityInput } from "@askgina/contracts";
import {
  Cause,
  Data,
  DateTime,
  Effect,
  Exit,
  FileSystem,
  Function,
  Option,
  Path,
  Schema,
  Semaphore,
  Scope,
} from "effect";

import { sha256Hex } from "./canonical-json";
import { SanitizedEvalRunReportSchema } from "./report";
import {
  PluginEvalTargetSchema,
  type PluginEvalObservation,
  type PluginEvalTarget,
} from "./contracts";
import {
  OpenRouterBudgetEvidenceSchema,
  validateOpenRouterBudgetEvidence,
  type OpenRouterBudgetEvidence,
} from "./openrouter-budget";
import type { OpenRouterGenerationEvidence } from "./provider-evidence";
import { isSafePublicEvalText } from "./sanitize";
import { isAllowedGinaReadServerUrl } from "./server-url";

export const LIVE_EVAL_JOURNAL_SCHEMA_VERSION = "eval-journal.v1" as const;
export const LIVE_EVAL_JOURNAL_MAX_CASES = 64;
export const LIVE_EVAL_JOURNAL_MAX_REPETITIONS = 5;
export const LIVE_EVAL_JOURNAL_MAX_STEPS = 32;
export const LIVE_EVAL_JOURNAL_MAX_TRIALS =
  LIVE_EVAL_JOURNAL_MAX_CASES * LIVE_EVAL_JOURNAL_MAX_REPETITIONS;

const MAX_LABEL_LENGTH = 128;
const MAX_MODEL_LENGTH = 128;
const MAX_GENERATION_ID_LENGTH = 128;
const MAX_RESPONSE_MODEL_LENGTH = 256;
const MAX_PROVIDER_LENGTH = 128;
const SAFE_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const DISPATCH_ID = /^dispatch-[a-f0-9]{64}$/u;
const SINGLE_LINE = /^[^\p{Cc}]*$/u;
const DECODE_OPTIONS = { errors: "all" as const, onExcessProperty: "error" as const };
const UTF8 = new TextEncoder();

const BoundedLabel = Schema.NonEmptyString.check(
  Schema.isMaxLength(MAX_LABEL_LENGTH),
  Schema.isPattern(SAFE_LABEL),
);
const BoundedModel = Schema.NonEmptyString.check(
  Schema.isMaxLength(MAX_MODEL_LENGTH),
  Schema.isPattern(
    /^[A-Za-z0-9](?:[A-Za-z0-9._:-]*[A-Za-z0-9])?(?:\/[A-Za-z0-9](?:[A-Za-z0-9._:-]*[A-Za-z0-9])?)*$/u,
  ),
);
const Sha256 = Schema.String.check(Schema.isPattern(SHA256));
const UtcTimestamp = Schema.NonEmptyString.check(
  Schema.isMaxLength(64),
  Schema.isPattern(UTC_TIMESTAMP),
);
const DispatchId = Schema.NonEmptyString.check(Schema.isPattern(DISPATCH_ID));
const Repetition = Schema.Int.check(
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(LIVE_EVAL_JOURNAL_MAX_REPETITIONS),
);
const GenerationStep = Schema.Int.check(
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(LIVE_EVAL_JOURNAL_MAX_STEPS),
);
const ObservedToken = Schema.NullOr(
  Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(0),
    Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
  ),
);
const ObservedCost = Schema.NullOr(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)));
const ObservedLine = (maxLength: number) =>
  Schema.NullOr(
    Schema.NonEmptyString.check(Schema.isMaxLength(maxLength), Schema.isPattern(SINGLE_LINE)),
  );

export const LiveEvalJournalTrialStatusSchema = Schema.Literals([
  "completed",
  "failed",
  "blocked",
  "interruption",
  "timeout",
]);
export type LiveEvalJournalTrialStatus = typeof LiveEvalJournalTrialStatusSchema.Type;

export const LiveEvalJournalGenerationEvidenceSchema = Schema.Struct({
  generationId: ObservedLine(MAX_GENERATION_ID_LENGTH),
  responseModel: ObservedLine(MAX_RESPONSE_MODEL_LENGTH),
  provider: ObservedLine(MAX_PROVIDER_LENGTH),
  step: GenerationStep,
  inputTokens: ObservedToken,
  outputTokens: ObservedToken,
  totalTokens: ObservedToken,
  cost: ObservedCost,
});

const PositiveVersion = Schema.Int.check(Schema.isGreaterThan(0));
const PlannedCaseIds = Schema.Array(BoundedLabel).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(LIVE_EVAL_JOURNAL_MAX_CASES),
);

const RunRecordSchema = Schema.Struct({
  kind: Schema.Literal("run"),
  schemaVersion: Schema.Literal(LIVE_EVAL_JOURNAL_SCHEMA_VERSION),
  runId: BoundedLabel,
  candidate: BoundedLabel,
  target: PluginEvalTargetSchema,
  model: BoundedModel,
  serverUrl: Schema.NonEmptyString.check(Schema.isPattern(SINGLE_LINE)),
  suiteId: BoundedLabel,
  suiteVersion: PositiveVersion,
  fixtureVersion: PositiveVersion,
  catalogSha: Sha256,
  reasoning: Schema.optionalKey(BoundedLabel),
  accountClass: BoundedLabel,
  caseIds: PlannedCaseIds,
  repetitions: Repetition,
});
const StartedRecordSchema = Schema.Struct({
  kind: Schema.Literal("started"),
  dispatchId: DispatchId,
  caseId: BoundedLabel,
  repetition: Repetition,
  startedAt: UtcTimestamp,
  budgetEvidence: Schema.optionalKey(OpenRouterBudgetEvidenceSchema),
});
const GenerationRecordSchema = Schema.Struct({
  kind: Schema.Literal("generation"),
  dispatchId: DispatchId,
  evidence: LiveEvalJournalGenerationEvidenceSchema,
});
const FinishedRecordSchema = Schema.Struct({
  kind: Schema.Literal("finished"),
  dispatchId: DispatchId,
  status: LiveEvalJournalTrialStatusSchema,
});
const BoundRecordSchema = Schema.Struct({
  kind: Schema.Literal("report-bound"),
  sourceReportSha256: Sha256,
});

export type LiveEvalJournalRecord =
  | typeof RunRecordSchema.Type
  | typeof StartedRecordSchema.Type
  | typeof GenerationRecordSchema.Type
  | typeof FinishedRecordSchema.Type
  | typeof BoundRecordSchema.Type;

export class LiveEvalJournalError extends Data.TaggedError("LiveEvalJournalError")<{
  readonly reason:
    | "invalid-identity"
    | "invalid-path"
    | "output-exists"
    | "output-conflict"
    | "write-failed"
    | "invalid-record"
    | "unknown-dispatch"
    | "already-started"
    | "already-finished"
    | "already-bound"
    | "capacity-exceeded";
}> {}

export interface LiveEvalJournalOptions {
  readonly outputPath: string;
  readonly runId: string;
  readonly candidate: string;
  readonly target: PluginEvalTarget;
  readonly model: string;
  readonly serverUrl: string;
  readonly suiteId: string;
  readonly suiteVersion: number;
  readonly fixtureVersion: number;
  readonly catalogSha: string;
  readonly reasoning?: string;
  readonly accountClass: string;
  readonly caseIds: readonly string[];
  readonly repetitions: number;
}

export interface LiveEvalJournal {
  readonly startTrial: (input: {
    readonly caseId: string;
    readonly repetition: number;
    readonly budgetEvidence?: OpenRouterBudgetEvidence;
  }) => Effect.Effect<string, LiveEvalJournalError, FileSystem.FileSystem>;
  readonly generation: (
    dispatchId: string,
    evidence: OpenRouterGenerationEvidence,
  ) => Effect.Effect<void, LiveEvalJournalError, FileSystem.FileSystem>;
  readonly finishTrial: (
    dispatchId: string,
    status: LiveEvalJournalTrialStatus,
  ) => Effect.Effect<void, LiveEvalJournalError, FileSystem.FileSystem>;
  readonly bindReport: (
    reportContent: string,
    selectedCaseIds: readonly string[],
  ) => Effect.Effect<void, LiveEvalJournalError, FileSystem.FileSystem>;
}

const fail = (reason: LiveEvalJournalError["reason"]) => new LiveEvalJournalError({ reason });

const decodeLabel = Schema.decodeUnknownEffect(BoundedLabel, DECODE_OPTIONS);
const decodeModel = Schema.decodeUnknownEffect(BoundedModel, DECODE_OPTIONS);
const decodeTarget = Schema.decodeUnknownEffect(PluginEvalTargetSchema, DECODE_OPTIONS);
const decodeStatus = Schema.decodeUnknownEffect(LiveEvalJournalTrialStatusSchema, DECODE_OPTIONS);
const decodeDispatchId = Schema.decodeUnknownEffect(DispatchId, DECODE_OPTIONS);
const decodeEvidence = Schema.decodeUnknownEffect(
  LiveEvalJournalGenerationEvidenceSchema,
  DECODE_OPTIONS,
);
const decodeSha256 = Schema.decodeUnknownEffect(Sha256, DECODE_OPTIONS);
const decodePositiveVersion = Schema.decodeUnknownEffect(PositiveVersion, DECODE_OPTIONS);
const encodeRun = Schema.encodeEffect(Schema.fromJsonString(RunRecordSchema));
const encodeStarted = Schema.encodeEffect(Schema.fromJsonString(StartedRecordSchema));
const encodeGeneration = Schema.encodeEffect(Schema.fromJsonString(GenerationRecordSchema));
const encodeFinished = Schema.encodeEffect(Schema.fromJsonString(FinishedRecordSchema));
const encodeBound = Schema.encodeEffect(Schema.fromJsonString(BoundRecordSchema));

const admitLabel = (value: string): Effect.Effect<string, LiveEvalJournalError> =>
  decodeLabel(value).pipe(
    Effect.mapError(() => fail("invalid-identity")),
    Effect.filterOrFail(isSafePublicEvalText, () => fail("invalid-identity")),
  );

const admitCaseId = (value: string): Effect.Effect<string, LiveEvalJournalError> =>
  decodeLabel(value).pipe(
    Effect.mapError(() => fail("invalid-record")),
    Effect.filterOrFail(isSafePublicEvalText, () => fail("invalid-record")),
  );

const isUnsafePath = (outputPath: string): boolean =>
  outputPath.trim().length === 0 ||
  outputPath !== outputPath.trim() ||
  outputPath.includes("\0") ||
  outputPath.split(/[\\/]/u).includes("..");

interface TrialState {
  readonly caseId: string;
  readonly repetition: number;
  finished: boolean;
  readonly steps: Set<number>;
}

export const liveEvalJournalDispatchId = Function.dual<
  (caseId: string, repetition: number) => (runId: string) => string,
  (runId: string, caseId: string, repetition: number) => string
>(
  3,
  (runId, caseId, repetition) =>
    `dispatch-${sha256Hex(publicEvalAttemptIdentityInput(runId, caseId, repetition))}`,
);

export const createLiveEvalJournal = (
  options: LiveEvalJournalOptions,
): Effect.Effect<
  LiveEvalJournal,
  LiveEvalJournalError,
  FileSystem.FileSystem | Path.Path | Scope.Scope
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    if (isUnsafePath(options.outputPath)) return yield* fail("invalid-path");
    const output = path.resolve(options.outputPath);
    if (output !== path.normalize(output)) return yield* fail("invalid-path");
    const runId = yield* admitLabel(options.runId);
    const candidate = yield* admitLabel(options.candidate);
    const target = yield* decodeTarget(options.target).pipe(
      Effect.mapError(() => fail("invalid-identity")),
    );
    const model = yield* decodeModel(options.model).pipe(
      Effect.mapError(() => fail("invalid-identity")),
      Effect.filterOrFail(isSafePublicEvalText, () => fail("invalid-identity")),
    );
    if (
      !isAllowedGinaReadServerUrl(options.serverUrl) ||
      !isSafePublicEvalText(options.serverUrl)
    ) {
      return yield* fail("invalid-identity");
    }
    const suiteId = yield* admitLabel(options.suiteId);
    const suiteVersion = yield* decodePositiveVersion(options.suiteVersion).pipe(
      Effect.mapError(() => fail("invalid-identity")),
    );
    const fixtureVersion = yield* decodePositiveVersion(options.fixtureVersion).pipe(
      Effect.mapError(() => fail("invalid-identity")),
    );
    const catalogSha = yield* decodeSha256(options.catalogSha).pipe(
      Effect.mapError(() => fail("invalid-identity")),
    );
    const reasoning =
      options.reasoning === undefined ? undefined : yield* admitLabel(options.reasoning);
    const accountClass = yield* admitLabel(options.accountClass);
    if (
      !Array.isArray(options.caseIds) ||
      options.caseIds.length < 1 ||
      options.caseIds.length > LIVE_EVAL_JOURNAL_MAX_CASES
    ) {
      return yield* fail("invalid-identity");
    }
    const plannedCaseIds: string[] = [];
    const plannedCaseIdSet = new Set<string>();
    for (const value of options.caseIds) {
      const caseId = yield* admitLabel(value);
      if (plannedCaseIdSet.has(caseId)) return yield* fail("invalid-identity");
      plannedCaseIdSet.add(caseId);
      plannedCaseIds.push(caseId);
    }
    if (
      !Number.isSafeInteger(options.repetitions) ||
      options.repetitions < 1 ||
      options.repetitions > LIVE_EVAL_JOURNAL_MAX_REPETITIONS
    ) {
      return yield* fail("invalid-identity");
    }
    const plannedRepetitions = options.repetitions;
    const encoded = yield* encodeRun({
      kind: "run",
      schemaVersion: LIVE_EVAL_JOURNAL_SCHEMA_VERSION,
      runId,
      candidate,
      target,
      model,
      serverUrl: options.serverUrl,
      suiteId,
      suiteVersion,
      fixtureVersion,
      catalogSha,
      ...(reasoning === undefined ? {} : { reasoning }),
      accountClass,
      caseIds: plannedCaseIds,
      repetitions: plannedRepetitions,
    }).pipe(Effect.mapError(() => fail("invalid-identity")));
    if (yield* fs.exists(output).pipe(Effect.mapError(() => fail("write-failed")))) {
      return yield* fail("output-exists");
    }
    let ancestor = path.dirname(output);
    while (!(yield* fs.exists(ancestor).pipe(Effect.mapError(() => fail("invalid-path"))))) {
      const parent = path.dirname(ancestor);
      if (parent === ancestor) return yield* fail("invalid-path");
      ancestor = parent;
    }
    if (
      (yield* fs.realPath(ancestor).pipe(Effect.mapError(() => fail("invalid-path")))) !== ancestor
    ) {
      return yield* fail("invalid-path");
    }
    yield* fs
      .makeDirectory(path.dirname(output), { recursive: true })
      .pipe(Effect.mapError(() => fail("write-failed")));
    const file = yield* fs
      .open(output, { flag: "wx", mode: 0o600 })
      .pipe(
        Effect.mapError((error) =>
          fail(error.reason._tag === "AlreadyExists" ? "output-exists" : "write-failed"),
        ),
      );
    const identity = yield* file.stat.pipe(Effect.mapError(() => fail("write-failed")));
    const inode = Option.getOrUndefined(identity.ino);
    let expectedSize = 0n;
    let poisoned = false;
    let closed = false;
    const lock = Semaphore.makeUnsafe(1);
    yield* Effect.addFinalizer(() =>
      Effect.uninterruptible(
        lock.withPermit(
          Effect.sync(() => {
            closed = true;
          }),
        ),
      ),
    );
    const verifyOwnership = Effect.gen(function* () {
      if (poisoned || closed) return yield* fail("write-failed");
      const canonical = yield* fs
        .realPath(output)
        .pipe(Effect.mapError(() => fail("output-conflict")));
      const current = yield* fs.stat(output).pipe(Effect.mapError(() => fail("output-conflict")));
      const held = yield* file.stat.pipe(Effect.mapError(() => fail("write-failed")));
      for (const info of [current, held]) {
        if (
          canonical !== output ||
          inode === undefined ||
          info.type !== "File" ||
          info.dev !== identity.dev ||
          Option.getOrUndefined(info.ino) !== inode ||
          Option.getOrUndefined(info.nlink) !== 1 ||
          info.size !== expectedSize ||
          (info.mode & 0o777) !== 0o600
        ) {
          return yield* fail("output-conflict");
        }
      }
    });
    const append = (record: string) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          yield* verifyOwnership;
          const bytes = UTF8.encode(`${record}\n`);
          yield* file.writeAll(bytes).pipe(Effect.mapError(() => fail("write-failed")));
          yield* file.sync.pipe(Effect.mapError(() => fail("write-failed")));
          expectedSize += BigInt(bytes.byteLength);
          yield* verifyOwnership;
        }).pipe(
          Effect.tapError(() =>
            Effect.sync(() => {
              poisoned = true;
            }),
          ),
        ),
      );
    yield* append(encoded);

    const trials = new Map<string, TrialState>();
    let bound = false;

    const exclusive = <A>(effect: Effect.Effect<A, LiveEvalJournalError, FileSystem.FileSystem>) =>
      lock.withPermit(Effect.uninterruptible(effect));

    const requireOpen = (): Effect.Effect<void, LiveEvalJournalError> =>
      bound ? Effect.fail(fail("already-bound")) : Effect.void;

    const startTrial: LiveEvalJournal["startTrial"] = (input) =>
      Effect.gen(function* () {
        const caseId = yield* admitCaseId(input.caseId);
        if (
          !Number.isSafeInteger(input.repetition) ||
          input.repetition < 1 ||
          input.repetition > LIVE_EVAL_JOURNAL_MAX_REPETITIONS
        ) {
          return yield* fail("invalid-record");
        }
        const repetition = input.repetition;
        const requiresBudget = target === "openrouter_api";
        if (requiresBudget && input.budgetEvidence === undefined) {
          return yield* fail("invalid-record");
        }
        if (!requiresBudget && input.budgetEvidence !== undefined) {
          return yield* fail("invalid-record");
        }
        const budgetEvidence =
          input.budgetEvidence === undefined
            ? undefined
            : yield* validateOpenRouterBudgetEvidence(input.budgetEvidence).pipe(
                Effect.mapError(() => fail("invalid-record")),
              );
        const dispatchId = liveEvalJournalDispatchId(runId, caseId, repetition);
        const startedAt = DateTime.formatIso(yield* DateTime.now);
        const encodedStarted = yield* encodeStarted({
          kind: "started",
          dispatchId,
          caseId,
          repetition,
          startedAt,
          ...(budgetEvidence === undefined ? {} : { budgetEvidence }),
        }).pipe(Effect.mapError(() => fail("invalid-record")));
        yield* exclusive(
          Effect.gen(function* () {
            yield* requireOpen();
            if (!plannedCaseIdSet.has(caseId) || repetition > plannedRepetitions) {
              return yield* fail("invalid-record");
            }
            if (trials.has(dispatchId)) return yield* fail("already-started");
            if (trials.size >= LIVE_EVAL_JOURNAL_MAX_TRIALS) {
              return yield* fail("capacity-exceeded");
            }
            yield* append(encodedStarted);
            trials.set(dispatchId, {
              caseId,
              repetition,
              finished: false,
              steps: new Set(),
            });
          }),
        );
        return dispatchId;
      });

    const generation: LiveEvalJournal["generation"] = (dispatchId, evidence) =>
      Effect.gen(function* () {
        yield* decodeDispatchId(dispatchId).pipe(Effect.mapError(() => fail("unknown-dispatch")));
        const admitted = yield* decodeEvidence(evidence).pipe(
          Effect.mapError(() => fail("invalid-record")),
        );
        const observed = [admitted.generationId, admitted.responseModel, admitted.provider];
        if (observed.some((value) => value !== null && !isSafePublicEvalText(value))) {
          return yield* fail("invalid-record");
        }
        const encodedGeneration = yield* encodeGeneration({
          kind: "generation",
          dispatchId,
          evidence: admitted,
        }).pipe(Effect.mapError(() => fail("invalid-record")));
        yield* exclusive(
          Effect.gen(function* () {
            yield* requireOpen();
            const trial = trials.get(dispatchId);
            if (trial === undefined) return yield* fail("unknown-dispatch");
            if (trial.finished) return yield* fail("already-finished");
            if (trial.steps.has(admitted.step)) return yield* fail("invalid-record");
            if (trial.steps.size >= LIVE_EVAL_JOURNAL_MAX_STEPS) {
              return yield* fail("capacity-exceeded");
            }
            yield* append(encodedGeneration);
            trial.steps.add(admitted.step);
          }),
        );
      });

    const finishTrial: LiveEvalJournal["finishTrial"] = (dispatchId, status) =>
      Effect.gen(function* () {
        yield* decodeDispatchId(dispatchId).pipe(Effect.mapError(() => fail("unknown-dispatch")));
        const admittedStatus = yield* decodeStatus(status).pipe(
          Effect.mapError(() => fail("invalid-record")),
        );
        const encodedFinished = yield* encodeFinished({
          kind: "finished",
          dispatchId,
          status: admittedStatus,
        }).pipe(Effect.mapError(() => fail("invalid-record")));
        yield* exclusive(
          Effect.gen(function* () {
            yield* requireOpen();
            const trial = trials.get(dispatchId);
            if (trial === undefined) return yield* fail("unknown-dispatch");
            if (trial.finished) return yield* fail("already-finished");
            yield* append(encodedFinished);
            trial.finished = true;
          }),
        );
      });

    const bindReport: LiveEvalJournal["bindReport"] = (reportContent, selectedCaseIds) =>
      Effect.gen(function* () {
        if (typeof reportContent !== "string" || reportContent.length > 1_048_576)
          return yield* fail("invalid-record");
        if (
          !Array.isArray(selectedCaseIds) ||
          selectedCaseIds.length !== plannedCaseIds.length ||
          selectedCaseIds.some((caseId, index) => caseId !== plannedCaseIds[index])
        ) {
          return yield* fail("invalid-record");
        }
        const report = yield* Schema.decodeEffect(
          Schema.fromJsonString(SanitizedEvalRunReportSchema),
          DECODE_OPTIONS,
        )(reportContent).pipe(Effect.mapError(() => fail("invalid-record")));
        if (
          report.runId !== runId ||
          report.candidate !== candidate ||
          report.target !== target ||
          report.model !== model ||
          report.accountClass !== accountClass ||
          report.repetitions !== plannedRepetitions ||
          (report.reasoning ?? undefined) !== (reasoning ?? undefined) ||
          report.aggregate.suiteId !== suiteId ||
          report.aggregate.suiteVersion !== suiteVersion ||
          report.aggregate.fixtureVersion !== fixtureVersion ||
          report.aggregate.catalogSha !== catalogSha
        ) {
          return yield* fail("invalid-record");
        }
        const encodedBound = yield* encodeBound({
          kind: "report-bound",
          sourceReportSha256: sha256Hex(reportContent),
        }).pipe(Effect.mapError(() => fail("invalid-record")));
        const plannedTrialCount = plannedCaseIds.length * plannedRepetitions;
        yield* exclusive(
          Effect.gen(function* () {
            if (bound) return yield* fail("already-bound");
            if (trials.size === 0 || report.aggregate.overall.total !== plannedTrialCount) {
              return yield* fail("invalid-record");
            }
            for (const caseId of plannedCaseIds) {
              for (let repetition = 1; repetition <= plannedRepetitions; repetition += 1) {
                if (
                  trials.get(liveEvalJournalDispatchId(runId, caseId, repetition))?.finished !==
                  true
                ) {
                  return yield* fail("invalid-record");
                }
              }
            }
            yield* append(encodedBound);
            bound = true;
          }),
        );
      });

    return { startTrial, generation, finishTrial, bindReport };
  });

const isTypedTimeoutError = (error: unknown): boolean =>
  Cause.isTimeoutError(error) ||
  (typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    typeof error._tag === "string" &&
    error._tag.endsWith("TimeoutError"));

export const withJournaledTrial = Function.dual<
  <E, R>(
    input: {
      readonly caseId: string;
      readonly repetition: number;
      readonly budgetEvidence?: OpenRouterBudgetEvidence;
    },
    trial: (dispatchId: string) => Effect.Effect<PluginEvalObservation, E, R>,
  ) => (
    journal: LiveEvalJournal,
  ) => Effect.Effect<PluginEvalObservation, E | LiveEvalJournalError, R | FileSystem.FileSystem>,
  <E, R>(
    journal: LiveEvalJournal,
    input: {
      readonly caseId: string;
      readonly repetition: number;
      readonly budgetEvidence?: OpenRouterBudgetEvidence;
    },
    trial: (dispatchId: string) => Effect.Effect<PluginEvalObservation, E, R>,
  ) => Effect.Effect<PluginEvalObservation, E | LiveEvalJournalError, R | FileSystem.FileSystem>
>(3, (journal, input, trial) =>
  Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const dispatchId = yield* journal.startTrial(input);
      return yield* restore(trial(dispatchId)).pipe(
        Effect.onExit((exit) => {
          const status: LiveEvalJournalTrialStatus = Exit.isSuccess(exit)
            ? exit.value.status
            : Cause.hasInterrupts(exit.cause)
              ? "interruption"
              : isTypedTimeoutError(Option.getOrUndefined(Cause.findErrorOption(exit.cause)))
                ? "timeout"
                : "failed";
          return journal.finishTrial(dispatchId, status);
        }),
      );
    }),
  ),
);
