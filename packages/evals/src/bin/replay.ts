#!/usr/bin/env bun

import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import type { PublicEvalAttemptCapture } from "@askgina/contracts";
import { Console, Data, Effect, FileSystem, Layer, Path, Schema } from "effect";

import {
  assertPublicEvalAttemptOutputPath,
  makePublicEvalAttemptCapture,
  writePublicEvalAttemptCapture,
} from "../public-attempts";
import { makeSanitizedEvalRunReport } from "../report";
import { runHermeticEvalReplay } from "../runner";

interface ReplayCliOptions {
  readonly suitePath: string;
  readonly observationsPath: string;
  readonly outputPath?: string;
  readonly attemptsOutputPath?: string;
}

class ReplayCliArgumentError extends Data.TaggedError("ReplayCliArgumentError")<{}> {}
class ReplayCliEncodeError extends Data.TaggedError("ReplayCliEncodeError")<{}> {}
class ReplayCliWriteError extends Data.TaggedError("ReplayCliWriteError")<{}> {}

const JsonReport = Schema.fromJsonString(Schema.Unknown, { space: 2 });

const usage =
  "Usage: bun run eval:replay -- --suite <suite.yaml> --observations <observations.yaml> [--output <new-report.json> [--attempts-output <new-attempts.json>]]";

const parseOptions = (
  argv: readonly string[],
): Effect.Effect<ReplayCliOptions, ReplayCliArgumentError> =>
  Effect.gen(function* () {
    let suitePath: string | undefined;
    let observationsPath: string | undefined;
    let outputPath: string | undefined;
    let attemptsOutputPath: string | undefined;

    for (let index = 0; index < argv.length; index += 1) {
      const flag = argv[index];
      const value = argv[index + 1];
      if (value === undefined || value.trim().length === 0 || value.startsWith("--")) {
        return yield* new ReplayCliArgumentError();
      }
      if (flag === "--suite" && suitePath === undefined) suitePath = value;
      else if (flag === "--observations" && observationsPath === undefined)
        observationsPath = value;
      else if (flag === "--output" && outputPath === undefined) outputPath = value;
      else if (flag === "--attempts-output" && attemptsOutputPath === undefined) {
        attemptsOutputPath = value;
      } else return yield* new ReplayCliArgumentError();
      index += 1;
    }

    if (suitePath === undefined || observationsPath === undefined) {
      return yield* new ReplayCliArgumentError();
    }
    if (outputPath === undefined) {
      // The companion hash binds to saved report bytes, so it needs a saved report.
      if (attemptsOutputPath !== undefined) return yield* new ReplayCliArgumentError();
      return { suitePath, observationsPath };
    }
    return attemptsOutputPath === undefined
      ? { suitePath, observationsPath, outputPath }
      : { suitePath, observationsPath, outputPath, attemptsOutputPath };
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
    const output = paths.resolve(outputPath);
    yield* fs
      .makeDirectory(paths.dirname(output), { recursive: true })
      .pipe(Effect.mapError(() => new ReplayCliWriteError()));
    yield* fs
      .writeFileString(output, content, { flag: "wx", mode: 0o600 })
      .pipe(Effect.mapError(() => new ReplayCliWriteError()));
  });

const run = (options: ReplayCliOptions) =>
  Effect.gen(function* () {
    if (options.outputPath !== undefined && options.attemptsOutputPath !== undefined) {
      yield* assertPublicEvalAttemptOutputPath(options.attemptsOutputPath, options.outputPath);
    }
    const replay = yield* runHermeticEvalReplay({
      suitePath: options.suitePath,
      observationsPath: options.observationsPath,
      captureAttempts: options.attemptsOutputPath !== undefined,
    });
    const report = yield* makeSanitizedEvalRunReport({
      ...replay,
    });
    const encoded = yield* encodeReport(report);
    if (options.outputPath === undefined) {
      yield* Console.log(encoded.trimEnd());
      return;
    }
    let capture: PublicEvalAttemptCapture | undefined;
    if (options.attemptsOutputPath !== undefined) {
      if (replay.attempts === null) return yield* new ReplayCliEncodeError();
      capture = yield* makePublicEvalAttemptCapture({
        runId: report.runId,
        reportContent: encoded,
        attempts: replay.attempts,
      });
    }
    yield* writeReport(options.outputPath, encoded);
    if (options.attemptsOutputPath !== undefined && capture !== undefined) {
      yield* writePublicEvalAttemptCapture({
        outputPath: options.attemptsOutputPath,
        reportPath: options.outputPath,
        capture,
      });
    }
    yield* Console.log("sanitized eval report written");
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
