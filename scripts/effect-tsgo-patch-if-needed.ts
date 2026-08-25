#!/usr/bin/env bun

import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Console, Data, Effect, Layer, Path, Stream } from "effect";
import { ChildProcess } from "effect/unstable/process";

class EffectTsgoPatchError extends Data.TaggedError("EffectTsgoPatchError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const fail = (message: string, cause?: unknown) =>
  new EffectTsgoPatchError(cause === undefined ? { message } : { message, cause });

const runInherited = (command: string, args: readonly string[], cwd: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const process = yield* ChildProcess.make(command, args, {
        cwd,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      }).pipe(Effect.mapError((cause) => fail(`cannot start ${command}`, cause)));
      const exitCode = yield* process.exitCode.pipe(
        Effect.mapError((cause) => fail(`cannot wait for ${command}`, cause)),
      );
      if (exitCode !== 0) return yield* fail(`${command} exited with ${exitCode}`);
    }),
  );

const commandOutput = (command: string, args: readonly string[], cwd: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const process = yield* ChildProcess.make(command, args, { cwd }).pipe(
        Effect.mapError((cause) => fail(`cannot start ${command}`, cause)),
      );
      const output = yield* process.stdout.pipe(
        Stream.decodeText(),
        Stream.runCollect,
        Effect.map((chunks) => chunks.join("")),
        Effect.mapError((cause) => fail(`cannot read ${command} output`, cause)),
      );
      const exitCode = yield* process.exitCode.pipe(
        Effect.mapError((cause) => fail(`cannot wait for ${command}`, cause)),
      );
      return exitCode === 0 ? output : yield* fail(`${command} exited with ${exitCode}`);
    }),
  );

const patchVersion = "effect-tsgo.0.36.5";

const program = Effect.gen(function* () {
  const path = yield* Path.Path;
  const root = process.cwd();
  const tsc = path.join(root, "node_modules", ".bin", "tsc");
  const effectTsgo = path.join(root, "node_modules", ".bin", "effect-tsgo");

  yield* runInherited(effectTsgo, ["patch", "--typescript", "--oxlint"], root);
  const compilerVersion = (yield* commandOutput(tsc, ["--version"], root)).trim();
  if (!compilerVersion.includes(patchVersion)) {
    return yield* fail(
      `Effect TSGo patch verification failed: expected ${patchVersion}, received ${compilerVersion}`,
    );
  }
  yield* Console.log(compilerVersion);
});

const main = Effect.scoped(
  Effect.gen(function* () {
    const context = yield* Layer.build(BunServices.layer);
    return yield* program.pipe(Effect.provide(context));
  }),
);

BunRuntime.runMain(main);
