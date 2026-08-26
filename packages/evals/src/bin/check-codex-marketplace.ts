#!/usr/bin/env bun

import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import { ASK_GINA_SKILL_DEFINITIONS, PRODUCTION_MCP_URL } from "@askgina/contracts";
import { Console, Data, Duration, Effect, FileSystem, Function, Layer, Path, Schema } from "effect";
import { ChildProcess } from "effect/unstable/process";
import type { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";

import { collectBoundedUtf8Output } from "../bounded-output";
import { CODEX_CLI_ALLOWED_ENVIRONMENT_NAMES } from "../codex-cli";

const DEFAULT_REPOSITORY = "askgina/plugins";
const DEFAULT_EXECUTABLE = "codex";
const DEFAULT_TIMEOUT_MS = 120_000;
const REPOSITORY_TOKEN_ENVIRONMENT_NAME = "CODEX_MARKETPLACE_REPOSITORY_TOKEN";
const MAXIMUM_OUTPUT_BYTES = 1_048_576;
const MARKETPLACE_NAME = "ask-gina-plugins";
const PLUGIN_NAME = "ask-gina";
const PLUGIN_ID = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;
const IMMUTABLE_REF_RE = /^[0-9a-f]{40}$/iu;
const REPOSITORY_RE = /^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,38})\/[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,99})$/u;
const UnknownJson = Schema.fromJsonString(Schema.Unknown);
const decodeUnknownJson = Schema.decodeUnknownOption(UnknownJson);

export type CodexMarketplaceSmokeStage =
  | "arguments"
  | "environment"
  | "marketplace-add"
  | "marketplace-list"
  | "plugin-add"
  | "inspection"
  | "plugin-remove"
  | "marketplace-remove";

export class CodexMarketplaceSmokeError extends Data.TaggedError("CodexMarketplaceSmokeError")<{
  readonly stage: CodexMarketplaceSmokeStage;
  readonly reason:
    | "command-failed"
    | "invalid-arguments"
    | "invalid-json"
    | "invalid-output"
    | "invalid-plugin"
    | "io-failed"
    | "timeout";
  readonly detail: string;
}> {}

export interface CodexMarketplaceSmokeOptions {
  readonly repository: string;
  readonly ref: string;
  readonly executable: string;
  readonly timeoutMs: number;
}

export interface CodexMarketplaceIsolation {
  readonly root: string;
  readonly home: string;
  readonly codexHome: string;
  readonly configHome: string;
  readonly cacheHome: string;
  readonly dataHome: string;
  readonly stateHome: string;
  readonly runtimeDirectory: string;
  readonly workingDirectory: string;
}

export interface MarketplaceCommandInput {
  readonly stage: Exclude<CodexMarketplaceSmokeStage, "arguments" | "environment" | "inspection">;
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
}

export interface MarketplaceCommandResult {
  readonly stdout: string;
  readonly stderr: string;
}

export interface MarketplaceCommandRunner {
  readonly run: (
    input: MarketplaceCommandInput,
  ) => Effect.Effect<
    MarketplaceCommandResult,
    CodexMarketplaceSmokeError,
    ChildProcessSpawner | FileSystem.FileSystem | Path.Path
  >;
}
export interface CodexMarketplaceSmokeRunOptions extends CodexMarketplaceSmokeOptions {
  readonly runner?: MarketplaceCommandRunner;
  readonly parentEnvironment?: Readonly<Record<string, string | undefined>>;
}

export interface CodexMarketplaceSmokeResult {
  readonly repository: string;
  readonly ref: string;
  readonly marketplaceName: string;
  readonly pluginId: string;
}

const fail = (
  stage: CodexMarketplaceSmokeStage,
  reason: CodexMarketplaceSmokeError["reason"],
  detail: string,
): Effect.Effect<never, CodexMarketplaceSmokeError> =>
  Effect.fail(new CodexMarketplaceSmokeError({ stage, reason, detail }));

