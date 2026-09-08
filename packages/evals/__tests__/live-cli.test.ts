import * as BunPath from "@effect/platform-bun/BunPath";
import * as BunServices from "@effect/platform-bun/BunServices";
import { assert, describe, it } from "@effect/vitest";
import { Config, ConfigProvider, Effect } from "effect";
import { ChildProcess } from "effect/unstable/process";

import { collectBoundedUtf8Output } from "../src/bounded-output";

import {
  DEFAULT_CLAUDE_MAX_TURNS,
  DEFAULT_OPENROUTER_MAX_STEPS,
  formatLiveEvalCliFailure,
  formatLiveEvalCliUsage,
  liveEvalTrialDispatch,
  loadLiveEvalCredentials,
  parseLiveEvalCliOptions,
} from "../src/bin/live";

const requiredFlags = (runner: string, extra: readonly string[] = []): readonly string[] => [
  "--runner",
  runner,
  "--suite",
  "suite.yaml",
  "--run-id",
  "run-1",
  "--candidate",
  "cand-1",
  "--model",
  "test-model",
  "--reasoning",
  "medium",
  "--repetitions",
  "3",
  "--account-class",
  "local",
  "--timeout-ms",
  "120000",
  ...extra,
];

const withEnv =
  (env: Record<string, string>) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv({ env })),
    );

