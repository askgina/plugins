import * as BunServices from "@effect/platform-bun/BunServices";
import { ASK_GINA_SKILL_DEFINITIONS, PRODUCTION_MCP_URL } from "@askgina/contracts";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Path, Schema } from "effect";

import {
  buildCodexMarketplaceEnvironment,
  CodexMarketplaceSmokeError,
  inspectInstalledAskGinaPlugin,
  type MarketplaceCommandInput,
  type MarketplaceCommandRunner,
  parseCodexMarketplaceSmokeArgs,
  parseMarketplaceAddOutput,
  parseMarketplaceListOutput,
  parsePluginAddOutput,
  runCodexMarketplaceSmoke,
  type CodexMarketplaceIsolation,
} from "../src/bin/check-codex-marketplace";

const IMMUTABLE_REF = "1234567890abcdef1234567890abcdef12345678";
const OPTIONS = {
  repository: "askgina/plugins",
  ref: IMMUTABLE_REF,
  executable: "codex-test",
  timeoutMs: 30_000,
} as const;
const JsonString = Schema.fromJsonString(Schema.Unknown);
const encodeJson = Schema.encodeUnknownSync(JsonString);

const writeInstalledPluginFixture = (
  installedRoot: string,
): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* Effect.forEach(
      [path.join(installedRoot, ".codex-plugin"), path.join(installedRoot, "assets")],
      (directory) => fs.makeDirectory(directory, { recursive: true }),
      { discard: true },
    );
    yield* Effect.all([
      fs.writeFileString(
        path.join(installedRoot, ".codex-plugin", "plugin.json"),
        encodeJson({
          name: "ask-gina",
          skills: "./skills/",
          mcpServers: "./.mcp.json",
          interface: {
            composerIcon: "./assets/icon.svg",
            logo: "./assets/icon.svg",
          },
        }),
      ),
      fs.writeFileString(
        path.join(installedRoot, ".mcp.json"),
        encodeJson({
          mcpServers: {
            "ask-gina": { type: "http", url: PRODUCTION_MCP_URL },
          },
        }),
      ),
      fs.writeFileString(path.join(installedRoot, "assets", "icon.svg"), "<svg></svg>"),
    ]);
    yield* Effect.forEach(
      ASK_GINA_SKILL_DEFINITIONS,
      (skill) =>
        Effect.gen(function* () {
          const skillRoot = path.join(installedRoot, "skills", skill.name);
          yield* fs.makeDirectory(path.join(skillRoot, "agents"), { recursive: true });
          yield* Effect.all([
            fs.writeFileString(path.join(skillRoot, "SKILL.md"), `# ${skill.name}\n`),
            fs.writeFileString(path.join(skillRoot, "agents", "openai.yaml"), "name: Ask Gina\n"),
          ]);
        }),
      { concurrency: "unbounded", discard: true },
    );
  }).pipe(Effect.orDie);

const marketplaceListing = (marketplaceRoot: string, authenticationPolicy = "ON_INSTALL"): string =>
  encodeJson({
    installed: [],
    available: [
      {
        pluginId: "ask-gina@ask-gina-plugins",
        name: "ask-gina",
        marketplaceName: "ask-gina-plugins",
        version: "0.1.0",
        installed: false,
        enabled: false,
        source: { source: "local", path: `${marketplaceRoot}/plugins/ask-gina` },
        marketplaceSource: { sourceType: "git", source: "askgina/plugins" },
        installPolicy: "AVAILABLE",
        authPolicy: authenticationPolicy,
      },
    ],
  });

const makeFakeRunner = (
  commands: MarketplaceCommandInput[],
  failStage?: MarketplaceCommandInput["stage"],
): MarketplaceCommandRunner => ({
  run: (input) =>
    Effect.gen(function* () {
      commands.push(input);
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const codexHome = input.environment.CODEX_HOME;
      if (codexHome === undefined) {
        return yield* new CodexMarketplaceSmokeError({
          stage: input.stage,
          reason: "command-failed",
          detail: "fake runner did not receive CODEX_HOME",
        });
      }
      if (input.stage === failStage) {
        return yield* new CodexMarketplaceSmokeError({
          stage: input.stage,
          reason: "command-failed",
          detail: `${input.stage} failed (exit 7): synthetic diagnostic`,
        });
      }
      const isolationRoot = path.dirname(codexHome);
      if (input.stage === "marketplace-add") {
        const marketplaceRoot = path.join(isolationRoot, "remote", "askgina-plugins");
        yield* fs.makeDirectory(marketplaceRoot, { recursive: true }).pipe(Effect.orDie);
        return {
          stdout: encodeJson({
            marketplaceName: "ask-gina-plugins",
            installedRoot: marketplaceRoot,
            alreadyAdded: false,
          }),
          stderr: "",
        };
      }
      if (input.stage === "marketplace-list") {
        return {
          stdout: marketplaceListing(path.join(isolationRoot, "remote", "askgina-plugins")),
          stderr: "",
        };
      }
      if (input.stage === "plugin-add") {
        const installedRoot = path.join(
          codexHome,
          "plugins",
          "cache",
          "ask-gina-plugins",
          "ask-gina",
          "0.1.0",
        );
        yield* writeInstalledPluginFixture(installedRoot);
        return {
          stdout: encodeJson({
            pluginId: "ask-gina@ask-gina-plugins",
            name: "ask-gina",
            marketplaceName: "ask-gina-plugins",
            version: "0.1.0",
            installedPath: installedRoot,
            authPolicy: "ON_INSTALL",
          }),
          stderr: "",
        };
      }
      return { stdout: "{}", stderr: "" };
    }),
});

