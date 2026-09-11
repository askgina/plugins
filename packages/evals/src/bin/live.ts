#!/usr/bin/env bun

import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunHttpClient from "@effect/platform-bun/BunHttpClient";
import * as BunServices from "@effect/platform-bun/BunServices";
import { createMCPClient } from "@ai-sdk/mcp";
import {
  ASK_GINA_SKILL_DEFINITIONS,
  catalogSha,
  listCatalogToolNames,
  PRODUCTION_MCP_URL,
  type PublicEvalAttemptCapture,
} from "@askgina/contracts";
import { createClient } from "@askgina/sdk";
import { HttpClient } from "effect/unstable/http";
import { ChildProcess } from "effect/unstable/process";
import type { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";
import {
  Config,
  Console,
  Data,
  Effect,
  FileSystem,
  Function,
  Layer,
  Option,
  Path,
  Redacted,
  Schema,
  Stream,
} from "effect";

import { runClaudeCliPluginEvalTrial, type PluginEvalClaudeCliError } from "../claude-cli";
import {
  CODEX_CLI_ALLOWED_ENVIRONMENT_NAMES,
  attestCodexExecutable,
  openAttestedCodexExecutable,
  runCodexCliPluginEvalTrial,
  type AttestedCodexExecutable,
  type PluginEvalCodexCliError,
} from "../codex-cli";
import { collectBoundedUtf8Output } from "../bounded-output";
import {
  captureOpenRouterConfiguration,
  liveEvalConfigurationEvidenceOutputPath,
  makeLiveEvalConfigurationEvidence,
  writeLiveEvalConfigurationEvidence,
  type LiveEvalConfigurationEvidence,
} from "../configuration";
import { loadPluginEvalSuite } from "../load-suite";
import {
  MAXIMUM_LIVE_REPETITIONS,
  MINIMUM_LIVE_REPETITIONS,
  preflightLiveEvalSuite,
  runLiveEvalSuite,
  selectCases,
} from "../live";
import {
  isOmpApiKeyProvider,
  isOmpProviderIdentifier,
  prepareOmpHarnessRuntime,
  runOmpHarnessPluginEvalTrial,
  type OmpApiKeyProvider,
  type PluginEvalOmpHarnessError,
} from "../omp-harness";
import {
  DEFAULT_OPENROUTER_MAX_TOOL_CALLS,
  isExactOpenRouterEndpointSlug,
  runOpenRouterPluginEvalTrial,
  type PluginEvalOpenRouterError,
} from "../openrouter";
import { ALPHA_GINA_READ_SERVER_URL, isAllowedGinaReadServerUrl } from "../server-url";
import {
  liveEvalRequestedRoutingEvidenceOutputPath,
  makeLiveEvalRequestedRoutingEvidence,
  writeLiveEvalRequestedRoutingEvidence,
  type LiveEvalRequestedRouting,
} from "../profile-identity";
import {
  assertPublicEvalAttemptOutputPath,
  assertPublicEvalAttemptPlan,
  makePublicEvalAttemptCapture,
  writePublicEvalAttemptCapture,
} from "../public-attempts";
import { runResponsesApiPluginEvalTrial, type PluginEvalResponsesError } from "../responses-api";
import { isSafePublicEvalText } from "../sanitize";
import type { PluginEvalObservation } from "../contracts";
import { OpenRouterBudgetError, preflightOpenRouterBudget } from "../openrouter-budget";
import { createLiveEvalJournal, LiveEvalJournalError, withJournaledTrial } from "../trial-journal";

const GIT_STATUS_LIMIT_BYTES = 65_536;
const CODEX_PREFLIGHT_LIMIT_BYTES = 1_048_576;
const CODEX_MARKETPLACE_NAME = "ask-gina-plugins";
const CODEX_PLUGIN_ID = `ask-gina@${CODEX_MARKETPLACE_NAME}`;
const CODEX_MCP_SERVER_NAME = "ask-gina";
const JsonObjectString = Schema.fromJsonString(Schema.JsonObject);
const UnknownJsonString = Schema.fromJsonString(Schema.Unknown);
const PrettyUnknownJsonString = Schema.fromJsonString(Schema.Unknown, { space: 2 });
const decodeJsonObjectOption = Schema.decodeUnknownOption(JsonObjectString);
const decodeUnknownJsonOption = Schema.decodeUnknownOption(UnknownJsonString);
const encodeUnknownJson = Schema.encodeEffect(UnknownJsonString);
const encodePrettyUnknownJson = Schema.encodeEffect(PrettyUnknownJsonString);
export const DEFAULT_OPENROUTER_MAX_STEPS = 8;
export const DEFAULT_CLAUDE_MAX_TURNS = 8;
export const MAXIMUM_LIVE_EVAL_TOOL_BUDGET = 32;
const CLAUDE_PLUGIN_DIRECTORY_SEGMENTS = ["plugins", "ask-gina", "targets", "claude"] as const;
const CLAUDE_SKILL_DIRECTORY_SEGMENTS = ["plugins", "ask-gina", "skills"] as const;
const ASK_GINA_ACCESS_TOKEN = "ASK_GINA_ACCESS_TOKEN";
const OPENAI_API_KEY = "OPENAI_API_KEY";
const OPENROUTER_API_KEY = "OPENROUTER_API_KEY";
const ANTHROPIC_API_KEY = "ANTHROPIC_API_KEY";
const CLAUDE_EVAL_EXECUTABLE = "CLAUDE_EVAL_EXECUTABLE";
const CODEX_EVAL_EXECUTABLE = "CODEX_EVAL_EXECUTABLE";
const CODEX_EVAL_EXECUTABLE_SHA256 = "CODEX_EVAL_EXECUTABLE_SHA256";
const OMP_EVAL_API_KEY = "OMP_EVAL_API_KEY";
const OMP_EVAL_EXECUTABLE = "OMP_EVAL_EXECUTABLE";
const OMP_EVAL_EXECUTABLE_SHA256 = "OMP_EVAL_EXECUTABLE_SHA256";

export type LiveEvalRunner = "codex" | "responses" | "openrouter" | "claude" | "omp";

const LIVE_EVAL_TARGET = {
  responses: "responses_api",
  codex: "codex_cli",
  openrouter: "openrouter_api",
  claude: "claude_cli",
  omp: "omp_harness",
} as const;

export interface LiveEvalTrialDispatch {
  readonly target: (typeof LIVE_EVAL_TARGET)[LiveEvalRunner];
  readonly displayedModel?: string;
  readonly maxSteps?: number;
  readonly maxTurns?: number;
  readonly model?: string;
}

export const liveEvalTrialDispatch = (options: LiveEvalCliOptions): LiveEvalTrialDispatch => {
  const target = LIVE_EVAL_TARGET[options.runner];
  if (options.runner === "openrouter") {
    return { target, maxSteps: options.maxSteps };
  }
  if (options.runner === "claude") {
    return { target, maxTurns: options.maxTurns };
  }
  if (options.runner === "omp") {
    return { target, model: `${options.auth.provider}/${options.model}` };
  }
  return { target, displayedModel: options.model };
};

interface CodexEvalRuntime {
  readonly executable: AttestedCodexExecutable;
  readonly codexHome: string;
  readonly workingDirectory: string;
  readonly pluginId: string;
  readonly pluginSkillRoot: string;
}

interface ClaudeEvalRuntime {
  readonly executablePath: string;
  readonly workingDirectory: string;
  readonly pluginDirectory: string;
}

interface LiveEvalCliSharedOptions {
  readonly suitePath: string;
  readonly runId: string;
  readonly candidate: string;
  readonly model: string;
  readonly reasoning: string;
  readonly repetitions: number;
  readonly accountClass: string;
  readonly caseIds?: readonly string[];
  readonly timeoutMs: number;
  readonly attemptsOutputPath?: string;
}

export type LiveEvalCliOptions =
  | (LiveEvalCliSharedOptions & { readonly runner: "responses" | "codex" })
  | (LiveEvalCliSharedOptions & {
      readonly runner: "openrouter";
      readonly maxSteps: number;
      readonly endpoint: string;
      readonly serverUrl: string;
      readonly maxCostUsd: number;
      readonly expectedProvider: string;
    })
  | (LiveEvalCliSharedOptions & { readonly runner: "claude"; readonly maxTurns: number })
  | (LiveEvalCliSharedOptions & {
      readonly runner: "omp";
      readonly auth:
        | { readonly mode: "api-key"; readonly provider: OmpApiKeyProvider }
        | { readonly mode: "native"; readonly provider: string; readonly agentDirectory: string };
    });

export type LiveEvalCliParseResult =
  | { readonly mode: "help"; readonly usage: string }
  | { readonly mode: "run"; readonly options: LiveEvalCliOptions };

export class LiveEvalCliError extends Data.TaggedError("LiveEvalCliError")<{
  readonly reason:
    | "dirty-source"
    | "git-preflight-failed"
    | "invalid-arguments"
    | "invalid-credentials"
    | "codex-preflight-failed"
    | "claude-preflight-failed"
    | "omp-preflight-failed"
    | "trial-failed"
    | "catalog-preflight-failed"
    | "report-exists"
    | "report-write-failed"
    | "identity-write-failed"
    | "configuration-write-failed";
  readonly missing?: readonly string[];
}> {}

const REQUIRED_LIVE_EVAL_FLAGS =
  "--suite <suite.yaml> --run-id <id> --candidate <id> --model <model> --reasoning <mode> --repetitions <3..5> --account-class <class> [--case <id>] --timeout-ms <n> [--attempts-output <new-attempts.json>]";

export const formatLiveEvalCliUsage = (runner?: LiveEvalRunner): string => {
  if (runner === "openrouter") {
    return [
      `Usage: bun run eval:openrouter -- ${REQUIRED_LIVE_EVAL_FLAGS} --openrouter-endpoint <slug> --expected-provider <label> --max-cost-usd <amount> [--max-steps <1..${MAXIMUM_LIVE_EVAL_TOOL_BUDGET}>] [--server-url <${PRODUCTION_MCP_URL}|${ALPHA_GINA_READ_SERVER_URL}>]`,
      `Endpoint, expected provider label and maximum USD are required, with no defaults. The provider label is not an endpoint slug. A non-resetting provider key limit must fit the requested maximum; in-flight overshoot remains unproven. --max-steps default ${DEFAULT_OPENROUTER_MAX_STEPS}. --server-url default ${PRODUCTION_MCP_URL}. Environment: ${ASK_GINA_ACCESS_TOKEN}, ${OPENROUTER_API_KEY}`,
    ].join("\n");
  }
  if (runner === "claude") {
    return [
      `Usage: bun run eval:claude -- ${REQUIRED_LIVE_EVAL_FLAGS} [--max-turns <1..${MAXIMUM_LIVE_EVAL_TOOL_BUDGET}>]`,
      `--max-turns default ${DEFAULT_CLAUDE_MAX_TURNS}. Environment: ${ASK_GINA_ACCESS_TOKEN}, ${ANTHROPIC_API_KEY}, ${CLAUDE_EVAL_EXECUTABLE}`,
    ].join("\n");
  }
  if (runner === "codex") {
    return [
      `Usage: bun run eval:codex -- ${REQUIRED_LIVE_EVAL_FLAGS}`,
      `Environment: ${ASK_GINA_ACCESS_TOKEN}, ${OPENAI_API_KEY}, ${CODEX_EVAL_EXECUTABLE}, ${CODEX_EVAL_EXECUTABLE_SHA256}`,
    ].join("\n");
  }
  if (runner === "responses") {
    return [
      `Usage: bun run eval:responses -- ${REQUIRED_LIVE_EVAL_FLAGS}`,
      `Environment: ${ASK_GINA_ACCESS_TOKEN}, ${OPENAI_API_KEY}`,
    ].join("\n");
  }
  if (runner === "omp") {
    return [
      `Usage: bun run eval:omp -- ${REQUIRED_LIVE_EVAL_FLAGS} --provider <id> [--omp-auth api-key|native] [--omp-agent-dir <dir>]`,
      `--omp-auth default api-key. --provider for api-key: openai|anthropic|openrouter. --omp-agent-dir is required for native and forbidden for api-key. Environment: ${ASK_GINA_ACCESS_TOKEN}, ${OMP_EVAL_EXECUTABLE}, ${OMP_EVAL_EXECUTABLE_SHA256}; ${OMP_EVAL_API_KEY} (api-key).`,
    ].join("\n");
  }
  return [
    `Usage: bun run eval:<responses|codex|openrouter|claude|omp> -- ${REQUIRED_LIVE_EVAL_FLAGS}`,
    `OpenRouter-only: --openrouter-endpoint <slug> --expected-provider <label> --max-cost-usd <amount> [--max-steps <1..${MAXIMUM_LIVE_EVAL_TOOL_BUDGET}>] (default ${DEFAULT_OPENROUTER_MAX_STEPS}) [--server-url <${PRODUCTION_MCP_URL}|${ALPHA_GINA_READ_SERVER_URL}>] (default ${PRODUCTION_MCP_URL}). Claude-only: [--max-turns <1..${MAXIMUM_LIVE_EVAL_TOOL_BUDGET}>] (default ${DEFAULT_CLAUDE_MAX_TURNS}). OMP-only: --provider <id> [--omp-auth api-key|native] [--omp-agent-dir <dir>].`,
    `Environment: ${ASK_GINA_ACCESS_TOKEN} always; ${OPENAI_API_KEY} (responses, codex); ${OPENROUTER_API_KEY} (openrouter); ${ANTHROPIC_API_KEY} and ${CLAUDE_EVAL_EXECUTABLE} (claude); ${CODEX_EVAL_EXECUTABLE} and ${CODEX_EVAL_EXECUTABLE_SHA256} (codex); ${OMP_EVAL_EXECUTABLE} and ${OMP_EVAL_EXECUTABLE_SHA256} (omp); ${OMP_EVAL_API_KEY} (omp api-key).`,
  ].join("\n");
};

const parsePositiveInteger = (value: string | undefined): number | undefined => {
  if (value === undefined || !/^\d+$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const parseToolBudget = (value: string | undefined): number | undefined => {
  const parsed = parsePositiveInteger(value);
  return parsed !== undefined && parsed <= MAXIMUM_LIVE_EVAL_TOOL_BUDGET ? parsed : undefined;
};

const parseLiveEvalRunner = (value: string | undefined): LiveEvalRunner | undefined =>
  value === "responses" ||
  value === "codex" ||
  value === "openrouter" ||
  value === "claude" ||
  value === "omp"
    ? value
    : undefined;

export const parseLiveEvalCliOptions = (
  argv: readonly string[],
): Effect.Effect<LiveEvalCliParseResult, LiveEvalCliError> =>
  Effect.gen(function* () {
    let runner: LiveEvalRunner | undefined;
    let suitePath: string | undefined;
    let runId: string | undefined;
    let candidate: string | undefined;
    let model: string | undefined;
    let reasoning: string | undefined;
    let repetitions: number | undefined;
    let accountClass: string | undefined;
    let timeoutMs: number | undefined;
    let attemptsOutputPath: string | undefined;
    let maxSteps: number | undefined;
    let maxTurns: number | undefined;
    let provider: string | undefined;
    let ompAuth: "api-key" | "native" | undefined;
    let ompAgentDir: string | undefined;
    let endpoint: string | undefined;
    let serverUrl: string | undefined;
    let maxCostUsd: number | undefined;
    let expectedProvider: string | undefined;
    const caseIds: string[] = [];
    const seenFlags = new Set<string>();
    const help = argv.some((flag) => flag === "--help" || flag === "-h");
    if (help) {
      const runnerFlag = argv.findIndex((flag) => flag === "--runner");
      const helpRunner = runnerFlag === -1 ? undefined : parseLiveEvalRunner(argv[runnerFlag + 1]);
      return { mode: "help", usage: formatLiveEvalCliUsage(helpRunner) };
    }

    for (let index = 0; index < argv.length; index += 1) {
      const flag = argv[index];
      const value = argv[index + 1];
      if (
        flag === undefined ||
        value === undefined ||
        value.trim().length === 0 ||
        value.startsWith("--") ||
        (flag !== "--case" && seenFlags.has(flag))
      ) {
        return yield* new LiveEvalCliError({ reason: "invalid-arguments" });
      }
      seenFlags.add(flag);
      switch (flag) {
        case "--runner": {
          const parsedRunner = parseLiveEvalRunner(value);
          if (parsedRunner === undefined) {
            return yield* new LiveEvalCliError({ reason: "invalid-arguments" });
          }
          runner = parsedRunner;
          break;
        }
        case "--suite":
          suitePath = value;
          break;
        case "--run-id":
          runId = value;
          break;
        case "--candidate":
          candidate = value;
          break;
        case "--model":
          model = value;
          break;
        case "--reasoning":
          reasoning = value;
          break;
        case "--repetitions":
          repetitions = parsePositiveInteger(value);
          break;
        case "--account-class":
          accountClass = value;
          break;
        case "--case":
          caseIds.push(value);
          break;
        case "--timeout-ms":
          timeoutMs = parsePositiveInteger(value);
          break;
        case "--attempts-output":
          attemptsOutputPath = value;
          break;
        case "--max-steps":
          maxSteps = parseToolBudget(value);
          if (maxSteps === undefined) {
            return yield* new LiveEvalCliError({ reason: "invalid-arguments" });
          }
          break;
        case "--max-turns":
          maxTurns = parseToolBudget(value);
          if (maxTurns === undefined) {
            return yield* new LiveEvalCliError({ reason: "invalid-arguments" });
          }
          break;
        case "--provider":
          provider = value;
          break;
        case "--omp-auth":
          if (value !== "api-key" && value !== "native") {
            return yield* new LiveEvalCliError({ reason: "invalid-arguments" });
          }
          ompAuth = value;
          break;
        case "--omp-agent-dir":
          ompAgentDir = value;
          break;
        case "--openrouter-endpoint":
          endpoint = value;
          break;
        case "--server-url":
          serverUrl = value;
          break;
        case "--max-cost-usd": {
          const parsed = Number(value);
          if (!/^\d+(?:\.\d+)?$/u.test(value) || !Number.isFinite(parsed) || parsed <= 0) {
            return yield* new LiveEvalCliError({ reason: "invalid-arguments" });
          }
          maxCostUsd = parsed;
          break;
        }
        case "--expected-provider":
          if (
            value !== value.trim() ||
            value.length > 128 ||
            /\p{Cc}/u.test(value) ||
            !isSafePublicEvalText(value)
          ) {
            return yield* new LiveEvalCliError({ reason: "invalid-arguments" });
          }
          expectedProvider = value;
          break;
        default:
          return yield* new LiveEvalCliError({ reason: "invalid-arguments" });
      }
      index += 1;
    }

    if (
      runner === undefined ||
      suitePath === undefined ||
      runId === undefined ||
      candidate === undefined ||
      model === undefined ||
      reasoning === undefined ||
      repetitions === undefined ||
      repetitions < MINIMUM_LIVE_REPETITIONS ||
      repetitions > MAXIMUM_LIVE_REPETITIONS ||
      accountClass === undefined ||
      timeoutMs === undefined
    ) {
      return yield* new LiveEvalCliError({ reason: "invalid-arguments" });
    }

    if (runner !== "openrouter" && seenFlags.has("--max-steps")) {
      return yield* new LiveEvalCliError({ reason: "invalid-arguments" });
    }
    if (runner !== "claude" && seenFlags.has("--max-turns")) {
      return yield* new LiveEvalCliError({ reason: "invalid-arguments" });
    }
    if (
      runner !== "omp" &&
      ["--provider", "--omp-auth", "--omp-agent-dir"].some((flag) => seenFlags.has(flag))
    ) {
      return yield* new LiveEvalCliError({ reason: "invalid-arguments" });
    }
    if (runner !== "openrouter" && seenFlags.has("--openrouter-endpoint")) {
      return yield* new LiveEvalCliError({ reason: "invalid-arguments" });
    }
    if (
      runner !== "openrouter" &&
      ["--server-url", "--max-cost-usd", "--expected-provider"].some((flag) => seenFlags.has(flag))
    ) {
      return yield* new LiveEvalCliError({ reason: "invalid-arguments" });
    }

    const shared = {
      suitePath,
      runId,
      candidate,
      model,
      reasoning,
      repetitions,
      accountClass,
      ...(caseIds.length === 0 ? {} : { caseIds }),
      timeoutMs,
      ...(attemptsOutputPath === undefined ? {} : { attemptsOutputPath }),
    } satisfies LiveEvalCliSharedOptions;

    if (runner === "openrouter") {
      if (
        endpoint === undefined ||
        !isExactOpenRouterEndpointSlug(endpoint, model) ||
        maxCostUsd === undefined ||
        expectedProvider === undefined
      ) {
        return yield* new LiveEvalCliError({ reason: "invalid-arguments" });
      }
      const resolvedServerUrl = serverUrl ?? PRODUCTION_MCP_URL;
      if (!isAllowedGinaReadServerUrl(resolvedServerUrl)) {
        return yield* new LiveEvalCliError({ reason: "invalid-arguments" });
      }
      return {
        mode: "run",
        options: {
          ...shared,
          runner,
          maxSteps: maxSteps ?? DEFAULT_OPENROUTER_MAX_STEPS,
          endpoint,
          serverUrl: resolvedServerUrl,
          maxCostUsd,
          expectedProvider,
        },
      };
    }
    if (runner === "claude") {
      return {
        mode: "run",
        options: { ...shared, runner, maxTurns: maxTurns ?? DEFAULT_CLAUDE_MAX_TURNS },
      };
    }
    if (runner === "omp") {
      const authMode = ompAuth ?? "api-key";
      if (provider === undefined) {
        return yield* new LiveEvalCliError({ reason: "invalid-arguments" });
      }
      if (authMode === "native") {
        if (ompAgentDir === undefined || !isOmpProviderIdentifier(provider)) {
          return yield* new LiveEvalCliError({ reason: "invalid-arguments" });
        }
        return {
          mode: "run",
          options: {
            ...shared,
            runner,
            auth: { mode: "native", provider, agentDirectory: ompAgentDir },
          },
        };
      }
      if (ompAgentDir !== undefined || !isOmpApiKeyProvider(provider)) {
        return yield* new LiveEvalCliError({ reason: "invalid-arguments" });
      }
      return {
        mode: "run",
        options: { ...shared, runner, auth: { mode: "api-key", provider } },
      };
    }
    return { mode: "run", options: { ...shared, runner } };
  });

const loadCodexEnvironment = () =>
  Effect.gen(function* () {
    const pairs = yield* Effect.forEach(CODEX_CLI_ALLOWED_ENVIRONMENT_NAMES, (name) =>
      Config.option(Config.string(name)).pipe(
        Effect.map((value) => [name, Option.getOrUndefined(value)] as const),
      ),
    );
    return Object.fromEntries(pairs);
  });

const requireCleanSource = (
  root: string,
  environment: Readonly<Record<string, string | undefined>>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const child = yield* ChildProcess.make(
        "git",
        ["status", "--porcelain=v1", "--untracked-files=all"],
        {
          cwd: root,
          env: { ...environment },
          extendEnv: false,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        },
      ).pipe(Effect.mapError(() => new LiveEvalCliError({ reason: "git-preflight-failed" })));
      const [stdout, exitCode] = yield* Effect.all(
        [
          collectBoundedUtf8Output(child.stdout, GIT_STATUS_LIMIT_BYTES),
          child.exitCode,
          child.stderr.pipe(Stream.runDrain),
        ],
        { concurrency: "unbounded" },
      ).pipe(
        Effect.mapError(() => new LiveEvalCliError({ reason: "git-preflight-failed" })),
        Effect.map(([output, code]) => [output, code] as const),
      );
      if (exitCode !== 0 || stdout.truncated) {
        return yield* new LiveEvalCliError({ reason: "git-preflight-failed" });
      }
      if (stdout.text.trim().length > 0) {
        return yield* new LiveEvalCliError({ reason: "dirty-source" });
      }
    }),
  );

const missingCredentials = (missing: readonly string[]) =>
  new LiveEvalCliError({ reason: "invalid-credentials", missing });

const requireRedacted = (
  name: string,
  value: Redacted.Redacted,
): Effect.Effect<Redacted.Redacted<string>, LiveEvalCliError> => {
  const trimmed = Redacted.value(value).trim();
  return trimmed.length === 0
    ? Effect.fail(missingCredentials([name]))
    : Effect.succeed(Redacted.make(trimmed));
};

const loadRedactedEnv = (name: string) =>
  Config.redacted(name).pipe(
    Effect.mapError(() => missingCredentials([name])),
    Effect.flatMap((value) => requireRedacted(name, value)),
  );

const loadNonEmptyEnv = (name: string) =>
  Config.string(name).pipe(
    Effect.map((value) => value.trim()),
    Effect.mapError(() => missingCredentials([name])),
    Effect.filterOrFail(
      (value) => value.length > 0,
      () => missingCredentials([name]),
    ),
  );

export type LiveEvalCredentials =
  | {
      readonly runner: "responses";
      readonly accessToken: Redacted.Redacted<string>;
      readonly openAiApiKey: Redacted.Redacted<string>;
    }
  | {
      readonly runner: "codex";
      readonly accessToken: Redacted.Redacted<string>;
      readonly openAiApiKey: Redacted.Redacted<string>;
      readonly executablePath: string;
      readonly expectedSha256: string;
    }
  | {
      readonly runner: "openrouter";
      readonly accessToken: Redacted.Redacted<string>;
      readonly openRouterApiKey: Redacted.Redacted<string>;
    }
  | {
      readonly runner: "claude";
      readonly accessToken: Redacted.Redacted<string>;
      readonly apiKey: Redacted.Redacted<string>;
      readonly executablePath: string;
    }
  | {
      readonly runner: "omp";
      readonly accessToken: Redacted.Redacted<string>;
      readonly executablePath: string;
      readonly expectedSha256: string;
      readonly auth:
        | { readonly mode: "api-key"; readonly apiKey: Redacted.Redacted<string> }
        | { readonly mode: "native" };
    };

export type LiveEvalCredentialRequest =
  | Exclude<LiveEvalRunner, "omp">
  | { readonly runner: "omp"; readonly authMode: "api-key" | "native" };

export const loadLiveEvalCredentials = (
  request: LiveEvalCredentialRequest,
): Effect.Effect<LiveEvalCredentials, LiveEvalCliError, Path.Path> =>
  Effect.gen(function* () {
    const accessToken = yield* loadRedactedEnv(ASK_GINA_ACCESS_TOKEN);
    if (typeof request !== "string") {
      const path = yield* Path.Path;
      const apiKey =
        request.authMode === "native" ? undefined : yield* loadRedactedEnv(OMP_EVAL_API_KEY);
      const executablePath = yield* loadNonEmptyEnv(OMP_EVAL_EXECUTABLE);
      const expectedSha256 = (yield* loadNonEmptyEnv(OMP_EVAL_EXECUTABLE_SHA256)).toLowerCase();
      if (!path.isAbsolute(executablePath)) {
        return yield* missingCredentials([OMP_EVAL_EXECUTABLE]);
      }
      return {
        runner: "omp",
        accessToken,
        executablePath,
        expectedSha256,
        auth:
          apiKey === undefined ? { mode: "native" as const } : { mode: "api-key" as const, apiKey },
      };
    }
    const runner = request;
    if (runner === "responses") {
      const openAiApiKey = yield* loadRedactedEnv(OPENAI_API_KEY);
      return { runner, accessToken, openAiApiKey };
    }
    if (runner === "openrouter") {
      const openRouterApiKey = yield* loadRedactedEnv(OPENROUTER_API_KEY);
      return { runner, accessToken, openRouterApiKey };
    }
    if (runner === "claude") {
      const path = yield* Path.Path;
      const apiKey = yield* loadRedactedEnv(ANTHROPIC_API_KEY);
      const executablePath = yield* loadNonEmptyEnv(CLAUDE_EVAL_EXECUTABLE);
      if (!path.isAbsolute(executablePath)) {
        return yield* missingCredentials([CLAUDE_EVAL_EXECUTABLE]);
      }
      return { runner, accessToken, apiKey, executablePath };
    }
    const openAiApiKey = yield* loadRedactedEnv(OPENAI_API_KEY);
    const executablePath = yield* loadNonEmptyEnv(CODEX_EVAL_EXECUTABLE);
    const expectedSha256 = (yield* loadNonEmptyEnv(CODEX_EVAL_EXECUTABLE_SHA256)).toLowerCase();
    return { runner, accessToken, openAiApiKey, executablePath, expectedSha256 };
  });

const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const sameExecutable = (
  expected: AttestedCodexExecutable,
  actual: AttestedCodexExecutable,
): boolean =>
  expected.path === actual.path &&
  expected.sha256 === actual.sha256 &&
  expected.dev === actual.dev &&
  expected.ino === actual.ino &&
  expected.mode === actual.mode &&
  expected.size === actual.size;

const codexChildEnvironment = (
  codexHome: string,
  parent: Readonly<Record<string, string | undefined>>,
): Record<string, string> => ({
  ...Object.fromEntries(
    CODEX_CLI_ALLOWED_ENVIRONMENT_NAMES.flatMap((name) => {
      const value = parent[name];
      return value === undefined ? [] : [[name, value] as const];
    }),
  ),
  HOME: codexHome,
  CODEX_HOME: codexHome,
  USERPROFILE: codexHome,
  XDG_CONFIG_HOME: codexHome,
  XDG_CACHE_HOME: codexHome,
  XDG_DATA_HOME: codexHome,
});

const runAttestedCodexCommand = (
  executable: AttestedCodexExecutable,
  args: readonly string[],
  cwd: string,
  environment: Readonly<Record<string, string>>,
): Effect.Effect<
  string,
  LiveEvalCliError,
  ChildProcessSpawner | FileSystem.FileSystem | Path.Path
> =>
  Effect.scoped(
    Effect.gen(function* () {
      const opened = yield* openAttestedCodexExecutable({
        executablePath: executable.path,
        expectedSha256: executable.sha256,
      }).pipe(Effect.mapError(() => new LiveEvalCliError({ reason: "codex-preflight-failed" })));
      const actual = opened.executable;
      if (!sameExecutable(executable, actual)) {
        return yield* new LiveEvalCliError({ reason: "codex-preflight-failed" });
      }
      const child = yield* ChildProcess.make(opened.command, args, {
        cwd,
        env: { ...environment },
        extendEnv: false,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      }).pipe(Effect.mapError(() => new LiveEvalCliError({ reason: "codex-preflight-failed" })));
      const [stdout, stderr, exitCode] = yield* Effect.all(
        [
          collectBoundedUtf8Output(child.stdout, CODEX_PREFLIGHT_LIMIT_BYTES),
          collectBoundedUtf8Output(child.stderr, CODEX_PREFLIGHT_LIMIT_BYTES),
          child.exitCode,
        ],
        { concurrency: "unbounded" },
      ).pipe(Effect.mapError(() => new LiveEvalCliError({ reason: "codex-preflight-failed" })));
      if (exitCode !== 0 || stdout.truncated || stderr.truncated) {
        return yield* new LiveEvalCliError({ reason: "codex-preflight-failed" });
      }
      return stdout.text;
    }),
  );

const parseJsonObject = (value: string): Record<string, unknown> | undefined =>
  Option.getOrUndefined(decodeJsonObjectOption(value));

const setupCodexRuntime = (
  root: string,
  executable: AttestedCodexExecutable,
  parentEnvironment: Readonly<Record<string, string | undefined>>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const temporaryRoot = yield* fs.makeTempDirectoryScoped({ prefix: "ask-gina-codex-eval-" });
    const codexHome = path.join(temporaryRoot, "home");
    const workingDirectory = path.join(temporaryRoot, "work");
    yield* Effect.all([
      fs.makeDirectory(codexHome, { recursive: true }),
      fs.makeDirectory(workingDirectory, { recursive: true }),
    ]).pipe(Effect.mapError(() => new LiveEvalCliError({ reason: "codex-preflight-failed" })));
    const configPath = path.join(codexHome, "config.toml");
    yield* fs
      .writeFileString(configPath, "", { flag: "wx", mode: 0o600 })
      .pipe(Effect.mapError(() => new LiveEvalCliError({ reason: "codex-preflight-failed" })));
    const environment = codexChildEnvironment(codexHome, parentEnvironment);
    const marketplaceOutput = yield* runAttestedCodexCommand(
      executable,
      ["plugin", "marketplace", "add", root, "--json"],
      workingDirectory,
      environment,
    );
    const marketplace = parseJsonObject(marketplaceOutput);
    if (
      marketplace?.marketplaceName !== CODEX_MARKETPLACE_NAME ||
      marketplace.installedRoot !== root
    ) {
      return yield* new LiveEvalCliError({ reason: "codex-preflight-failed" });
    }
    const installOutput = yield* runAttestedCodexCommand(
      executable,
      ["plugin", "add", CODEX_PLUGIN_ID, "--json"],
      workingDirectory,
      environment,
    );
    const install = parseJsonObject(installOutput);
    const installedPath =
      typeof install?.installedPath === "string" ? install.installedPath : undefined;
    if (install?.pluginId !== CODEX_PLUGIN_ID || installedPath === undefined) {
      return yield* new LiveEvalCliError({ reason: "codex-preflight-failed" });
    }
    const installedRoot = yield* fs
      .realPath(installedPath)
      .pipe(Effect.mapError(() => new LiveEvalCliError({ reason: "codex-preflight-failed" })));
    const relativeInstalledRoot = path.relative(codexHome, installedRoot);
    if (
      relativeInstalledRoot === "" ||
      relativeInstalledRoot.startsWith("..") ||
      path.isAbsolute(relativeInstalledRoot)
    ) {
      return yield* new LiveEvalCliError({ reason: "codex-preflight-failed" });
    }
    const pluginManifest = yield* fs
      .readFileString(path.join(installedRoot, ".codex-plugin", "plugin.json"))
      .pipe(
        Effect.map(parseJsonObject),
        Effect.mapError(() => new LiveEvalCliError({ reason: "codex-preflight-failed" })),
      );
    if (
      pluginManifest?.name !== "ask-gina" ||
      pluginManifest.skills !== "./skills/" ||
      pluginManifest.mcpServers !== "./.mcp.json"
    ) {
      return yield* new LiveEvalCliError({ reason: "codex-preflight-failed" });
    }
    const mcpConfig = yield* fs.readFileString(path.join(installedRoot, ".mcp.json")).pipe(
      Effect.map(parseJsonObject),
      Effect.mapError(() => new LiveEvalCliError({ reason: "codex-preflight-failed" })),
    );
    const mcpServers = mcpConfig?.mcpServers;
    const askGinaServer = isJsonObject(mcpServers) ? mcpServers[CODEX_MCP_SERVER_NAME] : undefined;
    if (
      !isJsonObject(mcpServers) ||
      !isJsonObject(askGinaServer) ||
      Object.keys(mcpServers).length !== 1 ||
      askGinaServer.type !== "http" ||
      askGinaServer.url !== PRODUCTION_MCP_URL
    ) {
      return yield* new LiveEvalCliError({ reason: "codex-preflight-failed" });
    }
    const pluginSkillRoot = yield* fs
      .realPath(path.join(installedRoot, "skills"))
      .pipe(Effect.mapError(() => new LiveEvalCliError({ reason: "codex-preflight-failed" })));
    const sourceSkillRoot = path.join(root, "plugins", "ask-gina", "skills");
    const installedSkillNames = (yield* fs
      .readDirectory(pluginSkillRoot)
      .pipe(
        Effect.mapError(() => new LiveEvalCliError({ reason: "codex-preflight-failed" })),
      )).sort();
    const expectedSkillNames = ASK_GINA_SKILL_DEFINITIONS.map((skill) => skill.name).sort();
    if (
      installedSkillNames.length !== expectedSkillNames.length ||
      !installedSkillNames.every((name, index) => name === expectedSkillNames[index])
    ) {
      return yield* new LiveEvalCliError({ reason: "codex-preflight-failed" });
    }
    yield* Effect.forEach(expectedSkillNames, (skillName) =>
      Effect.all([
        fs.readFileString(path.join(sourceSkillRoot, skillName, "SKILL.md")),
        fs.readFileString(path.join(pluginSkillRoot, skillName, "SKILL.md")),
      ]).pipe(
        Effect.filterOrFail(
          ([source, installed]) => source === installed,
          () => new LiveEvalCliError({ reason: "codex-preflight-failed" }),
        ),
        Effect.mapError(() => new LiveEvalCliError({ reason: "codex-preflight-failed" })),
      ),
    );
    return {
      executable,
      codexHome,
      workingDirectory,
      pluginId: CODEX_PLUGIN_ID,
      pluginSkillRoot,
    } satisfies CodexEvalRuntime;
  });