describe("live eval CLI parser", () => {
  it.effect("prints runner-aware help without required flags", () =>
    Effect.gen(function* () {
      const parsed = yield* parseLiveEvalCliOptions(["--help"]);
      assert.strictEqual(parsed.mode, "help");
      if (parsed.mode === "help") {
        assert.include(parsed.usage, "eval:<responses|codex|openrouter|claude>");
        assert.include(parsed.usage, "ASK_GINA_ACCESS_TOKEN");
        assert.include(parsed.usage, "OPENROUTER_API_KEY");
        assert.include(parsed.usage, "ANTHROPIC_API_KEY");
        assert.include(parsed.usage, "CLAUDE_EVAL_EXECUTABLE");
        assert.notInclude(parsed.usage, "=");
      }
    }),
  );

  it.effect("scopes help to the selected runner", () =>
    Effect.gen(function* () {
      const parsed = yield* parseLiveEvalCliOptions(["--runner", "openrouter", "--help"]);
      assert.strictEqual(parsed.mode, "help");
      if (parsed.mode === "help") {
        assert.include(parsed.usage, "eval:openrouter");
        assert.include(parsed.usage, "OPENROUTER_API_KEY");
        assert.include(parsed.usage, "--max-steps");
        assert.notInclude(parsed.usage, "OPENAI_API_KEY");
        assert.notInclude(parsed.usage, "CLAUDE_EVAL_EXECUTABLE");
      }
    }),
  );

  it.effect("parses all four runners and preserves existing required flags", () =>
    Effect.gen(function* () {
      const responses = yield* parseLiveEvalCliOptions(requiredFlags("responses"));
      assert.strictEqual(responses.mode, "run");
      if (responses.mode === "run") {
        assert.strictEqual(responses.options.runner, "responses");
        assert.strictEqual(responses.options.model, "test-model");
        assert.strictEqual(responses.options.reasoning, "medium");
        assert.strictEqual(responses.options.repetitions, 3);
        assert.notProperty(responses.options, "maxSteps");
        assert.notProperty(responses.options, "maxTurns");
      }

      const openrouter = yield* parseLiveEvalCliOptions(requiredFlags("openrouter"));
      assert.strictEqual(openrouter.mode, "run");
      if (openrouter.mode === "run" && openrouter.options.runner === "openrouter") {
        assert.strictEqual(openrouter.options.maxSteps, DEFAULT_OPENROUTER_MAX_STEPS);
      }

      const claude = yield* parseLiveEvalCliOptions(requiredFlags("claude"));
      assert.strictEqual(claude.mode, "run");
      if (claude.mode === "run" && claude.options.runner === "claude") {
        assert.strictEqual(claude.options.maxTurns, DEFAULT_CLAUDE_MAX_TURNS);
      }

      const codex = yield* parseLiveEvalCliOptions(
        requiredFlags("codex", [
          "--attempts-output",
          "attempts.json",
          "--case",
          "list-scheduled-prompts",
        ]),
      );
      assert.strictEqual(codex.mode, "run");
      if (codex.mode === "run") {
        assert.strictEqual(codex.options.runner, "codex");
        assert.strictEqual(codex.options.attemptsOutputPath, "attempts.json");
        assert.deepStrictEqual(codex.options.caseIds, ["list-scheduled-prompts"]);
      }
    }),
  );

  it.effect("accepts bounded OpenRouter and Claude budgets", () =>
    Effect.gen(function* () {
      const steps = yield* parseLiveEvalCliOptions(
        requiredFlags("openrouter", ["--max-steps", "32"]),
      );
      assert.strictEqual(steps.mode, "run");
      if (steps.mode === "run" && steps.options.runner === "openrouter") {
        assert.strictEqual(steps.options.maxSteps, 32);
      }
      const turns = yield* parseLiveEvalCliOptions(requiredFlags("claude", ["--max-turns", "1"]));
      assert.strictEqual(turns.mode, "run");
      if (turns.mode === "run" && turns.options.runner === "claude") {
        assert.strictEqual(turns.options.maxTurns, 1);
      }
    }),
  );

  it.effect("rejects irrelevant budgets and values outside 1..32", () =>
    Effect.gen(function* () {
      const responsesSteps = yield* Effect.result(
        parseLiveEvalCliOptions(requiredFlags("responses", ["--max-steps", "8"])),
      );
      assert.strictEqual(responsesSteps._tag, "Failure");
      const codexTurns = yield* Effect.result(
        parseLiveEvalCliOptions(requiredFlags("codex", ["--max-turns", "8"])),
      );
      assert.strictEqual(codexTurns._tag, "Failure");
      const openrouterTurns = yield* Effect.result(
        parseLiveEvalCliOptions(requiredFlags("openrouter", ["--max-turns", "8"])),
      );
      assert.strictEqual(openrouterTurns._tag, "Failure");
      const claudeSteps = yield* Effect.result(
        parseLiveEvalCliOptions(requiredFlags("claude", ["--max-steps", "8"])),
      );
      assert.strictEqual(claudeSteps._tag, "Failure");
      const tooHigh = yield* Effect.result(
        parseLiveEvalCliOptions(requiredFlags("openrouter", ["--max-steps", "33"])),
      );
      assert.strictEqual(tooHigh._tag, "Failure");
      const zero = yield* Effect.result(
        parseLiveEvalCliOptions(requiredFlags("claude", ["--max-turns", "0"])),
      );
      assert.strictEqual(zero._tag, "Failure");
    }),
  );

  it.effect("dispatches distinct targets and forwarded budgets", () =>
    Effect.gen(function* () {
      const responses = yield* parseLiveEvalCliOptions(requiredFlags("responses"));
      assert.strictEqual(responses.mode, "run");
      if (responses.mode === "run") {
        assert.deepStrictEqual(liveEvalTrialDispatch(responses.options), {
          target: "responses_api",
          displayedModel: "test-model",
        });
      }

      const codex = yield* parseLiveEvalCliOptions(requiredFlags("codex"));
      assert.strictEqual(codex.mode, "run");
      if (codex.mode === "run") {
        assert.deepStrictEqual(liveEvalTrialDispatch(codex.options), {
          target: "codex_cli",
          displayedModel: "test-model",
        });
      }

      const openrouter = yield* parseLiveEvalCliOptions(
        requiredFlags("openrouter", ["--max-steps", "12"]),
      );
      assert.strictEqual(openrouter.mode, "run");
      if (openrouter.mode === "run") {
        assert.deepStrictEqual(liveEvalTrialDispatch(openrouter.options), {
          target: "openrouter_api",
          maxSteps: 12,
        });
      }

      const claude = yield* parseLiveEvalCliOptions(requiredFlags("claude", ["--max-turns", "4"]));
      assert.strictEqual(claude.mode, "run");
      if (claude.mode === "run") {
        assert.deepStrictEqual(liveEvalTrialDispatch(claude.options), {
          target: "claude_cli",
          maxTurns: 4,
        });
      }
    }),
  );

  it.effect("still requires model, reasoning, repetitions, account class, and timeout", () =>
    Effect.gen(function* () {
      const missingModel = yield* Effect.result(
        parseLiveEvalCliOptions([
          "--runner",
          "openrouter",
          "--suite",
          "suite.yaml",
          "--run-id",
          "run-1",
          "--candidate",
          "cand-1",
          "--reasoning",
          "medium",
          "--repetitions",
          "3",
          "--account-class",
          "local",
          "--timeout-ms",
          "120000",
        ]),
      );
      assert.strictEqual(missingModel._tag, "Failure");
      if (missingModel._tag === "Failure") {
        assert.strictEqual(missingModel.failure.reason, "invalid-arguments");
        assert.include(formatLiveEvalCliFailure(missingModel.failure), formatLiveEvalCliUsage());
      }
    }),
  );
});

