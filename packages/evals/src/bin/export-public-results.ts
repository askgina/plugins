#!/usr/bin/env bun

import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Console, Data, Effect, FileSystem, Layer, Option, Path, Schema } from "effect";

import { makePublicEvalResult, PublicEvalResultError } from "../public-results";
import {
  decodePublicEvalExportRequest,
  exportPublicEvalPublication,
  makePublicEvalResultPublication,
  makePublicEvalWithdrawalPublication,
  PublicEvalPublicationError,
  readPublicEvalIndex,
} from "../publication";

class ExportCliError extends Data.TaggedError("ExportCliError")<{
  readonly reason:
    | "arguments"
    | "input_unreadable"
    | "invalid_json"
    | "private_input_in_output"
    | "unknown_publication";
}> {}

const UnknownJson = Schema.fromJsonString(Schema.Unknown);
const decodeUnknownJson = Schema.decodeEffect(UnknownJson);
const encodeUnknownJson = Schema.encodeUnknownEffect(UnknownJson);

const usage =
  "Usage: bun packages/evals/dist/bin/export-public-results.js --manifest <request.json> --output-dir <public-directory> [--report <private-report.json> [--attempts <private-attempts.json>] [--configuration <private-configuration.json>]]";
interface Options {
  readonly manifest: string;
  readonly outputDirectory: string;
  readonly report?: string;
  readonly attempts?: string;
  readonly configuration?: string;
}

const parseOptions = (argv: readonly string[]): Effect.Effect<Options, ExportCliError> =>
  Effect.gen(function* () {
    const flags: Record<string, string> = {};
    for (let i = 0; i < argv.length; i += 2) {
      const flag = argv[i];
      const value = argv[i + 1];
      if (
        flag === undefined ||
        !["--manifest", "--output-dir", "--report", "--attempts", "--configuration"].includes(
          flag,
        ) ||
        Object.hasOwn(flags, flag) ||
        value === undefined ||
        value.trim().length === 0 ||
        value.startsWith("--") ||
        value.includes("\0")
      ) {
        return yield* new ExportCliError({ reason: "arguments" });
      }
      flags[flag] = value;
    }
    const manifest = flags["--manifest"];
    const outputDirectory = flags["--output-dir"];
    if (manifest === undefined || outputDirectory === undefined)
      return yield* new ExportCliError({ reason: "arguments" });
    return {
      manifest,
      outputDirectory,
      ...(flags["--report"] === undefined ? {} : { report: flags["--report"] }),
      ...(flags["--attempts"] === undefined ? {} : { attempts: flags["--attempts"] }),
      ...(flags["--configuration"] === undefined
        ? {}
        : { configuration: flags["--configuration"] }),
    };
  });

