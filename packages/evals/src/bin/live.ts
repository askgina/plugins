#!/usr/bin/env bun

import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunHttpClient from "@effect/platform-bun/BunHttpClient";
import * as BunServices from "@effect/platform-bun/BunServices";
import {
  ASK_GINA_SKILL_DEFINITIONS,
  listCatalogToolNames,
  PRODUCTION_MCP_URL,
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
  Layer,
  Option,
  Path,
  Redacted,
  Schema,
  Stream,
} from "effect";

import {
  CODEX_CLI_ALLOWED_ENVIRONMENT_NAMES,
  attestCodexExecutable,
  openAttestedCodexExecutable,
  runCodexCliPluginEvalTrial,
  type AttestedCodexExecutable,
} from "../codex-cli";
import { collectBoundedUtf8Output } from "../bounded-output";
import { loadPluginEvalSuite } from "../load-suite";
import {
  MAXIMUM_LIVE_REPETITIONS,
  MINIMUM_LIVE_REPETITIONS,
  preflightLiveEvalSuite,
  runLiveEvalSuite,
} from "../live";
import { runResponsesApiPluginEvalTrial } from "../responses-api";
import type { SanitizedEvalRunReport } from "../report";

const GIT_STATUS_LIMIT_BYTES = 65_536;
const CODEX_PREFLIGHT_LIMIT_BYTES = 1_048_576;
const CODEX_MARKETPLACE_NAME = "ask-gina-plugins";
const CODEX_PLUGIN_ID = `ask-gina@${CODEX_MARKETPLACE_NAME}`;
const CODEX_MCP_SERVER_NAME = "gina";
const JsonObjectString = Schema.fromJsonString(Schema.JsonObject);
const UnknownJsonString = Schema.fromJsonString(Schema.Unknown);
const PrettyUnknownJsonString = Schema.fromJsonString(Schema.Unknown, { space: 2 });
const decodeJsonObjectOption = Schema.decodeUnknownOption(JsonObjectString);
const decodeUnknownJsonOption = Schema.decodeUnknownOption(UnknownJsonString);
const encodeUnknownJson = Schema.encodeEffect(UnknownJsonString);
const encodePrettyUnknownJson = Schema.encodeEffect(PrettyUnknownJsonString);
type LiveEvalRunner = "codex" | "responses";

interface CodexEvalRuntime {
  readonly executable: AttestedCodexExecutable;
  readonly codexHome: string;
  readonly workingDirectory: string;
  readonly pluginId: string;
  readonly pluginSkillRoot: string;
}

interface LiveEvalCliOptions {
  readonly runner: LiveEvalRunner;
  readonly suitePath: string;
  readonly runId: string;
  readonly candidate: string;
  readonly model: string;
  readonly reasoning: string;
  readonly repetitions: number;
  readonly accountClass: string;
  readonly caseIds?: readonly string[];
  readonly timeoutMs: number;
}

class LiveEvalCliError extends Data.TaggedError("LiveEvalCliError")<{
  readonly reason:
    | "dirty-source"
    | "git-preflight-failed"
    | "invalid-arguments"
    | "invalid-credentials"
    | "codex-preflight-failed"
    | "trial-failed"
    | "catalog-preflight-failed"
    | "report-exists"
    | "report-write-failed";
}> {}

const usage =
  "Usage: bun run eval:<responses|codex> -- --suite <suite.yaml> --run-id <id> --candidate <id> --model <model> --reasoning <mode> --repetitions <3..5> --account-class <class> [--case <id>] --timeout-ms <n>";

