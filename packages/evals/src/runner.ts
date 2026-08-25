import { catalogSha } from "@askgina/contracts";
import { Effect, FileSystem, Path } from "effect";

import type { PluginEvalReplayReport, PluginEvalRunManifest } from "./contracts.js";
import {
  loadPluginEvalObservationSet,
  type PluginEvalObservationSetParseError,
  type PluginEvalObservationSetReadError,
  type PluginEvalObservationSetValidationError,
} from "./load-observations.js";
import {
  loadPluginEvalSuite,
  type PluginEvalSuiteParseError,
  type PluginEvalSuiteReadError,
  type PluginEvalSuiteValidationError,
} from "./load-suite.js";
import type { PluginEvalObservationMismatchError } from "./grading.js";
import { replayPluginEvalObservationSet, type PluginEvalReplayContractError } from "./replay.js";

export interface HermeticEvalReplayOptions {
  readonly suitePath: string;
  readonly observationsPath: string;
}

export interface HermeticEvalReplayResult {
  readonly suiteId: string;
  readonly suiteVersion: number;
  readonly fixtureVersion: number;
  readonly catalogSha: string;
  readonly manifest: PluginEvalRunManifest;
  readonly report: PluginEvalReplayReport;
}

export type HermeticEvalReplayError =
  | PluginEvalSuiteReadError
  | PluginEvalSuiteParseError
  | PluginEvalSuiteValidationError
  | PluginEvalObservationSetReadError
  | PluginEvalObservationSetParseError
  | PluginEvalObservationSetValidationError
  | PluginEvalReplayContractError
  | PluginEvalObservationMismatchError;

/**
 * Replays only caller-selected local YAML fixtures. The program has no network,
 * environment-variable, credential, or authenticated-client inputs.
 */
export const runHermeticEvalReplay = ({
  suitePath,
  observationsPath,
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
    const report = yield* replayPluginEvalObservationSet(suite, observationSet);

    return {
      suiteId: suite.suite.id,
      suiteVersion: suite.version,
      fixtureVersion: observationSet.version,
      catalogSha,
      manifest: observationSet.manifest,
      report,
    } satisfies HermeticEvalReplayResult;
  });
