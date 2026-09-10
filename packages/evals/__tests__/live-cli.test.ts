import * as BunPath from "@effect/platform-bun/BunPath";
import * as BunServices from "@effect/platform-bun/BunServices";
import { assert, describe, it } from "@effect/vitest";
import { Config, ConfigProvider, Effect, FileSystem, Path, PlatformError, Schema } from "effect";
import { ChildProcess } from "effect/unstable/process";

import { PRODUCTION_MCP_URL } from "@askgina/contracts";

import { collectBoundedUtf8Output } from "../src/bounded-output";

import {
  DEFAULT_CLAUDE_MAX_TURNS,
  DEFAULT_OPENROUTER_MAX_STEPS,
  assertLiveEvalDurableOutputs,
  formatLiveEvalCliFailure,
  formatLiveEvalCliUsage,
  loadLiveEvalCredentials,
  parseLiveEvalCliOptions,
  writeLiveEvalReportWithRequestedRoutingEvidence,
} from "../src/bin/live";
import { makeLiveEvalConfigurationEvidence } from "../src/configuration";
import { ALPHA_GINA_READ_SERVER_URL } from "../src/server-url";
import type { LiveEvalConfigurationCaptureType } from "../src/configuration";
import { DEFAULT_OPENROUTER_MAX_TOOL_CALLS } from "../src/openrouter";
import type { SanitizedEvalRunReport } from "../src/report";
import aggregateFixture from "../src/fixtures/sanitized-aggregate.json";
import { SanitizedEvalAggregateSchema } from "../src/sanitize";

const openRouterRequestedRouting = {
  kind: "openrouter-endpoint" as const,
  endpoint: "openai",
  allow_fallbacks: false as const,
  require_parameters: true as const,
};

const digest = (label: string): string => label.repeat(64).slice(0, 64);

const configurationCapture: LiveEvalConfigurationCaptureType = {
  evaluatorSha256: digest("a"),
  skillsSha256: digest("b"),
  toolchainSha256: digest("c"),
  runtime: {
    bun: { version: "1.4.0", executableSha256: digest("d") },
    lockSha256: digest("e"),
    packages: [
      {
        name: "ai",
        version: "7.0.93",
        metadataSha256: digest("1"),
        sourceSha256: digest("2"),
        sourceScope: "entrypoint",
      },
      {
        name: "@openrouter/ai-sdk-provider",
        version: "3.0.0",
        metadataSha256: digest("3"),
        sourceSha256: digest("4"),
        sourceScope: "entrypoint",
      },
      {
        name: "@ai-sdk/mcp",
        version: "2.0.45",
        metadataSha256: digest("5"),
        sourceSha256: digest("6"),
        sourceScope: "entrypoint",
      },
    ],
  },
};

const configurationReport: SanitizedEvalRunReport = {
  schemaVersion: "v1",
  runId: "run-1",
  candidate: "cand-1",
  target: "openrouter_api",
  model: "openai/gpt-5.6-sol",
  reasoning: "medium",
  repetitions: 3,
  startedAt: "2026-09-09T00:00:00.000Z",
  cleanChat: true,
  accountClass: "local",
  aggregate: Schema.decodeUnknownSync(SanitizedEvalAggregateSchema)(aggregateFixture),
};

const configurationEvidence = (reportContent: string) =>
  makeLiveEvalConfigurationEvidence({
    report: configurationReport,
    reportContent,
    requestedRouting: openRouterRequestedRouting,
    maxSteps: DEFAULT_OPENROUTER_MAX_STEPS,
    maxToolCalls: DEFAULT_OPENROUTER_MAX_TOOL_CALLS,
    timeoutMs: 120_000,
    capture: configurationCapture,
  });