const seedCodexOAuthCredential = (
  runtime: CodexEvalRuntime,
  accessToken: Redacted.Redacted<string>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const credentials = {
      "ask-gina-eval": {
        access_token: Redacted.value(accessToken),
        refresh_token: null,
        scopes: [],
      },
    };
    const credentialPath = path.join(runtime.codexHome, ".credentials.json");
    const encodedCredentials = yield* encodeUnknownJson(credentials).pipe(
      Effect.mapError(() => new LiveEvalCliError({ reason: "codex-preflight-failed" })),
    );
    yield* fs
      .writeFileString(credentialPath, encodedCredentials, { flag: "wx", mode: 0o600 })
      .pipe(Effect.mapError(() => new LiveEvalCliError({ reason: "codex-preflight-failed" })));
    return credentialPath;
  });

const setupClaudeRuntime = (root: string, executablePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const fail = () => new LiveEvalCliError({ reason: "claude-preflight-failed" });
    const requireContained = (candidate: string) => {
      const relative = path.relative(root, candidate);
      return relative === "" || relative.startsWith("..") || path.isAbsolute(relative)
        ? Effect.fail(fail())
        : Effect.void;
    };
    const isSymbolicLink = (target: string) =>
      fs.readLink(target).pipe(Effect.match({ onFailure: () => false, onSuccess: () => true }));
    const copyCheckedFile = (
      source: string,
      destination: string,
    ): Effect.Effect<void, LiveEvalCliError> =>
      Effect.gen(function* () {
        if (yield* isSymbolicLink(source)) return yield* fail();
        const info = yield* fs.stat(source).pipe(Effect.mapError(() => fail()));
        if (info.type !== "File") return yield* fail();
        const bytes = yield* fs.readFile(source).pipe(Effect.mapError(() => fail()));
        if (bytes.byteLength !== Number(info.size) || bytes.byteLength === 0) return yield* fail();
        yield* fs
          .makeDirectory(path.dirname(destination), { recursive: true })
          .pipe(Effect.mapError(() => fail()));
        yield* fs.writeFile(destination, bytes, { flag: "wx" }).pipe(Effect.mapError(() => fail()));
      });
    const copyCheckedTree = (
      source: string,
      destination: string,
    ): Effect.Effect<void, LiveEvalCliError> =>
      Effect.gen(function* () {
        if (yield* isSymbolicLink(source)) return yield* fail();
        const info = yield* fs.stat(source).pipe(Effect.mapError(() => fail()));
        if (info.type === "File") return yield* copyCheckedFile(source, destination);
        if (info.type !== "Directory") return yield* fail();
        yield* fs
          .makeDirectory(destination, { recursive: true })
          .pipe(Effect.mapError(() => fail()));
        const entries = yield* fs.readDirectory(source).pipe(Effect.mapError(() => fail()));
        yield* Effect.forEach(
          entries,
          (entry) => copyCheckedTree(path.join(source, entry), path.join(destination, entry)),
          { discard: true },
        );
      });

    const temporaryRoot = yield* fs
      .makeTempDirectoryScoped({ prefix: "ask-gina-claude-eval-" })
      .pipe(Effect.mapError(() => fail()));
    const workingDirectory = path.join(temporaryRoot, "work");
    const stagedPlugin = path.join(temporaryRoot, "plugin");
    yield* fs
      .makeDirectory(workingDirectory, { recursive: true })
      .pipe(Effect.mapError(() => fail()));
    const overlaySource = yield* fs
      .realPath(path.join(root, ...CLAUDE_PLUGIN_DIRECTORY_SEGMENTS))
      .pipe(Effect.mapError(() => fail()));
    const skillsSource = yield* fs
      .realPath(path.join(root, ...CLAUDE_SKILL_DIRECTORY_SEGMENTS))
      .pipe(Effect.mapError(() => fail()));
    yield* requireContained(overlaySource);
    yield* requireContained(skillsSource);
    yield* copyCheckedTree(overlaySource, stagedPlugin);
    yield* Effect.forEach(
      ASK_GINA_SKILL_DEFINITIONS,
      (skill) =>
        Effect.gen(function* () {
          const destination = path.join(stagedPlugin, "skills", skill.name);
          yield* copyCheckedTree(path.join(skillsSource, skill.name), destination);
          yield* fs
            .remove(path.join(destination, "agents"), { recursive: true, force: true })
            .pipe(Effect.mapError(() => fail()));
        }),
      { discard: true },
    );
    const pluginDirectory = yield* fs.realPath(stagedPlugin).pipe(Effect.mapError(() => fail()));
    return {
      executablePath,
      workingDirectory,
      pluginDirectory,
    } satisfies ClaudeEvalRuntime;
  });