const parsePositiveInteger = (value: string | undefined): number | undefined => {
  if (value === undefined || !/^\d+$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const parseOptions = (
  argv: readonly string[],
): Effect.Effect<LiveEvalCliOptions, LiveEvalCliError> =>
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
    const caseIds: string[] = [];

    for (let index = 0; index < argv.length; index += 1) {
      const flag = argv[index];
      const value = argv[index + 1];
      if (value === undefined || value.trim().length === 0) {
        return yield* new LiveEvalCliError({ reason: "invalid-arguments" });
      }
      switch (flag) {
        case "--runner":
          if (value !== "responses" && value !== "codex") {
            return yield* new LiveEvalCliError({ reason: "invalid-arguments" });
          }
          runner = value;
          break;
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

    return {
      runner,
      suitePath,
      runId,
      candidate,
      model,
      reasoning,
      repetitions,
      accountClass,
      ...(caseIds.length === 0 ? {} : { caseIds }),
      timeoutMs,
    };
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

const requireRedacted = (
  value: Redacted.Redacted,
): Effect.Effect<Redacted.Redacted, LiveEvalCliError> => {
  const trimmed = Redacted.value(value).trim();
  return trimmed.length === 0
    ? Effect.fail(new LiveEvalCliError({ reason: "invalid-credentials" }))
    : Effect.succeed(Redacted.make(trimmed));
};
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
      pluginManifest.skills !== "./skills" ||
      pluginManifest.mcpServers !== "./targets/claude/.mcp.json"
    ) {
      return yield* new LiveEvalCliError({ reason: "codex-preflight-failed" });
    }
    const mcpConfig = yield* fs
      .readFileString(path.join(installedRoot, "targets", "claude", ".mcp.json"))
      .pipe(
        Effect.map(parseJsonObject),
        Effect.mapError(() => new LiveEvalCliError({ reason: "codex-preflight-failed" })),
      );
    const mcpServers = mcpConfig?.mcpServers;
    const ginaServer = isJsonObject(mcpServers) ? mcpServers[CODEX_MCP_SERVER_NAME] : undefined;
    if (
      !isJsonObject(mcpServers) ||
      !isJsonObject(ginaServer) ||
      Object.keys(mcpServers).length !== 1 ||
      ginaServer.type !== "http" ||
      ginaServer.url !== PRODUCTION_MCP_URL
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

const requireLiveCatalog = (accessToken: Redacted.Redacted<string>) => {
  const client = createClient({
    accessToken: Redacted.value(accessToken),
  });
  return client.listTools().pipe(
    Effect.map((tools) => tools.map((tool) => tool.name)),
    Effect.mapError(() => new LiveEvalCliError({ reason: "catalog-preflight-failed" })),
  );
};

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

const writeReport = (root: string, report: SanitizedEvalRunReport) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = path.join(root, ".plugin-eval-runs");
    const output = path.join(
      directory,
      `${report.target}-${report.candidate}-${report.runId}.json`,
    );
    const encoded = yield* encodePrettyUnknownJson(report).pipe(
      Effect.map((json) => `${json}\n`),
      Effect.mapError(() => new LiveEvalCliError({ reason: "report-write-failed" })),
    );
    yield* fs
      .makeDirectory(directory, { recursive: true })
      .pipe(Effect.mapError(() => new LiveEvalCliError({ reason: "report-write-failed" })));
    yield* fs
      .writeFileString(output, encoded, { flag: "wx", mode: 0o600 })
      .pipe(Effect.mapError(() => new LiveEvalCliError({ reason: "report-exists" })));
  });

const run = (options: LiveEvalCliOptions) =>
  Effect.gen(function* () {
    const root = process.cwd();
    const suite = yield* loadPluginEvalSuite(options.suitePath);
    yield* preflightLiveEvalSuite(suite).pipe(
      Effect.mapError(() => new LiveEvalCliError({ reason: "catalog-preflight-failed" })),
    );
    const codexEnvironment = yield* loadCodexEnvironment();
    yield* requireCleanSource(root, codexEnvironment);
    let codexRuntime: CodexEvalRuntime | undefined;
    if (options.runner === "codex") {
      const executablePath = yield* Config.string("CODEX_EVAL_EXECUTABLE").pipe(
        Effect.mapError(() => new LiveEvalCliError({ reason: "codex-preflight-failed" })),
      );
      const expectedSha256 = yield* Config.string("CODEX_EVAL_EXECUTABLE_SHA256").pipe(
        Effect.map((value) => value.trim().toLowerCase()),
        Effect.mapError(() => new LiveEvalCliError({ reason: "codex-preflight-failed" })),
      );
      const executable = yield* attestCodexExecutable({
        executablePath,
        expectedSha256,
        forbiddenRoots: [root],
      }).pipe(Effect.mapError(() => new LiveEvalCliError({ reason: "codex-preflight-failed" })));
      codexRuntime = yield* setupCodexRuntime(root, executable, codexEnvironment);
    }
    const accessToken = yield* Config.redacted("ASK_GINA_ACCESS_TOKEN").pipe(
      Effect.flatMap(requireRedacted),
      Effect.mapError(() => new LiveEvalCliError({ reason: "invalid-credentials" })),
    );
    const apiKey = yield* Config.redacted("OPENAI_API_KEY").pipe(
      Effect.flatMap(requireRedacted),
      Effect.mapError(() => new LiveEvalCliError({ reason: "invalid-credentials" })),
    );
    const availableTools = yield* requireLiveCatalog(accessToken);
    if (codexRuntime !== undefined) {
      yield* seedCodexOAuthCredential(codexRuntime, accessToken);
      yield* requireCodexPluginAuth(codexRuntime, codexEnvironment);
    }

    const report = yield* runLiveEvalSuite<
      LiveEvalCliError,
      HttpClient.HttpClient | ChildProcessSpawner | FileSystem.FileSystem | Path.Path
    >(
      {
        suite,
        ...(options.caseIds === undefined ? {} : { caseIds: options.caseIds }),
        runId: options.runId,
        candidate: options.candidate,
        target: options.runner === "responses" ? "responses_api" : "codex_cli",
        model: options.model,
        displayedModel: options.model,
        reasoning: options.reasoning,
        repetitions: options.repetitions,
        accountClass: options.accountClass,
      },
      (input) => {
        if (options.runner === "responses") {
          return runResponsesApiPluginEvalTrial(input.evalCase, {
            apiKey: Redacted.value(apiKey),
            mcpAuthorization: Redacted.value(accessToken),
            model: options.model,
            reasoning: options.reasoning,
            runId: input.runId,
            repetition: input.repetition,
            serverUrl: PRODUCTION_MCP_URL,
            allowedTools: listCatalogToolNames(),
            timeoutMs: options.timeoutMs,
          }).pipe(Effect.mapError(() => new LiveEvalCliError({ reason: "trial-failed" })));
        }
        if (codexRuntime === undefined) {
          return Effect.fail(new LiveEvalCliError({ reason: "codex-preflight-failed" }));
        }
        return runCodexCliPluginEvalTrial(input.evalCase, {
          openAiApiKey: apiKey,
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
          parentEnvironment: codexEnvironment,
          availableTools,
          timeoutMs: options.timeoutMs,
        }).pipe(Effect.mapError(() => new LiveEvalCliError({ reason: "trial-failed" })));
      },
    );
    yield* writeReport(root, report);
    yield* Console.log(
      `sanitized eval report written (${report.aggregate.overall.passed}/${report.aggregate.overall.total} passed)`,
    );
    return report.aggregate.overall.passed === report.aggregate.overall.total ? 0 : 2;
  });

const program = parseOptions(process.argv.slice(2)).pipe(
  Effect.flatMap(run),
  Effect.matchEffect({
    onFailure: (error) =>
      Console.error(
        errorTag(error) === "LiveEvalCliError" &&
          typeof error === "object" &&
          error !== null &&
          Reflect.get(error, "reason") === "invalid-arguments"
          ? usage
          : `live eval failed (${errorTag(error)})`,
      ).pipe(Effect.as(1)),
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

BunRuntime.runMain(main);