const configurationReportContent = `${JSON.stringify(configurationReport)}\n`;

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
  ...(runner === "openrouter"
    ? ["--openrouter-endpoint", "openai", "--expected-provider", "OpenAI", "--max-cost-usd", "25"]
    : []),
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
        assert.strictEqual(openrouter.options.serverUrl, PRODUCTION_MCP_URL);
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

  it.effect("requires explicit OpenRouter spend and provider controls", () =>
    Effect.gen(function* () {
      const flags = requiredFlags("openrouter");
      for (const required of ["--max-cost-usd", "--expected-provider"]) {
        const position = flags.indexOf(required);
        const result = yield* Effect.result(
          parseLiveEvalCliOptions(
            flags.filter((_, index) => index !== position && index !== position + 1),
          ),
        );
        assert.strictEqual(result._tag, "Failure");
      }
      const unbounded = yield* Effect.result(
        parseLiveEvalCliOptions(
          flags.map((value, index) => (flags[index - 1] === "--max-cost-usd" ? "Infinity" : value)),
        ),
      );
      assert.strictEqual(unbounded._tag, "Failure");
      const wrongRunner = yield* Effect.result(
        parseLiveEvalCliOptions(requiredFlags("responses", ["--max-cost-usd", "25"])),
      );
      assert.strictEqual(wrongRunner._tag, "Failure");
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
      const responsesServerUrl = yield* Effect.result(
        parseLiveEvalCliOptions(requiredFlags("responses", ["--server-url", PRODUCTION_MCP_URL])),
      );
      assert.strictEqual(responsesServerUrl._tag, "Failure");
      const codexServerUrl = yield* Effect.result(
        parseLiveEvalCliOptions(
          requiredFlags("codex", ["--server-url", ALPHA_GINA_READ_SERVER_URL]),
        ),
      );
      assert.strictEqual(codexServerUrl._tag, "Failure");
    }),
  );

  it.effect(
    "selects allowed OpenRouter server URLs and rejects invalid ones before credentials",
    () =>
      Effect.gen(function* () {
        const production = yield* parseLiveEvalCliOptions(
          requiredFlags("openrouter", ["--server-url", PRODUCTION_MCP_URL]),
        );
        assert.strictEqual(production.mode, "run");
        if (production.mode === "run" && production.options.runner === "openrouter") {
          assert.strictEqual(production.options.serverUrl, PRODUCTION_MCP_URL);
        }

        const alpha = yield* parseLiveEvalCliOptions(
          requiredFlags("openrouter", ["--server-url", ALPHA_GINA_READ_SERVER_URL]),
        );
        assert.strictEqual(alpha.mode, "run");
        if (alpha.mode === "run" && alpha.options.runner === "openrouter") {
          assert.strictEqual(alpha.options.serverUrl, ALPHA_GINA_READ_SERVER_URL);
        }

        const invalid = yield* Effect.result(
          parseLiveEvalCliOptions(
            requiredFlags("openrouter", ["--server-url", "https://example.invalid/mcp"]),
          ),
        );
        assert.strictEqual(invalid._tag, "Failure");
        if (invalid._tag === "Failure") {
          assert.strictEqual(invalid.failure.reason, "invalid-arguments");
          const message = formatLiveEvalCliFailure(invalid.failure);
          assert.notInclude(message, "example.invalid");
        }

        const trailingSlash = yield* Effect.result(
          parseLiveEvalCliOptions(
            requiredFlags("openrouter", ["--server-url", `${PRODUCTION_MCP_URL}/`]),
          ),
        );
        assert.strictEqual(trailingSlash._tag, "Failure");

        if (alpha.mode === "run" && alpha.options.runner === "openrouter") {
          const evidence = configurationEvidence(configurationReportContent);
          const withAlpha = makeLiveEvalConfigurationEvidence({
            report: configurationReport,
            reportContent: configurationReportContent,
            requestedRouting: openRouterRequestedRouting,
            maxSteps: DEFAULT_OPENROUTER_MAX_STEPS,
            maxToolCalls: DEFAULT_OPENROUTER_MAX_TOOL_CALLS,
            timeoutMs: 120_000,
            capture: configurationCapture,
            serverUrl: alpha.options.serverUrl,
            maxCostUsd: alpha.options.maxCostUsd,
            expectedProvider: alpha.options.expectedProvider,
          });
          assert.notProperty(evidence.requested, "mcpResource");
          assert.strictEqual(withAlpha.schemaVersion, "configuration-v2");
          if (withAlpha.schemaVersion === "configuration-v2") {
            assert.strictEqual(withAlpha.requested.mcpResource, "alpha");
          }
          assert.notStrictEqual(withAlpha.configurationSha256, evidence.configurationSha256);
        }
      }),
  );

  it.effect("requires an exact OpenRouter endpoint before credentials", () =>
    Effect.gen(function* () {
      const missing = yield* Effect.result(
        parseLiveEvalCliOptions([
          "--runner",
          "openrouter",
          "--expected-provider",
          "OpenAI",
          "--max-cost-usd",
          "25",
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
          "--expected-provider",
          "OpenAI",
          "--max-cost-usd",
          "25",
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
          "--expected-provider",
          "OpenAI",
          "--max-cost-usd",
          "25",
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
          "--expected-provider",
          "OpenAI",
          "--max-cost-usd",
          "25",
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
          assert.include(stdout.text, "--server-url");
          assert.include(stdout.text, PRODUCTION_MCP_URL);
          assert.include(stdout.text, ALPHA_GINA_READ_SERVER_URL);
          assert.notInclude(stdout.text, "sk-");
          assert.notInclude(stderr.text, "OPENAI_API_KEY=");
          assert.notInclude(stderr.text, "OMP_EVAL_API_KEY=");
        }),
      ),
    );

    it.effect("rejects an unsupported OpenRouter server URL before credentials", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const pathValue = yield* Config.string("PATH");
          const child = yield* ChildProcess.make(
            "bun",
            [
              "packages/evals/src/bin/live.ts",
              ...requiredFlags("openrouter", ["--server-url", "https://example.invalid/mcp"]),
            ],
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
          const output = `${stdout.text}\n${stderr.text}`;
          assert.notStrictEqual(exitCode, 0);
          assert.include(output, "Usage:");
          assert.include(output, "--server-url");
          assert.notInclude(output, "example.invalid");
          assert.notInclude(output, "missing ASK_GINA_ACCESS_TOKEN");
          assert.notInclude(output, "missing OPENROUTER_API_KEY");
        }),
      ),
    );

    it.effect("rejects preexisting OpenRouter routing evidence before credentials", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const pathValue = yield* Config.string("PATH");
          const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "live-cli-preflight-" });
          const candidate = "cand-preflight";
          const runId = "run-preflight";
          const reportPath = path.join(
            cwd,
            ".plugin-eval-runs",
            `openrouter_api-${candidate}-${runId}.json`,
          );
          const evidencePath = `${reportPath.slice(0, reportPath.length - ".json".length)}.requested-routing-v1.json`;
          yield* fs.makeDirectory(path.dirname(reportPath), { recursive: true });
          const preexistingBytes = "{}\n";
          yield* fs.writeFileString(evidencePath, preexistingBytes, { flag: "wx", mode: 0o600 });
          const child = yield* ChildProcess.make(
            "bun",
            [
              path.join(process.cwd(), "packages/evals/src/bin/live.ts"),
              "--runner",
              "openrouter",
              "--suite",
              "suite.yaml",
              "--run-id",
              runId,
              "--candidate",
              candidate,
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
              "--openrouter-endpoint",
              "openai",
              "--expected-provider",
              "OpenAI",
              "--max-cost-usd",
              "25",
            ],
            {
              cwd,
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
          const output = `${stdout.text}\n${stderr.text}`;
          assert.notStrictEqual(exitCode, 0);
          assert.include(output, "live eval failed (LiveEvalCliError)");
          assert.notInclude(output, "Usage:");
          assert.notInclude(output, "missing ASK_GINA_ACCESS_TOKEN");
          assert.notInclude(output, "missing OPENROUTER_API_KEY");
          assert.isFalse(yield* fs.exists(reportPath));
          assert.strictEqual(yield* fs.readFileString(evidencePath), preexistingBytes);
        }),
      ),
    );

    it.effect("rejects attempts-output collision with each companion before credentials", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const pathValue = yield* Config.string("PATH");
          const liveCli = path.join(process.cwd(), "packages/evals/src/bin/live.ts");
          const candidate = "cand-1";
          const runId = "run-1";
          const reportRelative = path.join(
            ".plugin-eval-runs",
            `openrouter_api-${candidate}-${runId}.json`,
          );
          const reportStem = reportRelative.slice(0, reportRelative.length - ".json".length);
          yield* Effect.forEach(
            [
              reportRelative,
              `${reportStem}.requested-routing-v1.json`,
              `${reportStem}.configuration-v2.json`,
            ] as const,
            (attemptsOutput) =>
              Effect.scoped(
                Effect.gen(function* () {
                  const cwd = yield* fs.makeTempDirectoryScoped({
                    prefix: "live-cli-attempts-collision-",
                  });
                  const child = yield* ChildProcess.make(
                    "bun",
                    [
                      liveCli,
                      ...requiredFlags("openrouter", ["--attempts-output", attemptsOutput]),
                    ],
                    {
                      cwd,
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
                  const output = `${stdout.text}\n${stderr.text}`;
                  assert.notStrictEqual(exitCode, 0);
                  assert.include(output, "live eval failed");
                  assert.notInclude(output, "Usage:");
                  assert.notInclude(output, "missing ASK_GINA_ACCESS_TOKEN");
                  assert.notInclude(output, "missing OPENROUTER_API_KEY");
                  assert.isFalse(yield* fs.exists(path.join(cwd, reportRelative)));
                  assert.isFalse(
                    yield* fs.exists(path.join(cwd, `${reportStem}.requested-routing-v1.json`)),
                  );
                  assert.isFalse(
                    yield* fs.exists(path.join(cwd, `${reportStem}.configuration-v2.json`)),
                  );
                }),
              ),
          );
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
        const preexistingBytes = "{}\n";
        yield* fs.writeFileString(identityPath, preexistingBytes, { flag: "wx" });
        const result = yield* Effect.result(
          assertLiveEvalDurableOutputs(reportPath, identityPath, undefined),
        );
        assert.strictEqual(result._tag, "Failure");
        if (result._tag === "Failure") {
          assert.strictEqual(result.failure.reason, "identity-write-failed");
        }
        assert.isFalse(yield* fs.exists(reportPath));
        assert.strictEqual(yield* fs.readFileString(identityPath), preexistingBytes);
      }),
    );

    it.effect("rejects a report path that collides with routing evidence", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "live-cli-collision-" });
        const reportPath = path.join(directory, "openrouter_api-cand-run.json");
        const preflight = yield* Effect.result(
          assertLiveEvalDurableOutputs(reportPath, reportPath, undefined),
        );
        assert.strictEqual(preflight._tag, "Failure");
        if (preflight._tag === "Failure") {
          assert.strictEqual(preflight.failure.reason, "identity-write-failed");
        }
        assert.isFalse(yield* fs.exists(reportPath));

        const configurationPath = path.join(
          directory,
          "openrouter_api-cand-run.configuration-v1.json",
        );
        const written = yield* Effect.result(
          writeLiveEvalReportWithRequestedRoutingEvidence({
            reportPath,
            reportContent: "{}\n",
            identityPath: reportPath,
            requestedRouting: openRouterRequestedRouting,
            configurationPath,
            configurationEvidence: configurationEvidence("{}\n"),
          }),
        );
        assert.strictEqual(written._tag, "Failure");
        if (written._tag === "Failure") {
          assert.strictEqual(written.failure.reason, "identity-write-failed");
        }
        assert.isFalse(yield* fs.exists(reportPath));
        assert.isFalse(yield* fs.exists(configurationPath));
      }),
    );

    it.effect("rejects a preexisting configuration-evidence path", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectoryScoped({
          prefix: "live-cli-config-preflight-",
        });
        const reportPath = path.join(directory, "openrouter_api-cand-run.json");
        const identityPath = path.join(
          directory,
          "openrouter_api-cand-run.requested-routing-v1.json",
        );
        const configurationPath = path.join(
          directory,
          "openrouter_api-cand-run.configuration-v1.json",
        );
        const preexistingBytes = "{}\n";
        yield* fs.writeFileString(configurationPath, preexistingBytes, { flag: "wx", mode: 0o600 });
        const result = yield* Effect.result(
          assertLiveEvalDurableOutputs(reportPath, identityPath, configurationPath),
        );
        assert.strictEqual(result._tag, "Failure");
        if (result._tag === "Failure") {
          assert.strictEqual(result.failure.reason, "configuration-write-failed");
        }
        assert.isFalse(yield* fs.exists(reportPath));
        assert.isFalse(yield* fs.exists(identityPath));
        assert.strictEqual(yield* fs.readFileString(configurationPath), preexistingBytes);
      }),
    );

    it.effect("removes evaluator-owned evidence when the report write fails", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "live-cli-cleanup-" });
        const reportPath = path.join(directory, "openrouter_api-cand-run.json");
        const identityPath = path.join(
          directory,
          "openrouter_api-cand-run.requested-routing-v1.json",
        );
        const configurationPath = path.join(
          directory,
          "openrouter_api-cand-run.configuration-v1.json",
        );
        yield* fs.writeFileString(reportPath, "occupied\n", { flag: "wx", mode: 0o600 });
        const result = yield* Effect.result(
          writeLiveEvalReportWithRequestedRoutingEvidence({
            reportPath,
            reportContent: configurationReportContent,
            identityPath,
            requestedRouting: openRouterRequestedRouting,
            configurationPath,
            configurationEvidence: configurationEvidence(configurationReportContent),
          }),
        );
        assert.strictEqual(result._tag, "Failure");
        if (result._tag === "Failure") {
          assert.strictEqual(result.failure.reason, "report-exists");
        }
        assert.isFalse(yield* fs.exists(identityPath));
        assert.isFalse(yield* fs.exists(configurationPath));
        assert.strictEqual(yield* fs.readFileString(reportPath), "occupied\n");
      }),
    );

    it.effect("fails closed when evidence cleanup fails after a report write failure", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectoryScoped({
          prefix: "live-cli-cleanup-failed-",
        });
        const reportPath = path.join(directory, "openrouter_api-cand-run.json");
        const identityPath = path.join(
          directory,
          "openrouter_api-cand-run.requested-routing-v1.json",
        );
        const configurationPath = path.join(
          directory,
          "openrouter_api-cand-run.configuration-v1.json",
        );
        const resolvedIdentity = path.resolve(identityPath);
        yield* fs.writeFileString(reportPath, "occupied\n", { flag: "wx", mode: 0o600 });
        const refusedCleanup: FileSystem.FileSystem = {
          ...fs,
          remove: (file, options) =>
            path.resolve(file) === resolvedIdentity
              ? Effect.fail(
                  PlatformError.systemError({
                    _tag: "PermissionDenied",
                    module: "FileSystem",
                    method: "remove",
                    description: "refused identity cleanup",
                    pathOrDescriptor: file,
                  }),
                )
              : fs.remove(file, options),
        };
        const result = yield* Effect.result(
          writeLiveEvalReportWithRequestedRoutingEvidence({
            reportPath,
            reportContent: configurationReportContent,
            identityPath,
            requestedRouting: openRouterRequestedRouting,
            configurationPath,
            configurationEvidence: configurationEvidence(configurationReportContent),
          }).pipe(Effect.provideService(FileSystem.FileSystem, refusedCleanup)),
        );
        assert.strictEqual(result._tag, "Failure");
        if (result._tag === "Failure") {
          assert.strictEqual(result.failure.reason, "identity-write-failed");
        }
        assert.isTrue(yield* fs.exists(identityPath));
        assert.isFalse(yield* fs.exists(configurationPath));
        assert.strictEqual(yield* fs.readFileString(reportPath), "occupied\n");
      }),
    );

    it.effect("still attempts routing cleanup when configuration cleanup fails", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectoryScoped({
          prefix: "live-cli-config-cleanup-failed-",
        });
        const reportPath = path.join(directory, "openrouter_api-cand-run.json");
        const identityPath = path.join(
          directory,
          "openrouter_api-cand-run.requested-routing-v1.json",
        );
        const configurationPath = path.join(
          directory,
          "openrouter_api-cand-run.configuration-v1.json",
        );
        const resolvedConfiguration = path.resolve(configurationPath);
        yield* fs.writeFileString(reportPath, "occupied\n", { flag: "wx", mode: 0o600 });
        const refusedCleanup: FileSystem.FileSystem = {
          ...fs,
          remove: (file, options) =>
            path.resolve(file) === resolvedConfiguration
              ? Effect.fail(
                  PlatformError.systemError({
                    _tag: "PermissionDenied",
                    module: "FileSystem",
                    method: "remove",
                    description: "refused configuration cleanup",
                    pathOrDescriptor: file,
                  }),
                )
              : fs.remove(file, options),
        };
        const result = yield* Effect.result(
          writeLiveEvalReportWithRequestedRoutingEvidence({
            reportPath,
            reportContent: configurationReportContent,
            identityPath,
            requestedRouting: openRouterRequestedRouting,
            configurationPath,
            configurationEvidence: configurationEvidence(configurationReportContent),
          }).pipe(Effect.provideService(FileSystem.FileSystem, refusedCleanup)),
        );
        assert.strictEqual(result._tag, "Failure");
        if (result._tag === "Failure") {
          assert.strictEqual(result.failure.reason, "configuration-write-failed");
        }
        assert.isFalse(yield* fs.exists(identityPath));
        assert.isTrue(yield* fs.exists(configurationPath));
        assert.strictEqual(yield* fs.readFileString(reportPath), "occupied\n");
      }),
    );
  });
});
