import { catalogSha, type PublicEvalAttemptSummary } from "@askgina/contracts";
import { Effect, FileSystem, Path } from "effect";

import type { PluginEvalReplayReport, PluginEvalRunManifest } from "./contracts";
import {
  loadPluginEvalObservationSet,
  type PluginEvalObservationSetParseError,
  type PluginEvalObservationSetReadError,
  type PluginEvalObservationSetValidationError,
} from "./load-observations";
import {
  loadPluginEvalSuite,
  type PluginEvalSuiteParseError,
  type PluginEvalSuiteReadError,
  type PluginEvalSuiteValidationError,
} from "./load-suite";
import type { PluginEvalObservationMismatchError } from "./grading";
import { replayPluginEvalObservationSet, type PluginEvalReplayContractError } from "./replay";
import type { PublicEvalAttemptCaptureError } from "./public-attempts";

export interface HermeticEvalReplayOptions {
  readonly suitePath: string;
  readonly observationsPath: string;
  readonly captureAttempts?: boolean;
}

export interface HermeticEvalReplayResult {
  readonly suiteId: string;
  readonly suiteVersion: number;
  readonly fixtureVersion: number;
  readonly catalogSha: string;
  readonly manifest: PluginEvalRunManifest;
  readonly report: PluginEvalReplayReport;
  readonly attempts: readonly PublicEvalAttemptSummary[] | null;
}

export type HermeticEvalReplayError =
  | PluginEvalSuiteReadError
  | PluginEvalSuiteParseError
  | PluginEvalSuiteValidationError
  | PluginEvalObservationSetReadError
  | PluginEvalObservationSetParseError
  | PluginEvalObservationSetValidationError
  | PluginEvalReplayContractError
  | PluginEvalObservationMismatchError
  | PublicEvalAttemptCaptureError;

/**
 * Replays only caller-selected local YAML fixtures. The program has no network,
 * environment-variable, credential, or authenticated-client inputs.
 */
export const runHermeticEvalReplay = ({
  suitePath,
  observationsPath,
  captureAttempts = false,
}: HermeticEvalReplayOptions): Effect.Effect<
  HermeticEvalReplayResult,
  HermeticEvalReplayError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const [suite, observationSet] = yield* Effect.all([
      loadPluginEvalSuite(suitePath),
      loadPluginEvalObservationSet(observationsPath),
    ]);
    const { report, attempts } = yield* replayPluginEvalObservationSet(suite, observationSet, {
      captureAttempts,
    });

    return {
      suiteId: suite.suite.id,
      suiteVersion: suite.version,
      fixtureVersion: observationSet.version,
      catalogSha,
      manifest: observationSet.manifest,
      report,
      attempts,
    } satisfies HermeticEvalReplayResult;
  });