const requireLiveCatalog = (accessToken: Redacted.Redacted<string>, serverUrl: string) => {
  if (!isAllowedGinaReadServerUrl(serverUrl)) {
    return Effect.fail(new LiveEvalCliError({ reason: "invalid-arguments" }));
  }
  if (serverUrl !== PRODUCTION_MCP_URL) {
    return listAllowedGinaReadCatalog(accessToken, serverUrl);
  }
  const client = createClient({
    accessToken: Redacted.value(accessToken),
  });
  return client.listTools().pipe(
    Effect.map((tools) => tools.map((tool) => tool.name)),
    Effect.mapError(() => new LiveEvalCliError({ reason: "catalog-preflight-failed" })),
  );
};

const listAllowedGinaReadCatalog = (
  accessToken: Redacted.Redacted<string>,
  serverUrl: string,
): Effect.Effect<readonly string[], LiveEvalCliError> =>
  Effect.scoped(
    Effect.gen(function* () {
      const client = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () =>
            createMCPClient({
              transport: {
                type: "http",
                url: serverUrl,
                headers: { Authorization: `Bearer ${Redacted.value(accessToken)}` },
                redirect: "error",
              },
              maxRetries: 0,
              clientName: "ask-gina-live-eval",
            }),
          catch: () => new LiveEvalCliError({ reason: "catalog-preflight-failed" }),
        }),
        (mcpClient) =>
          Effect.promise(() =>
            Promise.resolve(mcpClient.close()).then(
              () => undefined,
              () => undefined,
            ),
          ),
      );
      const listed = yield* Effect.tryPromise({
        try: () => client.listTools(),
        catch: () => new LiveEvalCliError({ reason: "catalog-preflight-failed" }),
      });
      return listed.tools.map((tool) => tool.name);
    }),
  );