const run = (options: Options) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    // A report, capture, configuration or request must never already be inside the
    // directory offered to the static consumer, even through a path alias.
    const lexicalOutput = path.resolve(options.outputDirectory);
    let ancestor = lexicalOutput;
    const suffix: string[] = [];
    while (
      !(yield* fs
        .exists(ancestor)
        .pipe(Effect.mapError(() => new ExportCliError({ reason: "input_unreadable" }))))
    ) {
      suffix.unshift(path.basename(ancestor));
      const parent = path.dirname(ancestor);
      if (parent === ancestor) return yield* new ExportCliError({ reason: "input_unreadable" });
      ancestor = parent;
    }
    const output = path.join(
      yield* fs
        .realPath(ancestor)
        .pipe(Effect.mapError(() => new ExportCliError({ reason: "input_unreadable" }))),
      ...suffix,
    );
    const readPrivate = (filename: string) =>
      Effect.gen(function* () {
        const lexicalInput = path.resolve(filename);
        if (
          lexicalInput === lexicalOutput ||
          lexicalInput.startsWith(`${lexicalOutput}${path.sep}`) ||
          lexicalInput === output ||
          lexicalInput.startsWith(`${output}${path.sep}`)
        ) {
          return yield* new ExportCliError({ reason: "private_input_in_output" });
        }
        const resolved = yield* fs
          .realPath(filename)
          .pipe(Effect.mapError(() => new ExportCliError({ reason: "input_unreadable" })));
        if (resolved === output || resolved.startsWith(`${output}${path.sep}`))
          return yield* new ExportCliError({ reason: "private_input_in_output" });
        const info = yield* fs
          .stat(resolved)
          .pipe(Effect.mapError(() => new ExportCliError({ reason: "input_unreadable" })));
        if (info.type !== "File" || Option.getOrElse(info.nlink, () => 1) !== 1)
          return yield* new ExportCliError({ reason: "input_unreadable" });
        const bytes = yield* fs
          .readFile(resolved)
          .pipe(Effect.mapError(() => new ExportCliError({ reason: "input_unreadable" })));
        return yield* Effect.try({
          try: () => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes),
          catch: () => new ExportCliError({ reason: "input_unreadable" }),
        });
      });
    const manifestText = yield* readPrivate(options.manifest);
    const manifest = yield* decodeUnknownJson(manifestText).pipe(
      Effect.mapError(() => new ExportCliError({ reason: "invalid_json" })),
      Effect.flatMap(decodePublicEvalExportRequest),
    );
    let publication;
    if (manifest.kind === "withdrawal") {
      if (
        options.report !== undefined ||
        options.attempts !== undefined ||
        options.configuration !== undefined
      )
        return yield* new ExportCliError({ reason: "arguments" });
      const index = yield* readPublicEvalIndex({
        outputDirectory: options.outputDirectory,
        dataOrigin: manifest.dataOrigin,
        ...(manifest.notice.reason === "privacy"
          ? { privacyWithdrawalPublicationId: manifest.publicationId }
          : {}),
      });
      const entry = index?.publications.find(
        (item) => item.publicationId === manifest.publicationId,
      );
      if (entry === undefined) return yield* new ExportCliError({ reason: "unknown_publication" });
      publication = yield* makePublicEvalWithdrawalPublication(manifest, entry.runId);
    } else {
      if (options.report === undefined) return yield* new ExportCliError({ reason: "arguments" });
      const reportJson = yield* readPrivate(options.report);
      const attemptCaptureJson =
        options.attempts === undefined ? undefined : yield* readPrivate(options.attempts);
      const configurationJson =
        options.configuration === undefined ? undefined : yield* readPrivate(options.configuration);
      const result = yield* makePublicEvalResult({
        reportJson,
        resultId: manifest.resultId,
        dataOrigin: manifest.dataOrigin,
        expectedProvenance: manifest.expectedProvenance,
        ...(attemptCaptureJson === undefined ? {} : { attemptCaptureJson }),
        ...(configurationJson === undefined ? {} : { configurationJson }),
        ...(manifest.declaredCoverage === undefined
          ? {}
          : { declaredCoverage: manifest.declaredCoverage }),
        ...(manifest.withholdAttempts === undefined
          ? {}
          : { withholdAttempts: manifest.withholdAttempts }),
      });
      publication = yield* makePublicEvalResultPublication(manifest, result);
    }
    const exported = yield* exportPublicEvalPublication({
      publication,
      outputDirectory: options.outputDirectory,
    });
    yield* encodeUnknownJson(exported).pipe(
      Effect.flatMap(Console.log),
      Effect.mapError(() => new ExportCliError({ reason: "invalid_json" })),
    );
  });

const program =
  process.argv.length === 3 && process.argv[2] === "--help"
    ? Console.log(usage).pipe(Effect.as(0))
    : parseOptions(process.argv.slice(2)).pipe(
        Effect.flatMap(run),
        Effect.matchEffect({
          onSuccess: () => Effect.succeed(0),
          onFailure: (failure) =>
            Console.error(
              failure instanceof ExportCliError && failure.reason === "arguments"
                ? usage
                : failure instanceof ExportCliError ||
                    failure instanceof PublicEvalPublicationError ||
                    failure instanceof PublicEvalResultError
                  ? `public eval export failed (${failure.reason})`
                  : "public eval export failed",
            ).pipe(Effect.as(1)),
        }),
        // Defects and interrupted cleanup must not make BunRuntime print source data.
        Effect.catchCause(() => Console.error("public eval export failed").pipe(Effect.as(1))),
      );

BunRuntime.runMain(
  Effect.scoped(
    Effect.gen(function* () {
      const services = yield* Layer.build(BunServices.layer);
      const code = yield* Effect.provideContext(program, services);
      if (code !== 0) process.exitCode = code;
    }),
  ),
);
