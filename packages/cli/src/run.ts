import type { AskGinaError, AskGinaTransport } from "@askgina/sdk";
import { Console, Effect } from "effect";
import { CliError, Command } from "effect/unstable/cli";

import { makeAskGinaCommand } from "./command";

export type AskGinaCliOptions = {
  readonly argv: ReadonlyArray<string>;
  readonly transport?: AskGinaTransport;
};

export const AskGinaCliExitCode = {
  Usage: 1,
  AskGinaJsonArgsError: 2,
  AskGinaAuthError: 3,
  AskGinaToolError: 4,
  AskGinaTransportError: 5,
} as const;

export type AskGinaParseFailure = {
  readonly error: string;
};

const isAskGinaParseFailure = (error: unknown): error is AskGinaParseFailure =>
  typeof error === "object" &&
  error !== null &&
  !("_tag" in error) &&
  "error" in error &&
  typeof error.error === "string";

const reportTaggedFailure = (tag: string, code: number, message: string) =>
  Effect.gen(function* () {
    yield* Console.error(`${tag}: ${message}`);
    return code;
  });

export const recoverAskGinaCliFailures = <A, R>(
  effect: Effect.Effect<A, AskGinaError | AskGinaParseFailure, R>,
) =>
  effect.pipe(
    Effect.catchTags({
      AskGinaJsonArgsError: (error) =>
        reportTaggedFailure(
          "AskGinaJsonArgsError",
          AskGinaCliExitCode.AskGinaJsonArgsError,
          error.message,
        ),
      AskGinaAuthError: (error) =>
        reportTaggedFailure("AskGinaAuthError", AskGinaCliExitCode.AskGinaAuthError, error.message),
      AskGinaToolError: (error) =>
        reportTaggedFailure("AskGinaToolError", AskGinaCliExitCode.AskGinaToolError, error.message),
      AskGinaTransportError: (error) =>
        reportTaggedFailure(
          "AskGinaTransportError",
          AskGinaCliExitCode.AskGinaTransportError,
          error.message,
        ),
    }),
    Effect.catchIf(isAskGinaParseFailure, (failure) =>
      Effect.gen(function* () {
        yield* Console.error(failure.error);
        return AskGinaCliExitCode.Usage;
      }),
    ),
  );

const cliErrorMessage = (error: CliError.CliError): string => {
  if (error._tag === "ShowHelp" && error.errors.length > 0) {
    return error.errors.map((cause) => cause.message).join("\n");
  }
  return error.message;
};

const toExitCode = <E, R>(effect: Effect.Effect<void, E | CliError.CliError, R>) =>
  effect.pipe(
    Effect.as(0),
    Effect.mapError((error): E | AskGinaParseFailure =>
      CliError.isCliError(error) ? { error: cliErrorMessage(error) } : error,
    ),
  );

const runnerConfig = {
  version: "0.1.0",
  renderErrors: false,
} as const;

export const runAskGinaCli = (options: AskGinaCliOptions) =>
  toExitCode(
    Command.runWith(
      makeAskGinaCommand({ transport: options.transport }),
      runnerConfig,
    )(options.argv.slice(1)),
  );

export const runAskGinaCliFromStdio = (transport?: AskGinaTransport) =>
  toExitCode(Command.run(makeAskGinaCommand({ transport }), runnerConfig));
