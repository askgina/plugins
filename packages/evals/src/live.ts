import {
  catalogSha,
  isGinaReadToolName,
  listCatalogToolNames,
  type PublicEvalAttemptSummary,
} from "@askgina/contracts";
import { Data, DateTime, Effect, Function } from "effect";

import type {
  PluginEvalCase,
  PluginEvalObservation,
  PluginEvalSuite,
  PluginEvalTarget,
} from "./contracts";
import type { PluginEvalObservationMismatchError } from "./grading";
import {
  decodePluginEvalObservationSet,
  type PluginEvalObservationSetValidationError,
} from "./load-observations";
import { replayPluginEvalObservationSet, type PluginEvalReplayContractError } from "./replay";
import {
  assertSanitizedRunMetadata,
  makeSanitizedEvalRunReport,
  type SanitizedEvalRunReport,
  type SanitizedEvalRunReportError,
} from "./report";
import type { HermeticEvalSanitizationError } from "./sanitize";
import { assertPublicEvalAttemptPlan, PublicEvalAttemptCaptureError } from "./public-attempts";
import type { LiveEvalRequestedRouting } from "./profile-identity";

export interface LiveEvalResult {
  readonly report: SanitizedEvalRunReport;
  readonly attempts: readonly PublicEvalAttemptSummary[] | null;
  readonly requestedRouting?: LiveEvalRequestedRouting;
}
export const MINIMUM_LIVE_REPETITIONS = 3;
export const MAXIMUM_LIVE_REPETITIONS = 5;
export const MAXIMUM_LIVE_CASES = 64;

export interface LiveEvalOptions {
  readonly suite: PluginEvalSuite;
  readonly caseIds?: readonly string[];
  readonly captureAttempts?: boolean;
  readonly runId: string;
  readonly candidate: string;
  readonly target: PluginEvalTarget;
  readonly model: string;
  readonly displayedModel?: string;
  readonly reasoning: string;
  readonly repetitions: number;
  readonly accountClass: string;
  readonly requestedRouting?: LiveEvalRequestedRouting;
}

export interface LiveEvalTrialInput {
  readonly evalCase: PluginEvalCase;
  readonly runId: string;
  readonly target: PluginEvalTarget;
  readonly model: string;
  readonly displayedModel?: string;
  readonly repetition: number;
  readonly startedAt: string;
}

export class LiveEvalSelectionError extends Data.TaggedError("LiveEvalSelectionError")<{
  readonly reason:
    | "duplicate-case"
    | "empty-selection"
    | "invalid-repetitions"
    | "out-of-catalog-tool"
    | "too-many-cases"
    | "unsupported-turns"
    | "unknown-case"
    | "missing-requested-routing"
    | "unexpected-requested-routing";
}> {}

export const preflightLiveEvalSuite = (
  suite: PluginEvalSuite,
): Effect.Effect<void, LiveEvalSelectionError> => {
  const hasOutOfCatalogTool = suite.cases.some((evalCase) => {
    const { routing } = evalCase.expected;
    const hasOutOfCatalogRoutingTool =
      routing.kind === "exact"
        ? !isGinaReadToolName(routing.tool)
        : routing.kind === "one_of" || routing.kind === "sequence"
          ? routing.tools.some((tool) => !isGinaReadToolName(tool))
          : false;
    return (
      hasOutOfCatalogRoutingTool ||
      (evalCase.expected.arguments?.tool !== undefined &&
        !isGinaReadToolName(evalCase.expected.arguments.tool))
    );
  });
  return hasOutOfCatalogTool
    ? Effect.fail(new LiveEvalSelectionError({ reason: "out-of-catalog-tool" }))
    : Effect.void;
};

const selectCases = (
  suite: PluginEvalSuite,
  requestedIds: readonly string[] | undefined,
): Effect.Effect<readonly PluginEvalCase[], LiveEvalSelectionError> => {
  if (requestedIds === undefined) return Effect.succeed(suite.cases);
  if (requestedIds.length === 0) {
    return Effect.fail(new LiveEvalSelectionError({ reason: "empty-selection" }));
  }
  const requested = new Set(requestedIds);
  if (requested.size !== requestedIds.length) {
    return Effect.fail(new LiveEvalSelectionError({ reason: "duplicate-case" }));
  }
  if (requestedIds.some((id) => !suite.cases.some((evalCase) => evalCase.id === id))) {
    return Effect.fail(new LiveEvalSelectionError({ reason: "unknown-case" }));
  }
  return Effect.succeed(suite.cases.filter((evalCase) => requested.has(evalCase.id)));
};

type LiveEvalSuiteError<TrialError> =
  | TrialError
  | LiveEvalSelectionError
  | PluginEvalObservationSetValidationError
  | PluginEvalReplayContractError
  | PluginEvalObservationMismatchError
  | HermeticEvalSanitizationError
  | SanitizedEvalRunReportError
  | PublicEvalAttemptCaptureError;

type LiveEvalSuiteEffect<TrialError, Requirements> = Effect.Effect<
  LiveEvalResult,
  LiveEvalSuiteError<TrialError>,
  Requirements