describe("live eval CLI credentials", () => {
  it.layer(BunPath.layer)((it) => {
    it.effect("loads only the selected OpenRouter key and names missing variables", () =>
      Effect.gen(function* () {
        const missingGina = yield* loadLiveEvalCredentials("openrouter").pipe(
          withEnv({}),
          Effect.result,
        );
        assert.strictEqual(missingGina._tag, "Failure");
        if (missingGina._tag === "Failure") {
          assert.strictEqual(missingGina.failure.reason, "invalid-credentials");
          assert.deepStrictEqual(missingGina.failure.missing, ["ASK_GINA_ACCESS_TOKEN"]);
          const message = formatLiveEvalCliFailure(missingGina.failure);
          assert.include(message, "ASK_GINA_ACCESS_TOKEN");
          assert.notInclude(message, "/");
        }

        const missingProvider = yield* loadLiveEvalCredentials("openrouter").pipe(
          withEnv({ ASK_GINA_ACCESS_TOKEN: "synthetic-gina-token" }),
          Effect.result,
        );
        assert.strictEqual(missingProvider._tag, "Failure");
        if (missingProvider._tag === "Failure") {
          assert.deepStrictEqual(missingProvider.failure.missing, ["OPENROUTER_API_KEY"]);
          assert.notInclude(
            formatLiveEvalCliFailure(missingProvider.failure),
            "synthetic-gina-token",
          );
        }

        const loaded = yield* loadLiveEvalCredentials("openrouter").pipe(
          withEnv({
            ASK_GINA_ACCESS_TOKEN: "synthetic-gina-token",
            OPENROUTER_API_KEY: "synthetic-openrouter-key",
            OPENAI_API_KEY: "must-not-be-required",
          }),
        );
        assert.strictEqual(loaded.runner, "openrouter");
      }),
    );

    it.effect("does not require OPENAI_API_KEY for Claude and hides executable paths", () =>
      Effect.gen(function* () {
        const relative = yield* loadLiveEvalCredentials("claude").pipe(
          withEnv({
            ASK_GINA_ACCESS_TOKEN: "synthetic-gina-token",
            ANTHROPIC_API_KEY: "synthetic-anthropic-key",
            CLAUDE_EVAL_EXECUTABLE: "relative/claude",
          }),
          Effect.result,
        );
        assert.strictEqual(relative._tag, "Failure");
        if (relative._tag === "Failure") {
          assert.deepStrictEqual(relative.failure.missing, ["CLAUDE_EVAL_EXECUTABLE"]);
          const message = formatLiveEvalCliFailure(relative.failure);
          assert.include(message, "CLAUDE_EVAL_EXECUTABLE");
          assert.notInclude(message, "relative/claude");
        }

        const loaded = yield* loadLiveEvalCredentials("claude").pipe(
          withEnv({
            ASK_GINA_ACCESS_TOKEN: "synthetic-gina-token",
            ANTHROPIC_API_KEY: "synthetic-anthropic-key",
            CLAUDE_EVAL_EXECUTABLE: "/usr/bin/claude",
          }),
        );
        assert.strictEqual(loaded.runner, "claude");
        if (loaded.runner === "claude") {
          assert.strictEqual(loaded.executablePath, "/usr/bin/claude");
        }
      }),
    );

    it.effect("still requires OPENAI_API_KEY only for Responses and Codex", () =>
      Effect.gen(function* () {
        const responses = yield* loadLiveEvalCredentials("responses").pipe(
          withEnv({ ASK_GINA_ACCESS_TOKEN: "synthetic-gina-token" }),
          Effect.result,
        );
        assert.strictEqual(responses._tag, "Failure");
        if (responses._tag === "Failure") {
          assert.deepStrictEqual(responses.failure.missing, ["OPENAI_API_KEY"]);
        }

        const loadedResponses = yield* loadLiveEvalCredentials("responses").pipe(
          withEnv({
            ASK_GINA_ACCESS_TOKEN: "synthetic-gina-token",
            OPENAI_API_KEY: "synthetic-openai-key",
          }),
        );
        assert.strictEqual(loadedResponses.runner, "responses");

        const missingCodexExecutable = yield* loadLiveEvalCredentials("codex").pipe(
          withEnv({
            ASK_GINA_ACCESS_TOKEN: "synthetic-gina-token",
            OPENAI_API_KEY: "synthetic-openai-key",
          }),
          Effect.result,
        );
        assert.strictEqual(missingCodexExecutable._tag, "Failure");
        if (missingCodexExecutable._tag === "Failure") {
          assert.deepStrictEqual(missingCodexExecutable.failure.missing, ["CODEX_EVAL_EXECUTABLE"]);
          assert.notInclude(
            formatLiveEvalCliFailure(missingCodexExecutable.failure),
            "synthetic-openai-key",
          );
        }
      }),
    );
  });
});

describe("live eval CLI subprocess", () => {
  it.layer(BunServices.layer)((it) => {
    it.effect("prints help without credentials or network", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const pathValue = yield* Config.string("PATH");
          const child = yield* ChildProcess.make(
            "bun",
            ["packages/evals/src/bin/live.ts", "--help"],
            {
              cwd: process.cwd(),
              env: { PATH: pathValue },
              extendEnv: false,
              stdin: "ignore",
              stdout: "pipe",
              stderr: "pipe",
            },
          );
          const [stdout, stderr, exitCode] = yield* Effect.all(
            [
              collectBoundedUtf8Output(child.stdout, 65_536),
              collectBoundedUtf8Output(child.stderr, 65_536),
              child.exitCode,
            ],
            { concurrency: "unbounded" },
          );
          assert.strictEqual(exitCode, 0);
          assert.include(stdout.text, "eval:<responses|codex|openrouter|claude>");
          assert.include(stdout.text, "ASK_GINA_ACCESS_TOKEN");
          assert.notInclude(stdout.text, "sk-");
          assert.notInclude(stderr.text, "OPENAI_API_KEY=");
        }),
      ),
    );
  });
});