const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const decodeJson = (
  stage: CodexMarketplaceSmokeStage,
  output: string,
): Effect.Effect<unknown, CodexMarketplaceSmokeError> => {
  const decoded = decodeUnknownJson(output);
  return decoded._tag === "Some"
    ? Effect.succeed(decoded.value)
    : fail(stage, "invalid-json", `${stage} did not emit valid JSON`);
};

const stringProperty = (
  object: Readonly<Record<string, unknown>>,
  names: readonly string[],
): string | undefined => {
  for (const name of names) {
    const value = object[name];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
};

export const parseCodexMarketplaceSmokeArgs = (
  argv: readonly string[],
): Effect.Effect<CodexMarketplaceSmokeOptions, CodexMarketplaceSmokeError> =>
  Effect.gen(function* () {
    let repository = DEFAULT_REPOSITORY;
    let ref: string | undefined;
    let executable = DEFAULT_EXECUTABLE;
    let timeoutMs = DEFAULT_TIMEOUT_MS;
    const seen = new Set<string>();

    for (let index = 0; index < argv.length; index += 2) {
      const name = argv[index];
      const value = argv[index + 1];
      if (
        name === undefined ||
        value === undefined ||
        !["--repository", "--ref", "--executable", "--timeout-ms"].includes(name) ||
        seen.has(name)
      ) {
        return yield* fail("arguments", "invalid-arguments", "invalid marketplace smoke arguments");
      }
      seen.add(name);
      if (name === "--repository") repository = value;
      else if (name === "--ref") ref = value;
      else if (name === "--executable") executable = value;
      else {
        timeoutMs = Number(value);
      }
    }

    if (!REPOSITORY_RE.test(repository)) {
      return yield* fail(
        "arguments",
        "invalid-arguments",
        "--repository must be a remote owner/repo",
      );
    }
    if (ref === undefined || !IMMUTABLE_REF_RE.test(ref)) {
      return yield* fail(
        "arguments",
        "invalid-arguments",
        "--ref must be a full immutable 40-character commit SHA",
      );
    }
    if (executable.length === 0 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000) {
      return yield* fail("arguments", "invalid-arguments", "invalid executable or timeout");
    }
    return { repository, ref: ref.toLowerCase(), executable, timeoutMs };
  });

export const buildCodexMarketplaceEnvironment: {
  (
    parentEnvironment: Readonly<Record<string, string | undefined>>,
  ): (isolation: CodexMarketplaceIsolation) => Record<string, string>;
  (
    isolation: CodexMarketplaceIsolation,
    parentEnvironment: Readonly<Record<string, string | undefined>>,
  ): Record<string, string>;
} = Function.dual(
  2,
  (
    isolation: CodexMarketplaceIsolation,
    parentEnvironment: Readonly<Record<string, string | undefined>>,
  ): Record<string, string> => {
    const environment: Record<string, string> = {};
    for (const name of CODEX_CLI_ALLOWED_ENVIRONMENT_NAMES) {
      const value = parentEnvironment[name];
      if (value !== undefined) environment[name] = value;
    }
    return {
      ...environment,
      HOME: isolation.home,
      CODEX_HOME: isolation.codexHome,
      USERPROFILE: isolation.home,
      XDG_CONFIG_HOME: isolation.configHome,
      XDG_CACHE_HOME: isolation.cacheHome,
      XDG_DATA_HOME: isolation.dataHome,
      XDG_STATE_HOME: isolation.stateHome,
      XDG_RUNTIME_DIR: isolation.runtimeDirectory,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
      NO_COLOR: "1",
    };
  },
);
const withGitAskpass = (
  environment: Readonly<Record<string, string>>,
  askpassFile: string,
): Record<string, string> => ({
  ...environment,
  GIT_ASKPASS: askpassFile,
});

export const parseMarketplaceAddOutput = (
  output: string,
): Effect.Effect<
  { readonly marketplaceName: string; readonly installedRoot: string },
  CodexMarketplaceSmokeError
> =>
  Effect.gen(function* () {
    const decoded = yield* decodeJson("marketplace-add", output);
    if (!isJsonObject(decoded)) {
      return yield* fail(
        "marketplace-add",
        "invalid-output",
        "marketplace add JSON must be an object",
      );
    }
    const marketplaceName = stringProperty(decoded, ["marketplaceName"]);
    const installedRoot = stringProperty(decoded, ["installedRoot"]);
    if (
      marketplaceName !== MARKETPLACE_NAME ||
      installedRoot === undefined ||
      decoded.alreadyAdded !== false
    ) {
      return yield* fail(
        "marketplace-add",
        "invalid-output",
        `expected a fresh ${MARKETPLACE_NAME} marketplace and an installed root`,
      );
    }
    return { marketplaceName, installedRoot };
  });

export const parseMarketplaceListOutput: {
  (marketplaceRoot: string): (output: string) => Effect.Effect<void, CodexMarketplaceSmokeError>;
  (output: string, marketplaceRoot: string): Effect.Effect<void, CodexMarketplaceSmokeError>;
} = Function.dual(2, (output: string, marketplaceRoot: string) =>
  Effect.gen(function* () {
    const decoded = yield* decodeJson("marketplace-list", output);
    if (
      !isJsonObject(decoded) ||
      !Array.isArray(decoded.installed) ||
      !Array.isArray(decoded.available) ||
      decoded.installed.length !== 0 ||
      decoded.available.length !== 1 ||
      !isJsonObject(decoded.available[0])
    ) {
      return yield* fail(
        "marketplace-list",
        "invalid-output",
        "available listing must contain exactly one uninstalled Ask Gina plugin",
      );
    }
    const entry = decoded.available[0];
    if (
      entry.pluginId !== PLUGIN_ID ||
      entry.name !== PLUGIN_NAME ||
      entry.marketplaceName !== MARKETPLACE_NAME ||
      entry.installed !== false ||
      entry.enabled !== false ||
      typeof entry.version !== "string" ||
      entry.version.length === 0
    ) {
      return yield* fail(
        "marketplace-list",
        "invalid-output",
        `available listing did not contain ${PLUGIN_ID}`,
      );
    }
    if (entry.installPolicy !== "AVAILABLE") {
      return yield* fail(
        "marketplace-list",
        "invalid-output",
        "Ask Gina installation policy must be AVAILABLE",
      );
    }
    if (entry.authPolicy !== "ON_INSTALL") {
      return yield* fail(
        "marketplace-list",
        "invalid-output",
        "Ask Gina authentication listing metadata must be ON_INSTALL",
      );
    }
    const source = entry.source;
    const sourcePath =
      isJsonObject(source) && typeof source.path === "string" ? source.path : undefined;
    const normalizedSourcePath = sourcePath?.replaceAll("\\", "/").replace(/\/+$/u, "");
    const normalizedMarketplaceRoot = marketplaceRoot.replaceAll("\\", "/").replace(/\/+$/u, "");
    const marketplaceSource = entry.marketplaceSource;
    if (
      !isJsonObject(source) ||
      source.source !== "local" ||
      normalizedSourcePath !== `${normalizedMarketplaceRoot}/plugins/ask-gina` ||
      !isJsonObject(marketplaceSource) ||
      marketplaceSource.sourceType !== "git" ||
      typeof marketplaceSource.source !== "string" ||
      marketplaceSource.source.length === 0
    ) {
      return yield* fail(
        "marketplace-list",
        "invalid-output",
        "Ask Gina marketplace source must resolve to plugins/ask-gina",
      );
    }
  }),
);

export const parsePluginAddOutput = (
  output: string,
): Effect.Effect<{ readonly installedPath: string }, CodexMarketplaceSmokeError> =>
  Effect.gen(function* () {
    const decoded = yield* decodeJson("plugin-add", output);
    if (!isJsonObject(decoded)) {
      return yield* fail("plugin-add", "invalid-output", "plugin add JSON must be an object");
    }
    const pluginId = stringProperty(decoded, ["pluginId"]);
    const installedPath = stringProperty(decoded, ["installedPath"]);
    if (
      pluginId !== PLUGIN_ID ||
      decoded.name !== PLUGIN_NAME ||
      decoded.marketplaceName !== MARKETPLACE_NAME ||
      typeof decoded.version !== "string" ||
      decoded.version.length === 0 ||
      decoded.authPolicy !== "ON_INSTALL" ||
      installedPath === undefined
    ) {
      return yield* fail(
        "plugin-add",
        "invalid-output",
        `expected installed plugin ${PLUGIN_ID} with ON_INSTALL metadata and an installed path`,
      );
    }
    return { installedPath };
  });

const readJsonObject = (
  file: string,
): Effect.Effect<
  Readonly<Record<string, unknown>>,
  CodexMarketplaceSmokeError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const text = yield* fs.readFileString(file).pipe(
      Effect.mapError(
        () =>
          new CodexMarketplaceSmokeError({
            stage: "inspection",
            reason: "io-failed",
            detail: `cannot read installed file ${file}`,
          }),
      ),
    );
    const decoded = yield* decodeJson("inspection", text);
    if (!isJsonObject(decoded)) {
      return yield* fail("inspection", "invalid-plugin", `${file} must contain a JSON object`);
    }
    return decoded;
  });