const requireCodexPluginAuth = (
  runtime: CodexEvalRuntime,
  parentEnvironment: Readonly<Record<string, string | undefined>>,
): Effect.Effect<void, LiveEvalCliError, ChildProcessSpawner | FileSystem.FileSystem | Path.Path> =>
  runAttestedCodexCommand(
    runtime.executable,
    ["mcp", "list", "--json"],
    runtime.workingDirectory,
    codexChildEnvironment(runtime.codexHome, parentEnvironment),
  ).pipe(
    Effect.flatMap((output) => {
      const parsedOption = decodeUnknownJsonOption(output);
      if (Option.isNone(parsedOption)) {
        return Effect.fail(new LiveEvalCliError({ reason: "codex-preflight-failed" }));
      }
      const parsed = parsedOption.value;
      if (!Array.isArray(parsed) || parsed.length !== 1 || !isJsonObject(parsed[0])) {
        return Effect.fail(new LiveEvalCliError({ reason: "codex-preflight-failed" }));
      }
      const server = parsed[0];
      const transport = server.transport;
      return server.name === CODEX_MCP_SERVER_NAME &&
        server.auth_status === "o_auth" &&
        isJsonObject(transport) &&
        transport.type === "streamable_http" &&
        transport.url === PRODUCTION_MCP_URL
        ? Effect.void
        : Effect.fail(new LiveEvalCliError({ reason: "codex-preflight-failed" }));
    }),
  );