describe("Codex marketplace smoke arguments and JSON", () => {
  it.effect("requires an immutable ref and accepts a remote owner/repo", () =>
    Effect.gen(function* () {
      const parsed = yield* parseCodexMarketplaceSmokeArgs([
        "--repository",
        "askgina/plugins",
        "--ref",
        IMMUTABLE_REF.toUpperCase(),
        "--executable",
        "/opt/codex",
        "--timeout-ms",
        "45000",
      ]);
      assert.deepStrictEqual(parsed, {
        repository: "askgina/plugins",
        ref: IMMUTABLE_REF,
        executable: "/opt/codex",
        timeoutMs: 45_000,
      });

      const missingRef = yield* Effect.result(parseCodexMarketplaceSmokeArgs([]));
      assert.strictEqual(missingRef._tag, "Failure");
      if (missingRef._tag === "Failure") {
        assert.strictEqual(missingRef.failure.reason, "invalid-arguments");
        assert.include(missingRef.failure.detail, "immutable");
      }
      const branchRef = yield* Effect.result(parseCodexMarketplaceSmokeArgs(["--ref", "main"]));
      assert.strictEqual(branchRef._tag, "Failure");
    }),
  );

  it.effect("parses marketplace and install JSON without treating ON_INSTALL as OAuth", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* parseMarketplaceAddOutput(
          encodeJson({
            marketplaceName: "ask-gina-plugins",
            installedRoot: "/tmp/marketplace",
            alreadyAdded: false,
          }),
        ),
        { marketplaceName: "ask-gina-plugins", installedRoot: "/tmp/marketplace" },
      );
      yield* parseMarketplaceListOutput(marketplaceListing("/tmp/marketplace"), "/tmp/marketplace");
      assert.deepStrictEqual(
        yield* parsePluginAddOutput(
          encodeJson({
            pluginId: "ask-gina@ask-gina-plugins",
            name: "ask-gina",
            marketplaceName: "ask-gina-plugins",
            version: "0.1.0",
            installedPath: "/tmp/plugin",
            authPolicy: "ON_INSTALL",
          }),
        ),
        { installedPath: "/tmp/plugin" },
      );

      const oauth = yield* Effect.result(
        parseMarketplaceListOutput(
          marketplaceListing("/tmp/marketplace", "OAUTH"),
          "/tmp/marketplace",
        ),
      );
      assert.strictEqual(oauth._tag, "Failure");
      if (oauth._tag === "Failure") {
        assert.include(oauth.failure.detail, "ON_INSTALL");
      }
      const malformed = yield* Effect.result(parseMarketplaceAddOutput("not-json"));
      assert.strictEqual(malformed._tag, "Failure");
      if (malformed._tag === "Failure") {
        assert.strictEqual(malformed.failure.reason, "invalid-json");
      }
    }),
  );
});

