#!/usr/bin/env bun

import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Effect, Layer } from "effect";

import { recoverAskGinaCliFailures, runAskGinaCliFromStdio } from "./src/run.js";

const program: Effect.Effect<number, never, BunServices.BunServices> = recoverAskGinaCliFailures(
  runAskGinaCliFromStdio(),
).pipe(
  Effect.tap((code) =>
    Effect.sync(() => {
      if (code !== 0) {
        process.exitCode = code;
      }
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
