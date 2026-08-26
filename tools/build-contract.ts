#!/usr/bin/env bun

import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import { ChildProcess } from "effect/unstable/process";
import { Crypto, Data, Effect, FileSystem, Layer, Path, Schema, Stream } from "effect";

const CONTRACT_SOURCE = "packages/contracts/src/index.ts";
const CONTRACT_OUTPUTS = [
  "packages/contracts/dist/index.d.ts",
  "packages/contracts/dist/index.js",
  "packages/contracts/dist/index.js.map",
] as const;
const RECEIPT_PATH = "dist/receipts/contract.json";
const SHA_256 = /^[a-f0-9]{64}$/u;
const GIT_COMMIT = /^[a-f0-9]{40}$/u;

export class BuildContractError extends Data.TaggedError("BuildContractError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

type ContractReceipt = Readonly<{
  readonly schemaVersion: "v1";
  readonly releaseVersion: string;
  readonly sourceCommit: string;
  readonly catalogSha: string;
  readonly files: readonly Readonly<{ readonly path: string; readonly sha256: string }>[];
}>;

const stableJson = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const fail = (message: string, cause?: unknown) =>
  new BuildContractError(cause === undefined ? { message } : { message, cause });

const readJson = (file: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const text = yield* fs
      .readFileString(file)
      .pipe(Effect.mapError((cause) => fail(`cannot read ${file}`, cause)));
    return yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(text).pipe(
      Effect.mapError((cause) => fail(`cannot parse ${file}`, cause)),
    );
  });

const requiredString = (value: unknown, label: string) =>
  typeof value === "string" && value.length > 0
    ? Effect.succeed(value)
    : Effect.fail(fail(`${label} must be a non-empty string`));

const commandOutput = (command: string, args: readonly string[], cwd: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const process = yield* ChildProcess.make(command, args, { cwd }).pipe(
        Effect.mapError((cause) => fail(`cannot start ${command}`, cause)),
      );
      const chunks = yield* process.stdout.pipe(
        Stream.decodeText(),
        Stream.runCollect,
        Effect.mapError((cause) => fail(`cannot read ${command} output`, cause)),
      );
      const exitCode = yield* process.exitCode.pipe(
        Effect.mapError((cause) => fail(`cannot wait for ${command}`, cause)),
      );
      return exitCode === 0 ? chunks.join("") : yield* fail(`${command} exited with ${exitCode}`);
    }),
  );

const sourceCommit = (root: string) =>
  commandOutput("git", ["rev-parse", "--verify", "HEAD"], root).pipe(
    Effect.flatMap((stdout) => {
      const commit = stdout.trim();
      return GIT_COMMIT.test(commit)
        ? Effect.succeed(commit)
        : Effect.fail(fail("unable to determine the immutable source commit"));
    }),
  );

export const buildContractReceipt = (root: string) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const crypto = yield* Crypto.Crypto;
    const rootPackage = yield* readJson(path.join(root, "package.json"));
    const releaseVersion = yield* requiredString(
      isObject(rootPackage) ? rootPackage.version : undefined,
      "root package version",
    );
    const sourcePath = path.join(root, CONTRACT_SOURCE);
    const fs = yield* FileSystem.FileSystem;
    const source = yield* fs
      .readFileString(sourcePath)
      .pipe(Effect.mapError((cause) => fail(`cannot read ${CONTRACT_SOURCE}`, cause)));
    const declaredVersion = source.match(/export const RELEASE_VERSION = "([^"\\]+)"/u)?.[1];
    const catalogSha = source.match(/export const catalogSha = "([a-f0-9]{64})"/u)?.[1];
    if (declaredVersion !== releaseVersion) {
      return yield* fail("contracts RELEASE_VERSION must equal the root package version");
    }
    if (catalogSha === undefined || !SHA_256.test(catalogSha)) {
      return yield* fail("contracts catalogSha must be a SHA-256 digest");
    }
    const outputDirectory = path.join(root, "packages/contracts/dist");
    const outputNames = (yield* fs
      .readDirectory(outputDirectory)
      .pipe(
        Effect.mapError((cause) => fail("cannot list compiled contract output", cause)),
      )).sort();
    if (outputNames.join("\n") !== CONTRACT_OUTPUTS.map((file) => path.basename(file)).join("\n")) {
      return yield* fail("compiled contract output is missing or unexpected");
    }
    const files = yield* Effect.forEach(CONTRACT_OUTPUTS, (file) =>
      Effect.gen(function* () {
        const absolute = path.join(root, file);
        const symbolicLink = yield* fs
          .readLink(absolute)
          .pipe(Effect.match({ onFailure: () => false, onSuccess: () => true }));
        if (symbolicLink)
          return yield* fail(`compiled contract output is a symbolic link: ${file}`);
        const info = yield* fs
          .stat(absolute)
          .pipe(Effect.mapError((cause) => fail(`cannot inspect ${file}`, cause)));
        if (info.type !== "File")
          return yield* fail(`compiled contract output is not a file: ${file}`);
        const bytes = yield* fs
          .readFile(absolute)
          .pipe(Effect.mapError((cause) => fail(`cannot read ${file}`, cause)));
        const sha256 = toHex(
          yield* crypto
            .digest("SHA-256", bytes)
            .pipe(Effect.mapError((cause) => fail(`cannot hash ${file}`, cause))),
        );
        return { path: file, sha256 };
      }),
    );
    return {
      schemaVersion: "v1",
      releaseVersion,
      sourceCommit: yield* sourceCommit(root),
      catalogSha,
      files: files,
    } satisfies ContractReceipt;
  });

const program = Effect.gen(function* () {
  if (process.argv.slice(2).length > 0) {
    return yield* fail("build-contract accepts no arguments");
  }
  const root = process.cwd();
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  const output = path.join(root, RECEIPT_PATH);
  const dist = path.join(root, "dist");
  if (path.relative(dist, output).startsWith("..")) {
    return yield* fail("contract receipt must remain below dist/");
  }
  const receipt = yield* buildContractReceipt(root);
  yield* fs
    .makeDirectory(path.dirname(output), { recursive: true })
    .pipe(Effect.mapError((cause) => fail("cannot create receipt directory", cause)));
  yield* fs
    .writeFileString(output, stableJson(receipt))
    .pipe(Effect.mapError((cause) => fail("cannot write contract receipt", cause)));
});

const main = Layer.build(BunServices.layer).pipe(
  Effect.flatMap((context) => program.pipe(Effect.provide(context))),
  Effect.scoped,
);

BunRuntime.runMain(main);