const requireNonEmptyRegularFile = (
  file: string,
): Effect.Effect<void, CodexMarketplaceSmokeError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const info = yield* fs.stat(file).pipe(
      Effect.mapError(
        () =>
          new CodexMarketplaceSmokeError({
            stage: "inspection",
            reason: "io-failed",
            detail: `cannot inspect installed file ${file}`,
          }),
      ),
    );
    if (info.type !== "File" || Number(info.size) <= 0) {
      return yield* fail(
        "inspection",
        "invalid-plugin",
        `${file} must be a non-empty regular file`,
      );
    }
  });

export const inspectInstalledAskGinaPlugin = (
  installedRoot: string,
): Effect.Effect<void, CodexMarketplaceSmokeError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const manifest = yield* readJsonObject(
      path.join(installedRoot, ".codex-plugin", "plugin.json"),
    );
    const pluginInterface = manifest.interface;
    if (
      manifest.name !== PLUGIN_NAME ||
      manifest.skills !== "./skills/" ||
      manifest.mcpServers !== "./.mcp.json" ||
      !isJsonObject(pluginInterface) ||
      pluginInterface.composerIcon !== "./assets/icon.svg" ||
      pluginInterface.logo !== "./assets/icon.svg"
    ) {
      return yield* fail(
        "inspection",
        "invalid-plugin",
        "installed Codex manifest does not match the Ask Gina root contract",
      );
    }

    const mcp = yield* readJsonObject(path.join(installedRoot, ".mcp.json"));
    const mcpServers = mcp.mcpServers;
    const server = isJsonObject(mcpServers) ? mcpServers[PLUGIN_NAME] : undefined;
    if (
      !isJsonObject(mcpServers) ||
      Object.keys(mcpServers).length !== 1 ||
      !isJsonObject(server) ||
      server.type !== "http" ||
      server.url !== PRODUCTION_MCP_URL
    ) {
      return yield* fail(
        "inspection",
        "invalid-plugin",
        "installed root MCP configuration must contain only the ask-gina HTTP server",
      );
    }

    yield* requireNonEmptyRegularFile(path.join(installedRoot, "assets", "icon.svg"));
    const skillsRoot = path.join(installedRoot, "skills");
    const actualSkills = (yield* fs.readDirectory(skillsRoot).pipe(
      Effect.mapError(
        () =>
          new CodexMarketplaceSmokeError({
            stage: "inspection",
            reason: "io-failed",
            detail: "cannot list installed Ask Gina skills",
          }),
      ),
    )).sort();
    const expectedSkills = ASK_GINA_SKILL_DEFINITIONS.map((skill) => skill.name).sort();
    if (
      actualSkills.length !== expectedSkills.length ||
      !actualSkills.every((skill, index) => skill === expectedSkills[index])
    ) {
      return yield* fail(
        "inspection",
        "invalid-plugin",
        "installed Ask Gina skill inventory does not match the canonical catalog",
      );
    }
    yield* Effect.forEach(
      expectedSkills,
      (skill) =>
        Effect.all([
          requireNonEmptyRegularFile(path.join(skillsRoot, skill, "SKILL.md")),
          requireNonEmptyRegularFile(path.join(skillsRoot, skill, "agents", "openai.yaml")),
        ]),
      { concurrency: "unbounded", discard: true },
    );
  });

