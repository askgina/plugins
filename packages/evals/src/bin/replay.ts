#!/usr/bin/env bun

import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Console, Data, Effect, FileSystem, Layer, Path, Schema } from "effect";

import { makeSanitizedEvalRunReport } from "../report.js";
import { runHermeticEvalReplay } from "../runner.js";

interface ReplayCliOptions {
  readonly suitePath: string;
  readonly observationsPath: string;
  readonly outputPath?: string;
}

class ReplayCliArgumentError extends Data.TaggedError("ReplayCliArgumentError")<{}> {}
class ReplayCliEncodeError extends Data.TaggedError("ReplayCliEncodeError")<{}> {}
class ReplayCliWriteError extends Data.TaggedError("ReplayCliWriteError")<{}> {}

const JsonReport = Schema.fromJsonString(Schema.Unknown, { space: 2 });

const usage =
  "Usage: bun run evals:plugin -- --suite <suite.yaml> --observations <observations.yaml> [--output <new-report.json>]";

const parseOptions = (
  argv: readonly string[],
): Effect.Effect<ReplayCliOptions, ReplayCliArgumentError> =>
  Effect.gen(function* () {
    let suitePath: string | undefined;
    let observationsPath: string | undefined;
    let outputPath: string | undefined;

    for (let index = 0; index < argv.length; index += 1) {
      const flag = argv[index];
      const value = argv[index + 1];
      if (value === undefined) return yield* new ReplayCliArgumentError();
      if (flag === "--suite") suitePath = value;
      else if (flag === "--observations") observationsPath = value;
      else if (flag === "--output") outputPath = value;
      else return yield* new ReplayCliArgumentError();
      index += 1;
    }

    if (suitePath === undefined || observationsPath === undefined) {
      return yield* new ReplayCliArgumentError();
    }
    return outputPath === undefined
      ? { suitePath, observationsPath }
      : { suitePath, observationsPath, outputPath };
  });

const encodeReport = (value: unknown) =>
  Schema.encodeUnknownEffect(JsonReport)(value).pipe(
    Effect.map((encoded) => `${encoded}\n`),
    Effect.mapError(() => new ReplayCliEncodeError()),
  );

const writeReport = (outputPath: string, content: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;
    yield* fs
      .makeDirectory(paths.dirname(outputPath), { recursive: true })
      .pipe(Effect.mapError(() => new ReplayCliWriteError()));
    yield* fs
      .writeFileString(outputPath, content, { flag: "wx", mode: 0o600 })
      .pipe(Effect.mapError(() => new ReplayCliWriteError()));
  });

const run = (options: ReplayCliOptions) =>
  Effect.gen(function* () {
    const replay = yield* runHermeticEvalReplay({
      suitePath: options.suitePath,
      observationsPath: options.observationsPath,
    });
    const report = yield* makeSanitizedEvalRunReport({
      ...replay,
    });
    const encoded = yield* encodeReport(report);
    if (options.outputPath === undefined) yield* Console.log(encoded.trimEnd());
    else {
      yield* writeReport(options.outputPath, encoded);
      yield* Console.log("sanitized eval report written");
    }
  });

const errorTag = (error: unknown): string => {
  if (typeof error !== "object" || error === null || !("_tag" in error)) return "UnknownError";
  const tag = Reflect.get(error, "_tag");
  return typeof tag === "string" ? tag : "UnknownError";
};

const program: Effect.Effect<number, never, BunServices.BunServices> = parseOptions(
  process.argv.slice(2),
).pipe(
  Effect.flatMap(run),
  Effect.matchEffect({
    onFailure: (error) =>
      Console.error(
        errorTag(error) === "ReplayCliArgumentError"
          ? usage
          : `eval replay failed (${errorTag(error)})`,
      ).pipe(Effect.as(1)),
    onSuccess: () => Effect.succeed(0),
  }),
  Effect.tap((code) =>
    Effect.sync(() => {
      if (code !== 0) process.exitCode = code;
    }),
  ),
);

const main = Effect.scoped(
  Effect.gen(function* () {
    const services = yield* Layer.build(BunServices.layer);
    return yield* Effect.provideContext(program, services);
  }),
);

BunRuntime.runMain(main);