const errorTag = (error: unknown): string => {
  if (typeof error !== "object" || error === null || !("_tag" in error))
    return "LiveEvalTrialError";
  const tag = Reflect.get(error, "_tag");
  return typeof tag === "string" ? tag : "LiveEvalTrialError";
};

export const formatLiveEvalCliFailure = (error: unknown): string => {
  if (error instanceof OpenRouterBudgetError || error instanceof LiveEvalJournalError) {
    return `live eval failed (${error._tag}): ${error.reason}`;
  }
  if (errorTag(error) === "LiveEvalCliError" && typeof error === "object" && error !== null) {
    if (Reflect.get(error, "reason") === "invalid-arguments") {
      return formatLiveEvalCliUsage();
    }
    const missing = Reflect.get(error, "missing");
    if (
      Array.isArray(missing) &&
      missing.length > 0 &&
      missing.every((name) => typeof name === "string")
    ) {
      return `live eval failed (LiveEvalCliError): missing ${missing.join(", ")}`;
    }
  }
  return `live eval failed (${errorTag(error)})`;
};

const writeReport = (outputPath: string, content: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const output = path.resolve(outputPath);
    yield* fs
      .makeDirectory(path.dirname(output), { recursive: true })
      .pipe(Effect.mapError(() => new LiveEvalCliError({ reason: "report-write-failed" })));
    yield* fs
      .writeFileString(output, content, { flag: "wx", mode: 0o600 })
      .pipe(Effect.mapError(() => new LiveEvalCliError({ reason: "report-exists" })));
  });