const commandDiagnostic = (result: MarketplaceCommandResult): string => {
  const diagnostic = result.stderr.trim() || result.stdout.trim() || "no diagnostic output";
  return diagnostic.replaceAll(/\s+/gu, " ").slice(0, 2_000);
};

export const effectMarketplaceCommandRunner: MarketplaceCommandRunner = {
  run: (input) =>
    Effect.scoped(
      Effect.gen(function* () {
        const child = yield* ChildProcess.make(input.executable, input.args, {
          cwd: input.cwd,
          env: { ...input.environment },
          extendEnv: false,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        }).pipe(
          Effect.mapError(
            () =>
              new CodexMarketplaceSmokeError({
                stage: input.stage,
                reason: "command-failed",
                detail: `${input.stage} could not start`,
              }),
          ),
        );
        const [stdout, stderr, exitCode] = yield* Effect.all(
          [
            collectBoundedUtf8Output(child.stdout, MAXIMUM_OUTPUT_BYTES),
            collectBoundedUtf8Output(child.stderr, MAXIMUM_OUTPUT_BYTES),
            child.exitCode,
          ],
          { concurrency: "unbounded" },
        ).pipe(
          Effect.mapError(
            () =>
              new CodexMarketplaceSmokeError({
                stage: input.stage,
                reason: "command-failed",
                detail: `${input.stage} output could not be collected`,
              }),
          ),
        );
        const result = { stdout: stdout.text, stderr: stderr.text };
        if (exitCode !== 0 || stdout.truncated || stderr.truncated) {
          return yield* fail(
            input.stage,
            "command-failed",
            `${input.stage} failed (exit ${exitCode}): ${commandDiagnostic(result)}`,
          );
        }
        return result;
      }).pipe(
        Effect.timeoutOrElse({
          duration: Duration.millis(input.timeoutMs),
          orElse: () =>
            fail(input.stage, "timeout", `${input.stage} exceeded ${input.timeoutMs}ms`),
        }),
      ),
    ),
};

