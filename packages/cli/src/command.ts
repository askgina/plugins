import {
  AskGinaAuthError,
  AskGinaJsonArgsError,
  createClient,
  type AskGinaTransport,
} from "@askgina/sdk";
import { Config, Console, Effect, Option, Schema } from "effect";
import { Argument, CliError, Command } from "effect/unstable/cli";

export type AskGinaCommandOptions = {
  readonly transport?: AskGinaTransport;
};

const JsonArgsSchema = Schema.fromJsonString(Schema.JsonObject);
const JsonOutputSchema = Schema.fromJsonString(Schema.Unknown, { space: 2 });

const resolveAccessToken = () =>
  Effect.gen(function* () {
    const fromEnv = yield* Config.option(Config.string("ASK_GINA_ACCESS_TOKEN")).pipe(
      Effect.mapError(
        (cause) =>
          new AskGinaAuthError({
            message: `ASK_GINA_ACCESS_TOKEN is invalid: ${String(cause)}`,
          }),
      ),
    );
    return Option.match(fromEnv, {
      onNone: () => "",
      onSome: (value) => value.trim(),
    });
  });

const parseJsonArgs = (
  raw: Option.Option<string>,
): Effect.Effect<Record<string, unknown>, AskGinaJsonArgsError> => {
  if (Option.isNone(raw)) {
    return Effect.succeed({});
  }
  if (raw.value.trim().length === 0) {
    return new AskGinaJsonArgsError({
      message: "json-args must be a JSON object",
    });
  }
  return Schema.decodeEffect(JsonArgsSchema)(raw.value).pipe(
    Effect.mapError(
      () =>
        new AskGinaJsonArgsError({
          message: "json-args must be a JSON object",
        }),
    ),
  );
};

const writeJson = Effect.fnUntraced(function* (value: unknown) {
  const output = yield* Schema.encodeEffect(JsonOutputSchema)(value).pipe(Effect.orDie);
  yield* Console.log(output);
});

export const makeAskGinaCommand = (options: AskGinaCommandOptions = {}) => {
  const root = Command.make("ask-gina", {}, () =>
    CliError.UserError.make({
      cause: "Expected a subcommand: list, call, or ask",
      userMessage: "Expected a subcommand: list, call, or ask",
    }),
  ).pipe(Command.withDescription("Ask Gina from the terminal using the repository-owned SDK"));

  const list = Command.make("list", {}, () =>
    Effect.gen(function* () {
      const client = createClient({
        accessToken: yield* resolveAccessToken(),
        transport: options.transport,
      });
      yield* writeJson(yield* client.listTools());
    }),
  ).pipe(
    Command.withDescription("List catalog-allowed Ask Gina read tools from the production MCP"),
  );

  const makeCallCommand = (name: "call" | "ask", description: string) =>
    Command.make(
      name,
      {
        tool: Argument.string("tool").pipe(Argument.withDescription("Catalog tool name")),
        jsonArgs: Argument.string("json-args").pipe(
          Argument.optional,
          Argument.withDescription("JSON object of tool arguments"),
        ),
      },
      ({ jsonArgs, tool }) =>
        Effect.gen(function* () {
          const args = yield* parseJsonArgs(jsonArgs);
          const client = createClient({
            accessToken: yield* resolveAccessToken(),
            transport: options.transport,
          });
          yield* writeJson(yield* client.callTool(tool, args));
        }),
    ).pipe(Command.withDescription(description));

  return root.pipe(
    Command.withSubcommands([
      list,
      makeCallCommand("call", "Call one catalog-allowed Ask Gina read tool"),
      makeCallCommand("ask", "Alias for call"),
    ]),
  );
};