export const writeLiveEvalReportWithRequestedRoutingEvidence = (options: {
  readonly reportPath: string;
  readonly reportContent: string;
  readonly identityPath: string;
  readonly requestedRouting: LiveEvalRequestedRouting;
  readonly configurationPath: string;
  readonly configurationEvidence: LiveEvalConfigurationEvidence;
}): Effect.Effect<void, LiveEvalCliError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const identityPath = path.resolve(options.identityPath);
    const configurationPath = path.resolve(options.configurationPath);
    yield* writeLiveEvalRequestedRoutingEvidence({
      outputPath: identityPath,
      reportPath: options.reportPath,
      reportContent: options.reportContent,
      evidence: makeLiveEvalRequestedRoutingEvidence({
        reportContent: options.reportContent,
        requestedRouting: options.requestedRouting,
      }),
    }).pipe(Effect.mapError(() => new LiveEvalCliError({ reason: "identity-write-failed" })));
    const configuration = yield* Effect.result(
      writeLiveEvalConfigurationEvidence({
        outputPath: configurationPath,
        reportPath: options.reportPath,
        reportContent: options.reportContent,
        evidence: options.configurationEvidence,
      }).pipe(
        Effect.mapError(() => new LiveEvalCliError({ reason: "configuration-write-failed" })),
      ),
    );
    if (configuration._tag === "Failure") {
      yield* fs
        .remove(identityPath)
        .pipe(Effect.mapError(() => new LiveEvalCliError({ reason: "identity-write-failed" })));
      return yield* configuration.failure;
    }
    const written = yield* Effect.result(writeReport(options.reportPath, options.reportContent));
    if (written._tag === "Failure") {
      const configurationCleanup = yield* Effect.result(fs.remove(configurationPath));
      const routingCleanup = yield* Effect.result(fs.remove(identityPath));
      if (configurationCleanup._tag === "Failure") {
        return yield* new LiveEvalCliError({ reason: "configuration-write-failed" });
      }
      if (routingCleanup._tag === "Failure") {
        return yield* new LiveEvalCliError({ reason: "identity-write-failed" });
      }
      return yield* written.failure;
    }
  });

export const assertLiveEvalDurableOutputs = Function.dual<
  (
    identityPath: string | undefined,
    configurationPath: string | undefined,
  ) => (
    reportPath: string,
  ) => Effect.Effect<void, LiveEvalCliError, FileSystem.FileSystem | Path.Path>,
  (
    reportPath: string,
    identityPath: string | undefined,
    configurationPath: string | undefined,
  ) => Effect.Effect<void, LiveEvalCliError, FileSystem.FileSystem | Path.Path>