const isWithin = (path: Path.Path, parent: string, child: string): boolean => {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
};

export const runCodexMarketplaceSmoke = (
  options: CodexMarketplaceSmokeRunOptions,
): Effect.Effect<
  CodexMarketplaceSmokeResult,
  CodexMarketplaceSmokeError,
  ChildProcessSpawner | FileSystem.FileSystem | Path.Path
> => {
  const runner = options.runner ?? effectMarketplaceCommandRunner;
  const parentEnvironment = options.parentEnvironment ?? process.env;
  return Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs
        .makeTempDirectoryScoped({ prefix: "ask-gina-codex-marketplace-" })
        .pipe(
          Effect.mapError(
            () =>
              new CodexMarketplaceSmokeError({
                stage: "environment",
                reason: "io-failed",
                detail: "cannot create isolated marketplace directory",
              }),
          ),
        );
      const isolation: CodexMarketplaceIsolation = {
        root,
        home: path.join(root, "home"),
        codexHome: path.join(root, "codex"),
        configHome: path.join(root, "xdg", "config"),
        cacheHome: path.join(root, "xdg", "cache"),
        dataHome: path.join(root, "xdg", "data"),
        stateHome: path.join(root, "xdg", "state"),
        runtimeDirectory: path.join(root, "xdg", "runtime"),
        workingDirectory: path.join(root, "work"),
      };
      const repositoryToken = parentEnvironment[REPOSITORY_TOKEN_ENVIRONMENT_NAME];
      if (
        repositoryToken !== undefined &&
        (repositoryToken.length === 0 || /[\r\n]/u.test(repositoryToken))
      ) {
        return yield* fail(
          "environment",
          "invalid-arguments",
          `${REPOSITORY_TOKEN_ENVIRONMENT_NAME} must be non-empty and single-line when provided`,
        );
      }
      yield* Effect.forEach(
        [
          isolation.home,
          isolation.codexHome,
          isolation.configHome,
          isolation.cacheHome,
          isolation.dataHome,
          isolation.stateHome,
          isolation.runtimeDirectory,
          isolation.workingDirectory,
        ],
        (directory) => fs.makeDirectory(directory, { recursive: true }),
        { concurrency: "unbounded", discard: true },
      ).pipe(
        Effect.mapError(
          () =>
            new CodexMarketplaceSmokeError({
              stage: "environment",
              reason: "io-failed",
              detail: "cannot initialize isolated marketplace directories",
            }),
        ),
      );
      yield* fs
        .writeFileString(path.join(isolation.codexHome, "config.toml"), "", {
          flag: "wx",
          mode: 0o600,
        })
        .pipe(
          Effect.mapError(
            () =>
              new CodexMarketplaceSmokeError({
                stage: "environment",
                reason: "io-failed",
                detail: "cannot initialize isolated Codex configuration",
              }),
          ),
        );
      const environment = buildCodexMarketplaceEnvironment(isolation, parentEnvironment);
      const repositoryTokenFile = path.join(isolation.home, ".repository-token");
      const gitAskpassFile = path.join(isolation.home, "git-askpass");
      if (repositoryToken !== undefined) {
        yield* fs
          .writeFileString(repositoryTokenFile, repositoryToken, { flag: "wx", mode: 0o600 })
          .pipe(
            Effect.mapError(
              () =>
                new CodexMarketplaceSmokeError({
                  stage: "environment",
                  reason: "io-failed",
                  detail: "cannot initialize isolated repository token",
                }),
            ),
          );
        yield* fs
          .writeFileString(
            gitAskpassFile,
            `#!/bin/sh
case "$1" in
  *sername*) printf '%s\\n' 'x-access-token' ;;
  *assword*) cat "$HOME/.repository-token" ;;
  *) exit 1 ;;
esac
`,
            { flag: "wx", mode: 0o700 },
          )
          .pipe(
            Effect.mapError(
              () =>
                new CodexMarketplaceSmokeError({
                  stage: "environment",
                  reason: "io-failed",
                  detail: "cannot initialize isolated Git askpass helper",
                }),
            ),
          );
      }
      const marketplaceAddEnvironment =
        repositoryToken === undefined ? environment : withGitAskpass(environment, gitAskpassFile);
      const removeRepositoryCredentials =
        repositoryToken === undefined
          ? Effect.void
          : Effect.gen(function* () {
              const credentialFiles = [repositoryTokenFile, gitAskpassFile] as const;
              for (const file of credentialFiles) {
                if (yield* fs.exists(file)) yield* fs.remove(file);
              }
              for (const file of credentialFiles) {
                if (yield* fs.exists(file)) {
                  return yield* fail(
                    "environment",
                    "io-failed",
                    "isolated repository credentials remain after marketplace clone",
                  );
                }
              }
            }).pipe(
              Effect.mapError(
                () =>
                  new CodexMarketplaceSmokeError({
                    stage: "environment",
                    reason: "io-failed",
                    detail: "cannot remove isolated repository credentials",
                  }),
              ),
            );
      const runCommand = (
        stage: MarketplaceCommandInput["stage"],
        args: readonly string[],
        commandEnvironment: Readonly<Record<string, string>> = environment,
      ): Effect.Effect<
        MarketplaceCommandResult,
        CodexMarketplaceSmokeError,
        ChildProcessSpawner | FileSystem.FileSystem | Path.Path
      > =>
        runner.run({
          stage,
          executable: options.executable,
          args,
          cwd: isolation.workingDirectory,
          environment: commandEnvironment,
          timeoutMs: options.timeoutMs,
        });
      const cleanup = Effect.gen(function* () {
        yield* runCommand("plugin-remove", ["plugin", "remove", PLUGIN_ID, "--json"]).pipe(
          Effect.ignore,
        );
        yield* runCommand("marketplace-remove", [
          "plugin",
          "marketplace",
          "remove",
          MARKETPLACE_NAME,
          "--json",
        ]).pipe(Effect.ignore);
      });

      return yield* Effect.gen(function* () {
        const marketplaceAttempt = yield* Effect.result(
          runCommand(
            "marketplace-add",
            ["plugin", "marketplace", "add", options.repository, "--ref", options.ref, "--json"],
            marketplaceAddEnvironment,
          ),
        );
        yield* removeRepositoryCredentials;
        if (marketplaceAttempt._tag === "Failure") return yield* marketplaceAttempt.failure;
        const marketplaceResult = marketplaceAttempt.success;
        const marketplace = yield* parseMarketplaceAddOutput(marketplaceResult.stdout);
        const marketplaceRoot = yield* fs.realPath(marketplace.installedRoot).pipe(
          Effect.mapError(
            () =>
              new CodexMarketplaceSmokeError({
                stage: "marketplace-add",
                reason: "invalid-output",
                detail: "marketplace installed root cannot be resolved",
              }),
          ),
        );
        if (!isWithin(path, root, marketplaceRoot)) {
          return yield* fail(
            "marketplace-add",
            "invalid-output",
            "marketplace installed outside the isolated temporary root",
          );
        }

        const listResult = yield* runCommand("marketplace-list", [
          "plugin",
          "list",
          "--marketplace",
          MARKETPLACE_NAME,
          "--available",
          "--json",
        ]);
        yield* parseMarketplaceListOutput(listResult.stdout, marketplaceRoot);

        const installResult = yield* runCommand("plugin-add", [
          "plugin",
          "add",
          PLUGIN_ID,
          "--json",
        ]);
        const install = yield* parsePluginAddOutput(installResult.stdout);
        const installedRoot = yield* fs.realPath(install.installedPath).pipe(
          Effect.mapError(
            () =>
              new CodexMarketplaceSmokeError({
                stage: "plugin-add",
                reason: "invalid-output",
                detail: "plugin installed path cannot be resolved",
              }),
          ),
        );
        if (!isWithin(path, isolation.codexHome, installedRoot)) {
          return yield* fail(
            "plugin-add",
            "invalid-output",
            "plugin installed outside the isolated Codex home",
          );
        }
        yield* inspectInstalledAskGinaPlugin(installedRoot);
        return {
          repository: options.repository,
          ref: options.ref,
          marketplaceName: MARKETPLACE_NAME,
          pluginId: PLUGIN_ID,
        };
      }).pipe(Effect.ensuring(cleanup));
    }),
  );
};

const usage =
  "usage: check-codex-marketplace --ref <40-character-sha> [--repository owner/repo] [--executable path] [--timeout-ms ms]";

const program = parseCodexMarketplaceSmokeArgs(process.argv.slice(2)).pipe(
  Effect.flatMap(runCodexMarketplaceSmoke),
  Effect.matchEffect({
    onFailure: (error) =>
      Console.error(
        error.stage === "arguments"
          ? usage
          : `Codex marketplace smoke failed at ${error.stage}: ${error.detail}`,
      ).pipe(Effect.as(1)),
    onSuccess: (result) =>
      Console.log(
        JSON.stringify({
          ok: true,
          repository: result.repository,
          ref: result.ref,
          marketplaceName: result.marketplaceName,
          pluginId: result.pluginId,
        }),
      ).pipe(Effect.as(0)),
  }),
  Effect.tap((exitCode) =>
    Effect.sync(() => {
      if (exitCode !== 0) process.exitCode = exitCode;
    }),
  ),
);

const main = Layer.build(BunServices.layer).pipe(
  Effect.flatMap((context) => program.pipe(Effect.provide(context))),
  Effect.scoped,
);

if (import.meta.main) {
  BunRuntime.runMain(main);
}