describe("Codex marketplace environment isolation", () => {
  it.effect("replaces home and XDG state while dropping credentials", () =>
    Effect.sync(() => {
      const isolation: CodexMarketplaceIsolation = {
        root: "/tmp/smoke",
        home: "/tmp/smoke/home",
        codexHome: "/tmp/smoke/codex",
        configHome: "/tmp/smoke/xdg/config",
        cacheHome: "/tmp/smoke/xdg/cache",
        dataHome: "/tmp/smoke/xdg/data",
        stateHome: "/tmp/smoke/xdg/state",
        runtimeDirectory: "/tmp/smoke/xdg/runtime",
        workingDirectory: "/tmp/smoke/work",
      };
      const environment = buildCodexMarketplaceEnvironment(isolation, {
        PATH: "/usr/bin:/bin",
        HOME: "/home/user",
        CODEX_HOME: "/home/user/.codex",
        XDG_CONFIG_HOME: "/home/user/.config",
        XDG_CACHE_HOME: "/home/user/.cache",
        CI: "true",
        OPENAI_API_KEY: "provider-secret",
        ASK_GINA_ACCESS_TOKEN: "gina-secret",
        GITHUB_TOKEN: "github-secret",
        SSH_AUTH_SOCK: "/tmp/agent.sock",
        HTTPS_PROXY: "http://proxy-secret",
      });

      assert.strictEqual(environment.HOME, isolation.home);
      assert.strictEqual(environment.CODEX_HOME, isolation.codexHome);
      assert.strictEqual(environment.XDG_CONFIG_HOME, isolation.configHome);
      assert.strictEqual(environment.XDG_CACHE_HOME, isolation.cacheHome);
      assert.strictEqual(environment.XDG_DATA_HOME, isolation.dataHome);
      assert.strictEqual(environment.XDG_STATE_HOME, isolation.stateHome);
      assert.strictEqual(environment.XDG_RUNTIME_DIR, isolation.runtimeDirectory);
      assert.strictEqual(environment.GIT_CONFIG_NOSYSTEM, "1");
      assert.strictEqual(environment.GIT_TERMINAL_PROMPT, "0");
      assert.strictEqual(environment.CI, "true");
      assert.notProperty(environment, "OPENAI_API_KEY");
      assert.notProperty(environment, "ASK_GINA_ACCESS_TOKEN");
      assert.notProperty(environment, "GITHUB_TOKEN");
      assert.notProperty(environment, "SSH_AUTH_SOCK");
      assert.notProperty(environment, "HTTPS_PROXY");
    }),
  );
});

describe("Codex marketplace smoke lifecycle", () => {
  it.layer(BunServices.layer)((it) => {
    it.effect("inspects root MCP files and cleans plugin, marketplace, and temporary state", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const commands: MarketplaceCommandInput[] = [];
        const result = yield* runCodexMarketplaceSmoke({
          ...OPTIONS,
          runner: makeFakeRunner(commands),
          parentEnvironment: {
            PATH: "/usr/bin:/bin",
            OPENAI_API_KEY: "must-not-leak",
          },
        });

        assert.deepStrictEqual(result, {
          repository: "askgina/plugins",
          ref: IMMUTABLE_REF,
          marketplaceName: "ask-gina-plugins",
          pluginId: "ask-gina@ask-gina-plugins",
        });
        assert.deepStrictEqual(
          commands.map((command) => command.stage),
          [
            "marketplace-add",
            "marketplace-list",
            "plugin-add",
            "plugin-remove",
            "marketplace-remove",
          ],
        );
        assert.deepStrictEqual(commands[0]?.args, [
          "plugin",
          "marketplace",
          "add",
          "askgina/plugins",
          "--ref",
          IMMUTABLE_REF,
          "--json",
        ]);
        assert.isFalse(
          commands.some((command) =>
            command.args.some((argument) => ["auth", "login", "oauth"].includes(argument)),
          ),
        );
        assert.notProperty(commands[0]?.environment ?? {}, "OPENAI_API_KEY");
        const codexHome = commands[0]?.environment.CODEX_HOME;
        if (codexHome === undefined) return yield* Effect.die("fake runner did not capture home");
        assert.isFalse(yield* fs.exists(path.dirname(codexHome)));
      }),
    );

    it.effect("runs cleanup and preserves failure diagnostics when a command fails", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const commands: MarketplaceCommandInput[] = [];
        const result = yield* Effect.result(
          runCodexMarketplaceSmoke({
            ...OPTIONS,
            runner: makeFakeRunner(commands, "marketplace-list"),
            parentEnvironment: { PATH: "/usr/bin:/bin" },
          }),
        );

        assert.strictEqual(result._tag, "Failure");
        if (result._tag === "Failure") {
          assert.strictEqual(result.failure.stage, "marketplace-list");
          assert.strictEqual(
            result.failure.detail,
            "marketplace-list failed (exit 7): synthetic diagnostic",
          );
        }
        assert.deepStrictEqual(
          commands.map((command) => command.stage),
          ["marketplace-add", "marketplace-list", "plugin-remove", "marketplace-remove"],
        );
        const codexHome = commands[0]?.environment.CODEX_HOME;
        if (codexHome === undefined) return yield* Effect.die("fake runner did not capture home");
        assert.isFalse(yield* fs.exists(path.dirname(codexHome)));
      }),
    );

    it.effect("rejects the legacy gina MCP alias during deterministic inspection", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "marketplace-inspection-test-" });
        yield* writeInstalledPluginFixture(root);
        yield* fs.writeFileString(
          path.join(root, ".mcp.json"),
          encodeJson({
            mcpServers: {
              gina: { type: "http", url: PRODUCTION_MCP_URL },
            },
          }),
        );

        const result = yield* Effect.result(inspectInstalledAskGinaPlugin(root));
        assert.strictEqual(result._tag, "Failure");
        if (result._tag === "Failure") {
          assert.strictEqual(result.failure.reason, "invalid-plugin");
          assert.include(result.failure.detail, "ask-gina");
        }
      }),
    );
  });
});