>;

export const runLiveEvalSuite = Function.dual<
  <TrialError, Requirements>(
    runTrial: (
      input: LiveEvalTrialInput,
    ) => Effect.Effect<PluginEvalObservation, TrialError, Requirements>,
  ) => (options: LiveEvalOptions) => LiveEvalSuiteEffect<TrialError, Requirements>,
  <TrialError, Requirements>(
    options: LiveEvalOptions,
    runTrial: (
      input: LiveEvalTrialInput,
    ) => Effect.Effect<PluginEvalObservation, TrialError, Requirements>,
  ) => LiveEvalSuiteEffect<TrialError, Requirements>
>(
  2,
  <TrialError, Requirements>(
    options: LiveEvalOptions,
    runTrial: (
      input: LiveEvalTrialInput,
    ) => Effect.Effect<PluginEvalObservation, TrialError, Requirements>,
  ): LiveEvalSuiteEffect<TrialError, Requirements> =>
    Effect.gen(function* () {
      yield* preflightLiveEvalSuite(options.suite);
      if (options.target === "openrouter_api" && options.requestedRouting === undefined) {
        return yield* new LiveEvalSelectionError({ reason: "missing-requested-routing" });
      }
      if (options.target !== "openrouter_api" && options.requestedRouting !== undefined) {
        return yield* new LiveEvalSelectionError({ reason: "unexpected-requested-routing" });
      }
      if (
        !Number.isSafeInteger(options.repetitions) ||
        options.repetitions < MINIMUM_LIVE_REPETITIONS ||
        options.repetitions > MAXIMUM_LIVE_REPETITIONS
      ) {
        return yield* new LiveEvalSelectionError({ reason: "invalid-repetitions" });
      }
      const cases = yield* selectCases(options.suite, options.caseIds);
      if (cases.length > MAXIMUM_LIVE_CASES) {
        return yield* new LiveEvalSelectionError({ reason: "too-many-cases" });
      }
      if (
        cases.some((evalCase) => evalCase.turns.length !== 1 || evalCase.turns[0]?.role !== "user")
      ) {
        return yield* new LiveEvalSelectionError({ reason: "unsupported-turns" });
      }
      const startedAt = DateTime.formatIso(yield* DateTime.now);
      yield* assertSanitizedRunMetadata({
        runId: options.runId,
        candidate: options.candidate,
        target: options.target,
        model: options.model,
        reasoning: options.reasoning,
        accountClass: options.accountClass,
        startedAt,
      });
      if (options.captureAttempts === true) {
        yield* assertPublicEvalAttemptPlan(
          options.runId,
          cases.map((evalCase) => evalCase.id),
          options.repetitions,
        );
      }
      const observations: PluginEvalObservation[] = [];

      for (let repetition = 1; repetition <= options.repetitions; repetition += 1) {
        for (const evalCase of cases) {
          const observation = yield* runTrial({
            evalCase,
            runId: options.runId,
            target: options.target,
            model: options.model,
            ...(options.displayedModel === undefined
              ? {}
              : { displayedModel: options.displayedModel }),
            repetition,
            startedAt: DateTime.formatIso(yield* DateTime.now),
          });
          if (
            options.captureAttempts === true &&
            (observation.run_id !== options.runId ||
              observation.case_id !== evalCase.id ||
              observation.repetition !== repetition)
          ) {
            return yield* new PublicEvalAttemptCaptureError({
              reasons: ["trial observation does not match the requested attempt"],
            });
          }
          observations.push(observation);
        }
      }

      const selectedSuite: PluginEvalSuite = { ...options.suite, cases };
      const observationSet = yield* decodePluginEvalObservationSet(
        {
          version: 1,
          manifest: {
            version: 1,
            run_id: options.runId,
            suite_id: selectedSuite.suite.id,
            suite_version: selectedSuite.version,
            catalog_version: selectedSuite.suite.catalog_version,
            allowed_tools: listCatalogToolNames(),
            candidate: options.candidate,
            target: options.target,
            model: options.model,
            ...(options.displayedModel === undefined
              ? {}
              : { displayed_model: options.displayedModel }),
            reasoning: options.reasoning,
            started_at: startedAt,
            repetitions: options.repetitions,
            clean_chat: true,
            account_class: options.accountClass,
            artifact_policy: "sanitized",
          },
          observations,
        },
        "live-memory",
      );
      const { report, attempts } = yield* replayPluginEvalObservationSet(
        selectedSuite,
        observationSet,
        {
          captureAttempts: options.captureAttempts === true,
        },
      );
      const sanitizedReport = yield* makeSanitizedEvalRunReport({
        suiteId: selectedSuite.suite.id,
        suiteVersion: selectedSuite.version,
        fixtureVersion: observationSet.version,
        catalogSha,
        manifest: observationSet.manifest,
        report,
      });
      return {
        report: sanitizedReport,
        attempts,
        ...(options.requestedRouting === undefined
          ? {}
          : { requestedRouting: options.requestedRouting }),
      };
    }),
);
