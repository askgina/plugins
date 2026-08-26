import { Data, Effect, FileSystem, Function, Path, Schema } from "effect";
import { parse as parseYaml } from "yaml";

import { type PluginEvalCase, type PluginEvalSuite, PluginEvalSuiteSchema } from "./contracts";

export class PluginEvalSuiteReadError extends Data.TaggedError("PluginEvalSuiteReadError")<{
  readonly path: string;
  readonly reason: string;
}> {}

export class PluginEvalSuiteParseError extends Data.TaggedError("PluginEvalSuiteParseError")<{
  readonly path: string;
  readonly reason: string;
}> {}

export class PluginEvalSuiteValidationError extends Data.TaggedError(
  "PluginEvalSuiteValidationError",
)<{
  readonly path: string;
  readonly reasons: readonly string[];
}> {}

const parseSuiteYaml = (
  source: string,
  path: string,
): Effect.Effect<unknown, PluginEvalSuiteParseError> =>
  Effect.try({
    try: () => {
      const parsed: unknown = parseYaml(source, {
        logLevel: "silent",
        strict: true,
        uniqueKeys: true,
      });
      return parsed;
    },
    catch: (cause) => new PluginEvalSuiteParseError({ path, reason: String(cause) }),
  });

const expectedTools = (evalCase: PluginEvalCase): readonly string[] => {
  switch (evalCase.expected.routing.kind) {
    case "exact":
      return [evalCase.expected.routing.tool];
    case "one_of":
    case "sequence":
      return evalCase.expected.routing.tools;
    case "none":
      return [];
  }
};

const validateSuiteInvariants = (
  suite: PluginEvalSuite,
  path: string,
): Effect.Effect<PluginEvalSuite, PluginEvalSuiteValidationError> => {
  const reasons: string[] = [];
  const seenCaseIds = new Set<string>();

  for (const evalCase of suite.cases) {
    if (seenCaseIds.has(evalCase.id)) {
      reasons.push(`Duplicate case id: ${evalCase.id}`);
    }
    seenCaseIds.add(evalCase.id);

    const tools = expectedTools(evalCase);
    if (new Set(tools).size !== tools.length) {
      reasons.push(`Case ${evalCase.id} repeats a routing tool`);
    }

    const forbiddenTools = evalCase.expected.safety?.forbidden_tools ?? [];
    for (const tool of tools) {
      if (forbiddenTools.includes(tool)) {
        reasons.push(`Case ${evalCase.id} both expects and forbids ${tool}`);
      }
    }

    if (evalCase.expected.routing.kind === "none" && evalCase.expected.arguments !== undefined) {
      reasons.push(`Case ${evalCase.id} cannot grade arguments when routing expects no tool`);
    }
  }

  return reasons.length === 0
    ? Effect.succeed(suite)
    : Effect.fail(new PluginEvalSuiteValidationError({ path, reasons }));
};

export const decodePluginEvalSuite = Function.dual<
  (
    path: string,
  ) => (input: unknown) => Effect.Effect<PluginEvalSuite, PluginEvalSuiteValidationError>,
  (input: unknown, path: string) => Effect.Effect<PluginEvalSuite, PluginEvalSuiteValidationError>
>(2, (input, path) =>
  Schema.decodeUnknownEffect(PluginEvalSuiteSchema, {
    errors: "all",
    onExcessProperty: "error",
  })(input).pipe(
    Effect.mapError(
      (cause) => new PluginEvalSuiteValidationError({ path, reasons: [String(cause)] }),
    ),
    Effect.flatMap((suite) => validateSuiteInvariants(suite, path)),
  ),
);

export const loadPluginEvalSuite = (
  path: string,
): Effect.Effect<
  PluginEvalSuite,
  PluginEvalSuiteReadError | PluginEvalSuiteParseError | PluginEvalSuiteValidationError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const normalizedPath = pathService.normalize(path);
    const source = yield* fs
      .readFileString(normalizedPath)
      .pipe(
        Effect.mapError(
          (cause) => new PluginEvalSuiteReadError({ path: normalizedPath, reason: String(cause) }),
        ),
      );
    const parsed = yield* parseSuiteYaml(source, normalizedPath);
    return yield* decodePluginEvalSuite(parsed, normalizedPath);
  }).pipe(
    Effect.withSpan("plugin_evals.load_suite", {
      attributes: { "plugin_eval.suite_path": path },
    }),
  );
