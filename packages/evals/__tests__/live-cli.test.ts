import * as BunPath from "@effect/platform-bun/BunPath";
import * as BunServices from "@effect/platform-bun/BunServices";
import { assert, describe, it } from "@effect/vitest";
import { Config, ConfigProvider, Effect, FileSystem, Path } from "effect";
import { ChildProcess } from "effect/unstable/process";

import { collectBoundedUtf8Output } from "../src/bounded-output";

import {
  DEFAULT_CLAUDE_MAX_TURNS,
  DEFAULT_OPENROUTER_MAX_STEPS,
  assertLiveEvalDurableOutputs,
  formatLiveEvalCliFailure,
  formatLiveEvalCliUsage,
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
  ...(runner === "openrouter" ? ["--openrouter-endpoint", "openai"] : []),
  ...extra,
];

const withEnv =
  (env: Record<string, string>) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv({ env })),
    );

describe("live eval CLI parser", () => {
  it.effect("parses supported runners and preserves existing required flags", () =>
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
        assert.strictEqual(openrouter.options.endpoint, "openai");
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

      const omp = yield* parseLiveEvalCliOptions(requiredFlags("omp", ["--provider", "anthropic"]));
      assert.strictEqual(omp.mode, "run");
      if (omp.mode === "run" && omp.options.runner === "omp") {
        assert.strictEqual(omp.options.provider, "anthropic");
        assert.strictEqual(omp.options.model, "test-model");
        assert.notProperty(omp.options, "maxSteps");
        assert.notProperty(omp.options, "maxTurns");
      }

      const missingProvider = yield* Effect.result(parseLiveEvalCliOptions(requiredFlags("omp")));
      assert.strictEqual(missingProvider._tag, "Failure");
      const unknownProvider = yield* Effect.result(
        parseLiveEvalCliOptions(requiredFlags("omp", ["--provider", "google"])),
      );
      assert.strictEqual(unknownProvider._tag, "Failure");
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
      const responsesProvider = yield* Effect.result(
        parseLiveEvalCliOptions(requiredFlags("responses", ["--provider", "openai"])),
      );
      assert.strictEqual(responsesProvider._tag, "Failure");
      const ompSteps = yield* Effect.result(
        parseLiveEvalCliOptions(requiredFlags("omp", ["--provider", "openai", "--max-steps", "8"])),
      );
      assert.strictEqual(ompSteps._tag, "Failure");
      const responsesEndpoint = yield* Effect.result(
        parseLiveEvalCliOptions(requiredFlags("responses", ["--openrouter-endpoint", "openai"])),
      );
      assert.strictEqual(responsesEndpoint._tag, "Failure");
    }),
  );

  it.effect("requires an exact OpenRouter endpoint before credentials", () =>
    Effect.gen(function* () {
      const missing = yield* Effect.result(
        parseLiveEvalCliOptions([
          "--runner",
          "openrouter",
          "--suite",
          "suite.yaml",
          "--run-id",
          "run-1",
          "--candidate",
          "cand-1",
          "--model",
          "openai/gpt-4o",
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
      assert.strictEqual(missing._tag, "Failure");
      if (missing._tag === "Failure") {
        assert.strictEqual(missing.failure.reason, "invalid-arguments");
        assert.include(formatLiveEvalCliFailure(missing.failure), "--openrouter-endpoint");
      }

      const sameAsModel = yield* Effect.result(
        parseLiveEvalCliOptions([
          "--runner",
          "openrouter",
          "--suite",
          "suite.yaml",
          "--run-id",
          "run-1",
          "--candidate",
          "cand-1",
          "--model",
          "openai/gpt-4o",
          "--reasoning",
          "medium",
          "--repetitions",
          "3",
          "--account-class",
          "local",
          "--timeout-ms",
          "120000",
          "--openrouter-endpoint",
          "openai/gpt-4o",
        ]),
      );
      assert.strictEqual(sameAsModel._tag, "Failure");

      const malformed = yield* Effect.result(
        parseLiveEvalCliOptions([
          "--runner",
          "openrouter",
          "--suite",
          "suite.yaml",
          "--run-id",
          "run-1",
          "--candidate",
          "cand-1",
          "--model",
          "openai/gpt-4o",
          "--reasoning",
          "medium",
          "--repetitions",
          "3",
          "--account-class",
          "local",
          "--timeout-ms",
          "120000",
          "--openrouter-endpoint",
          "openai,anthropic",
        ]),
      );
      assert.strictEqual(malformed._tag, "Failure");
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

    it.effect("loads OMP pins without OpenAI keys and hides executable paths", () =>
      Effect.gen(function* () {
        const missingKey = yield* loadLiveEvalCredentials("omp").pipe(
          withEnv({
            ASK_GINA_ACCESS_TOKEN: "synthetic-gina-token",
            OPENAI_API_KEY: "must-not-be-required",
          }),
          Effect.result,
        );
        assert.strictEqual(missingKey._tag, "Failure");
        if (missingKey._tag === "Failure") {
          assert.deepStrictEqual(missingKey.failure.missing, ["OMP_EVAL_API_KEY"]);
          assert.notInclude(formatLiveEvalCliFailure(missingKey.failure), "must-not-be-required");
        }

        const relative = yield* loadLiveEvalCredentials("omp").pipe(
          withEnv({
            ASK_GINA_ACCESS_TOKEN: "synthetic-gina-token",
            OMP_EVAL_API_KEY: "synthetic-omp-key",
            OMP_EVAL_EXECUTABLE: "relative/omp",
            OMP_EVAL_EXECUTABLE_SHA256: "abc",
          }),
          Effect.result,
        );
        assert.strictEqual(relative._tag, "Failure");
        if (relative._tag === "Failure") {
          assert.deepStrictEqual(relative.failure.missing, ["OMP_EVAL_EXECUTABLE"]);
          assert.notInclude(formatLiveEvalCliFailure(relative.failure), "relative/omp");
        }

        const loaded = yield* loadLiveEvalCredentials("omp").pipe(
          withEnv({
            ASK_GINA_ACCESS_TOKEN: "synthetic-gina-token",
            OMP_EVAL_API_KEY: "synthetic-omp-key",
            OMP_EVAL_EXECUTABLE: "/usr/bin/omp",
            OMP_EVAL_EXECUTABLE_SHA256: "AbCDEF",
            OPENAI_API_KEY: "must-not-be-required",
          }),
        );
        assert.strictEqual(loaded.runner, "omp");
        if (loaded.runner === "omp") {
          assert.strictEqual(loaded.executablePath, "/usr/bin/omp");
          assert.strictEqual(loaded.expectedSha256, "abcdef");
        }

        const responses = yield* loadLiveEvalCredentials("responses").pipe(
          withEnv({
            ASK_GINA_ACCESS_TOKEN: "synthetic-gina-token",
            OPENAI_API_KEY: "synthetic-openai-key",
            OMP_EVAL_API_KEY: "must-not-be-required",
          }),
        );
        assert.strictEqual(responses.runner, "responses");
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
          assert.include(stdout.text, "eval:");
          assert.include(stdout.text, "ASK_GINA_ACCESS_TOKEN");
          assert.include(stdout.text, "OMP_EVAL_API_KEY");
          assert.notInclude(stdout.text, "sk-");
          assert.notInclude(stderr.text, "OPENAI_API_KEY=");
          assert.notInclude(stderr.text, "OMP_EVAL_API_KEY=");
        }),
      ),
    );
  });
});

describe("live eval durable outputs", () => {
  it.layer(BunServices.layer)((it) => {
    it.effect("rejects a preexisting routing-evidence path before credentials or trials", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectory(undefined);
        const reportPath = path.join(directory, "openrouter_api-cand-run.json");
        const identityPath = path.join(
          directory,
          "openrouter_api-cand-run.requested-routing-v1.json",
        );
        yield* fs.writeFileString(identityPath, "{}\n", { flag: "wx" });
        const result = yield* Effect.result(assertLiveEvalDurableOutputs(reportPath, identityPath));
        assert.strictEqual(result._tag, "Failure");
        if (result._tag === "Failure") {
          assert.strictEqual(result.failure.reason, "identity-write-failed");
        }
        assert.isFalse(yield* fs.exists(reportPath));
      }),
    );
  });
});