>(3, (reportPath, identityPath, configurationPath) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const report = path.resolve(reportPath);
    if (
      yield* fs
        .exists(report)
        .pipe(Effect.mapError(() => new LiveEvalCliError({ reason: "report-write-failed" })))
    ) {
      return yield* new LiveEvalCliError({ reason: "report-exists" });
    }
    const companions: ReadonlyArray<
      readonly [string, "identity-write-failed" | "configuration-write-failed"]
    > = [
      ...(identityPath === undefined
        ? []
        : ([[path.resolve(identityPath), "identity-write-failed"]] as const)),
      ...(configurationPath === undefined
        ? []
        : ([[path.resolve(configurationPath), "configuration-write-failed"]] as const)),
    ];
    const seen = new Set<string>([report]);
    for (const [companion, reason] of companions) {
      if (seen.has(companion)) {
        return yield* new LiveEvalCliError({ reason });
      }
      seen.add(companion);
      if (
        yield* fs.exists(companion).pipe(Effect.mapError(() => new LiveEvalCliError({ reason })))
      ) {
        return yield* new LiveEvalCliError({ reason });
      }
    }
  }),
);

const run = (options: LiveEvalCliOptions) =>
  Effect.scoped(
    Effect.gen(function* () {
      const root = process.cwd();
      const path = yield* Path.Path;
      const runGenerationEvidence = Effect.runPromiseWith(
        yield* Effect.context<FileSystem.FileSystem>(),
      );
      const dispatch = liveEvalTrialDispatch(options);
      const model = dispatch.model ?? options.model;
      const outputPath = path.join(
        root,
        ".plugin-eval-runs",
        `${dispatch.target}-${options.candidate}-${options.runId}.json`,
      );
      const identityPath =
        options.runner === "openrouter"
          ? liveEvalRequestedRoutingEvidenceOutputPath(path, outputPath)
          : undefined;
      const configurationPath =
        options.runner === "openrouter"
          ? liveEvalConfigurationEvidenceOutputPath(path, outputPath, "configuration-v2")
          : undefined;
      const journalPath = outputPath.replace(/\.json$/u, ".journal-v1.jsonl");
      yield* assertLiveEvalDurableOutputs(outputPath, identityPath, configurationPath);
      yield* assertPublicEvalAttemptOutputPath(journalPath, outputPath);
      if (options.attemptsOutputPath !== undefined) {
        yield* assertPublicEvalAttemptOutputPath(options.attemptsOutputPath, outputPath);
        yield* assertPublicEvalAttemptOutputPath(options.attemptsOutputPath, journalPath);
        if (identityPath !== undefined) {
          yield* assertPublicEvalAttemptOutputPath(options.attemptsOutputPath, identityPath);
        }
        if (configurationPath !== undefined) {
          yield* assertPublicEvalAttemptOutputPath(options.attemptsOutputPath, configurationPath);
        }
      }
      const suite = yield* loadPluginEvalSuite(options.suitePath);
      yield* preflightLiveEvalSuite(suite).pipe(
        Effect.mapError(() => new LiveEvalCliError({ reason: "catalog-preflight-failed" })),
      );
      const plannedCases = yield* selectCases(suite, options.caseIds);
      const plannedCaseIds = plannedCases.map((evalCase) => evalCase.id);
      if (options.attemptsOutputPath !== undefined) {
        yield* assertPublicEvalAttemptPlan(options.runId, plannedCaseIds, options.repetitions);
      }
      const configurationCapture =
        options.runner === "openrouter"
          ? yield* captureOpenRouterConfiguration({
              evaluatorEntrypointUrl: import.meta.url,
            }).pipe(
              Effect.mapError(() => new LiveEvalCliError({ reason: "configuration-write-failed" })),
            )
          : undefined;
      const journal = yield* createLiveEvalJournal({
        outputPath: journalPath,
        runId: options.runId,
        candidate: options.candidate,
        target: dispatch.target,
        model,
        serverUrl: options.runner === "openrouter" ? options.serverUrl : PRODUCTION_MCP_URL,
        suiteId: suite.suite.id,
        suiteVersion: suite.version,
        fixtureVersion: 1,
        catalogSha,
        reasoning: options.reasoning,
        accountClass: options.accountClass,
        caseIds: plannedCaseIds,
        repetitions: options.repetitions,
      });
      const credentials = yield* loadLiveEvalCredentials(
        options.runner === "omp" ? { runner: "omp", authMode: options.auth.mode } : options.runner,
      );
      const isolatedEnvironment = yield* loadCodexEnvironment();
      yield* requireCleanSource(root, isolatedEnvironment);
      let codexRuntime: CodexEvalRuntime | undefined;
      let claudeRuntime: ClaudeEvalRuntime | undefined;
      let ompRuntimeDirectory: string | undefined;
      if (options.runner === "codex") {
        if (credentials.runner !== "codex") {
          return yield* new LiveEvalCliError({ reason: "codex-preflight-failed" });
        }
        const executable = yield* attestCodexExecutable({
          executablePath: credentials.executablePath,
          expectedSha256: credentials.expectedSha256,
          forbiddenRoots: [root],
        }).pipe(Effect.mapError(() => new LiveEvalCliError({ reason: "codex-preflight-failed" })));
        codexRuntime = yield* setupCodexRuntime(root, executable, isolatedEnvironment);
      }
      if (options.runner === "claude") {
        if (credentials.runner !== "claude") {
          return yield* new LiveEvalCliError({ reason: "claude-preflight-failed" });
        }
        claudeRuntime = yield* setupClaudeRuntime(root, credentials.executablePath);
      }
      if (options.runner === "omp") {
        if (credentials.runner !== "omp") {
          return yield* new LiveEvalCliError({ reason: "omp-preflight-failed" });
        }
        const prepared = yield* prepareOmpHarnessRuntime({
          root,
          executablePath: credentials.executablePath,
          expectedSha256: credentials.expectedSha256,
        }).pipe(Effect.mapError(() => new LiveEvalCliError({ reason: "omp-preflight-failed" })));
        ompRuntimeDirectory = prepared.runtimeDirectory;
      }
      const catalogServerUrl =
        options.runner === "openrouter" ? options.serverUrl : PRODUCTION_MCP_URL;
      const availableTools = yield* requireLiveCatalog(credentials.accessToken, catalogServerUrl);
      if (codexRuntime !== undefined) {
        yield* seedCodexOAuthCredential(codexRuntime, credentials.accessToken);
        yield* requireCodexPluginAuth(codexRuntime, isolatedEnvironment);
      }

      const { report, attempts, requestedRouting, selectedCaseIds } = yield* runLiveEvalSuite<
        LiveEvalCliError | LiveEvalJournalError | OpenRouterBudgetError,
        HttpClient.HttpClient | ChildProcessSpawner | FileSystem.FileSystem | Path.Path
      >(
        {
          suite,
          ...(options.caseIds === undefined ? {} : { caseIds: options.caseIds }),
          runId: options.runId,
          candidate: options.candidate,
          target: dispatch.target,
          model,
          ...(dispatch.displayedModel === undefined
            ? {}
            : { displayedModel: dispatch.displayedModel }),
          reasoning: options.reasoning,
          repetitions: options.repetitions,
          accountClass: options.accountClass,
          captureAttempts: options.attemptsOutputPath !== undefined,
          ...(options.runner === "openrouter"
            ? {
                requestedRouting: {
                  kind: "openrouter-endpoint" as const,
                  endpoint: options.endpoint,
                  allow_fallbacks: false as const,
                  require_parameters: true as const,
                },
              }
            : {}),
        },
        (input) =>
          Effect.gen(function* () {
            const budgetEvidence =
              options.runner === "openrouter" && credentials.runner === "openrouter"
                ? yield* preflightOpenRouterBudget({
                    apiKey: credentials.openRouterApiKey,
                    maximumUsd: options.maxCostUsd,
                  })
                : undefined;
            return yield* withJournaledTrial(
              journal,
              {
                caseId: input.evalCase.id,
                repetition: input.repetition,
                ...(budgetEvidence === undefined ? {} : { budgetEvidence }),
              },
              (
                dispatchId,
              ): Effect.Effect<
                PluginEvalObservation,
                | LiveEvalCliError
                | PluginEvalResponsesError
                | PluginEvalOpenRouterError
                | PluginEvalClaudeCliError
                | PluginEvalCodexCliError
                | PluginEvalOmpHarnessError,
                HttpClient.HttpClient | ChildProcessSpawner | FileSystem.FileSystem | Path.Path
              > => {
                switch (options.runner) {
                  case "responses":
                    if (credentials.runner !== "responses") {
                      return Effect.fail(missingCredentials([OPENAI_API_KEY]));
                    }
                    return runResponsesApiPluginEvalTrial(input.evalCase, {
                      apiKey: Redacted.value(credentials.openAiApiKey),
                      mcpAuthorization: Redacted.value(credentials.accessToken),
                      model: options.model,
                      reasoning: options.reasoning,
                      runId: input.runId,
                      repetition: input.repetition,
                      serverUrl: PRODUCTION_MCP_URL,
                      allowedTools: listCatalogToolNames(),
                      timeoutMs: options.timeoutMs,
                    });
                  case "openrouter":
                    if (credentials.runner !== "openrouter") {
                      return Effect.fail(missingCredentials([OPENROUTER_API_KEY]));
                    }
                    return runOpenRouterPluginEvalTrial(input.evalCase, {
                      apiKey: Redacted.value(credentials.openRouterApiKey),
                      mcpAuthorization: Redacted.value(credentials.accessToken),
                      model: options.model,
                      endpoint: options.endpoint,
                      expectedProvider: options.expectedProvider,
                      onGenerationEvidence: (evidence) =>
                        runGenerationEvidence(journal.generation(dispatchId, evidence)),
                      reasoning: options.reasoning,
                      runId: input.runId,
                      repetition: input.repetition,
                      serverUrl: options.serverUrl,
                      allowedTools: listCatalogToolNames(),
                      timeoutMs: options.timeoutMs,
                      maxSteps: dispatch.maxSteps,
                      maxToolCalls: DEFAULT_OPENROUTER_MAX_TOOL_CALLS,
                    });
                  case "claude":
                    if (credentials.runner !== "claude" || claudeRuntime === undefined) {
                      return Effect.fail(
                        new LiveEvalCliError({ reason: "claude-preflight-failed" }),
                      );
                    }
                    return runClaudeCliPluginEvalTrial(input.evalCase, {
                      runId: input.runId,
                      repetition: input.repetition,
                      availableTools,
                      workingDirectory: claudeRuntime.workingDirectory,
                      executablePath: claudeRuntime.executablePath,
                      pluginDirectory: claudeRuntime.pluginDirectory,
                      mcpAuthorization: credentials.accessToken,
                      apiKey: credentials.apiKey,
                      model: options.model,
                      reasoning: options.reasoning,
                      parentEnvironment: isolatedEnvironment,
                      timeoutMs: options.timeoutMs,
                      maxTurns: dispatch.maxTurns,
                    });
                  case "codex":
                    if (credentials.runner !== "codex" || codexRuntime === undefined) {
                      return Effect.fail(
                        new LiveEvalCliError({ reason: "codex-preflight-failed" }),
                      );
                    }
                    return runCodexCliPluginEvalTrial(input.evalCase, {
                      openAiApiKey: credentials.openAiApiKey,
                      model: options.model,
                      displayedModel: options.model,
                      reasoning: options.reasoning,
                      runId: input.runId,
                      repetition: input.repetition,
                      workingDirectory: codexRuntime.workingDirectory,
                      executable: codexRuntime.executable,
                      codexHome: codexRuntime.codexHome,
                      pluginId: codexRuntime.pluginId,
                      pluginSkillRoot: codexRuntime.pluginSkillRoot,
                      parentEnvironment: isolatedEnvironment,
                      availableTools,
                      timeoutMs: options.timeoutMs,
                    });
                  case "omp": {
                    if (credentials.runner !== "omp" || ompRuntimeDirectory === undefined) {
                      return Effect.fail(new LiveEvalCliError({ reason: "omp-preflight-failed" }));
                    }
                    const auth =
                      options.auth.mode === "native"
                        ? {
                            mode: "native" as const,
                            provider: options.auth.provider,
                            agentDirectory: options.auth.agentDirectory,
                          }
                        : credentials.auth.mode === "api-key"
                          ? {
                              mode: "api-key" as const,
                              provider: options.auth.provider,
                              apiKey: credentials.auth.apiKey,
                            }
                          : undefined;
                    if (auth === undefined) {
                      return Effect.fail(new LiveEvalCliError({ reason: "omp-preflight-failed" }));
                    }
                    return runOmpHarnessPluginEvalTrial(input.evalCase, {
                      runId: input.runId,
                      repetition: input.repetition,
                      availableTools,
                      runtimeDirectory: ompRuntimeDirectory,
                      auth,
                      model: options.model,
                      reasoning: options.reasoning,
                      mcpAuthorization: credentials.accessToken,
                      timeoutMs: options.timeoutMs,
                    }).pipe(
                      Effect.filterOrFail(
                        (observation) => observation.model === input.model,
                        () => new LiveEvalCliError({ reason: "trial-failed" }),
                      ),
                    );
                  }
                }
              },
            ).pipe(
              Effect.mapError((error) =>
                error instanceof LiveEvalJournalError
                  ? error
                  : new LiveEvalCliError({ reason: "trial-failed" }),
              ),
            );
          }),
      );
      const encoded = yield* encodePrettyUnknownJson(report).pipe(
        Effect.map((json) => `${json}\n`),
        Effect.mapError(() => new LiveEvalCliError({ reason: "report-write-failed" })),
      );
      let capture: PublicEvalAttemptCapture | undefined;
      if (options.attemptsOutputPath !== undefined) {
        if (attempts === null) {
          return yield* new LiveEvalCliError({ reason: "report-write-failed" });
        }
        capture = yield* makePublicEvalAttemptCapture({
          runId: report.runId,
          reportContent: encoded,
          attempts,
        });
      }
      yield* journal.bindReport(encoded, selectedCaseIds);
      if (
        requestedRouting !== undefined &&
        identityPath !== undefined &&
        configurationPath !== undefined &&
        configurationCapture !== undefined &&
        options.runner === "openrouter"
      ) {
        yield* writeLiveEvalReportWithRequestedRoutingEvidence({
          reportPath: outputPath,
          reportContent: encoded,
          identityPath,
          requestedRouting,
          configurationPath,
          configurationEvidence: makeLiveEvalConfigurationEvidence({
            report,
            reportContent: encoded,
            requestedRouting,
            maxSteps: options.maxSteps,
            maxToolCalls: DEFAULT_OPENROUTER_MAX_TOOL_CALLS,
            timeoutMs: options.timeoutMs,
            capture: configurationCapture,
            serverUrl: options.serverUrl,
            maxCostUsd: options.maxCostUsd,
            expectedProvider: options.expectedProvider,
          }),
        });
      } else {
        yield* writeReport(outputPath, encoded);
      }
      if (options.attemptsOutputPath !== undefined && capture !== undefined) {
        yield* writePublicEvalAttemptCapture({
          outputPath: options.attemptsOutputPath,
          reportPath: outputPath,
          capture,
        });
      }
      yield* Console.log(
        `sanitized eval report written (${report.aggregate.overall.passed}/${report.aggregate.overall.total} passed)`,
      );
      return report.aggregate.overall.passed === report.aggregate.overall.total ? 0 : 2;
    }),
  );

const program = parseLiveEvalCliOptions(process.argv.slice(2)).pipe(
  Effect.flatMap((parsed) =>
    parsed.mode === "help" ? Console.log(parsed.usage).pipe(Effect.as(0)) : run(parsed.options),
  ),
  Effect.matchEffect({
    onFailure: (error) => Console.error(formatLiveEvalCliFailure(error)).pipe(Effect.as(1)),
    onSuccess: Effect.succeed,
  }),
  Effect.tap((exitCode) =>
    Effect.sync(() => {
      if (exitCode !== 0) process.exitCode = exitCode;
    }),
  ),
);

const main = Layer.build(Layer.mergeAll(BunServices.layer, BunHttpClient.layer)).pipe(
  Effect.flatMap((context) => program.pipe(Effect.provide(context))),
  Effect.scoped,
);

if (import.meta.main) {
  BunRuntime.runMain(main);
}
