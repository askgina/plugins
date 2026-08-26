import { Data, Effect, FileSystem, Function, Path, Schema } from "effect";
import { parse as parseYaml } from "yaml";

import { type PluginEvalObservationSet, PluginEvalObservationSetSchema } from "./contracts";

export class PluginEvalObservationSetReadError extends Data.TaggedError(
  "PluginEvalObservationSetReadError",
)<{
  readonly path: string;
  readonly reason: string;
}> {}

export class PluginEvalObservationSetParseError extends Data.TaggedError(
  "PluginEvalObservationSetParseError",
)<{
  readonly path: string;
  readonly reason: string;
}> {}

export class PluginEvalObservationSetValidationError extends Data.TaggedError(
  "PluginEvalObservationSetValidationError",
)<{
  readonly path: string;
  readonly reasons: readonly string[];
}> {}

const parseObservationYaml = (
  source: string,
  path: string,
): Effect.Effect<unknown, PluginEvalObservationSetParseError> =>
  Effect.try({
    try: () => {
      const parsed: unknown = parseYaml(source, {
        logLevel: "silent",
        strict: true,
        uniqueKeys: true,
      });
      return parsed;
    },
    catch: (cause) => new PluginEvalObservationSetParseError({ path, reason: String(cause) }),
  });

const validateObservationSetInvariants = (
  observationSet: PluginEvalObservationSet,
  path: string,
): Effect.Effect<PluginEvalObservationSet, PluginEvalObservationSetValidationError> => {
  const reasons: string[] = [];
  const seenAttempts = new Set<string>();

  for (const observation of observationSet.observations) {
    const attemptKey = `${observation.case_id}#${observation.repetition}`;
    if (seenAttempts.has(attemptKey)) {
      reasons.push(`Duplicate observation attempt: ${attemptKey}`);
    }
    seenAttempts.add(attemptKey);

    if (observation.run_id !== observationSet.manifest.run_id) {
      reasons.push(`${attemptKey} run_id does not match the manifest`);
    }
    if (observation.target !== observationSet.manifest.target) {
      reasons.push(`${attemptKey} target does not match the manifest`);
    }
    if (observation.model !== observationSet.manifest.model) {
      reasons.push(`${attemptKey} model does not match the manifest`);
    }
    if (observation.repetition > observationSet.manifest.repetitions) {
      reasons.push(`${attemptKey} exceeds the manifest repetition count`);
    }
    if (observation.status === "completed" && observation.error !== undefined) {
      reasons.push(`${attemptKey} is completed but has a top-level error`);
    }
    if (observation.status !== "completed" && observation.error === undefined) {
      reasons.push(`${attemptKey} is ${observation.status} but has no top-level error`);
    }

    const hasStableSequence = observation.tool_calls.every(
      (call, index) => call.sequence === index,
    );
    if (!hasStableSequence) {
      reasons.push(`${attemptKey} tool-call sequence must be contiguous and zero-based`);
    }
  }

  return reasons.length === 0
    ? Effect.succeed(observationSet)
    : Effect.fail(new PluginEvalObservationSetValidationError({ path, reasons }));
};

export const decodePluginEvalObservationSet = Function.dual<
  (
    path: string,
  ) => (
    input: unknown,
  ) => Effect.Effect<PluginEvalObservationSet, PluginEvalObservationSetValidationError>,
  (
    input: unknown,
    path: string,
  ) => Effect.Effect<PluginEvalObservationSet, PluginEvalObservationSetValidationError>
>(2, (input, path) =>
  Schema.decodeUnknownEffect(PluginEvalObservationSetSchema, {
    errors: "all",
    onExcessProperty: "error",
  })(input).pipe(
    Effect.mapError(
      (cause) => new PluginEvalObservationSetValidationError({ path, reasons: [String(cause)] }),
    ),
    Effect.flatMap((observationSet) => validateObservationSetInvariants(observationSet, path)),
  ),
);

export const loadPluginEvalObservationSet = (
  path: string,
): Effect.Effect<
  PluginEvalObservationSet,
  | PluginEvalObservationSetReadError
  | PluginEvalObservationSetParseError
  | PluginEvalObservationSetValidationError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const normalizedPath = pathService.normalize(path);
    const source = yield* fs.readFileString(normalizedPath).pipe(
      Effect.mapError(
        (cause) =>
          new PluginEvalObservationSetReadError({
            path: normalizedPath,
            reason: String(cause),
          }),
      ),
    );
    const parsed = yield* parseObservationYaml(source, normalizedPath);
    return yield* decodePluginEvalObservationSet(parsed, normalizedPath);
  }).pipe(
    Effect.withSpan("plugin_evals.load_observations", {
      attributes: { "plugin_eval.observation_path": path },
    }),
  );
