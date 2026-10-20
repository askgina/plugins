import * as BunServices from "@effect/platform-bun/BunServices";
import { ASK_GINA_SKILL_DEFINITIONS, PRODUCTION_MCP_URL } from "@askgina/contracts";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Path, Schema } from "effect";

import {
  buildCodexMarketplaceEnvironment,
  CodexMarketplaceSmokeError,
  inspectInstalledPlugin,
  type MarketplaceCommandInput,
  type MarketplaceCommandRunner,
  parseCodexMarketplaceSmokeArgs,
  parseMarketplaceAddOutput,
  parseMarketplaceListOutput,
  parsePluginAddOutput,
  parseRepositoryMarketplaceManifest,
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

interface PluginFixture {
  readonly name: string;
  readonly mcpUrl: string;
  readonly skills: readonly string[];
}

const SPOT_MCP_URL = "https://askgina.ai/ai/spot/mcp";
const ASK_GINA_FIXTURE: PluginFixture = {
  name: "ask-gina",
  mcpUrl: PRODUCTION_MCP_URL,
  skills: ASK_GINA_SKILL_DEFINITIONS.map((skill) => skill.name),
};
const SPOT_FIXTURE: PluginFixture = {
  name: "ask-gina-spot",
  mcpUrl: SPOT_MCP_URL,
  skills: ["lp-pool-scan", "lp-rebalancing-playbook"],
};
const FIXTURES = [ASK_GINA_FIXTURE, SPOT_FIXTURE] as const;
const PLUGIN_NAMES = FIXTURES.map((fixture) => fixture.name);

const marketplaceManifest = (names: readonly string[] = PLUGIN_NAMES): string =>
  encodeJson({
    name: "ask-gina-plugins",
    plugins: names.map((name) => ({
      name,
      source: { source: "local", path: `./plugins/${name}` },
      policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
    })),
  });

const writeInstalledPluginFixture = (
  installedRoot: string,
  fixture: PluginFixture = ASK_GINA_FIXTURE,
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
          name: fixture.name,
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
            [fixture.name]: { type: "http", url: fixture.mcpUrl },
          },
        }),
      ),
      fs.writeFileString(path.join(installedRoot, "assets", "icon.svg"), "<svg></svg>"),
    ]);
    yield* Effect.forEach(
      fixture.skills,
      (skill) =>
        Effect.gen(function* () {
          const skillRoot = path.join(installedRoot, "skills", skill);
          yield* fs.makeDirectory(path.join(skillRoot, "agents"), { recursive: true });
          yield* Effect.all([
            fs.writeFileString(path.join(skillRoot, "SKILL.md"), `# ${skill}\n`),
            fs.writeFileString(path.join(skillRoot, "agents", "openai.yaml"), "name: Ask Gina\n"),
          ]);
        }),
      { concurrency: "unbounded", discard: true },
    );
  }).pipe(Effect.orDie);

// The marketplace checkout Codex clones: the marketplace file plus each package's own sources.
const writeMarketplaceCheckoutFixture = (
  marketplaceRoot: string,
): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fs.makeDirectory(path.join(marketplaceRoot, ".agents", "plugins"), { recursive: true });
    yield* fs.writeFileString(
      path.join(marketplaceRoot, ".agents", "plugins", "marketplace.json"),
      marketplaceManifest(),
    );
    yield* Effect.forEach(
      FIXTURES,
      (fixture) =>
        Effect.gen(function* () {
          const sourceRoot = path.join(marketplaceRoot, "plugins", fixture.name);
          yield* fs.makeDirectory(sourceRoot, { recursive: true });
          yield* fs.writeFileString(
            path.join(sourceRoot, ".mcp.json"),
            encodeJson({ mcpServers: { [fixture.name]: { type: "http", url: fixture.mcpUrl } } }),
          );
          yield* Effect.forEach(
            fixture.skills,
            (skill) =>
              fs
                .makeDirectory(path.join(sourceRoot, "skills", skill), { recursive: true })
                .pipe(
                  Effect.andThen(
                    fs.writeFileString(path.join(sourceRoot, "skills", skill, "SKILL.md"), "# s\n"),
                  ),
                ),
            { discard: true },
          );
        }),
      { discard: true },
    );
  }).pipe(Effect.orDie);

const marketplaceListing = (
  marketplaceRoot: string,
  authenticationPolicy = "ON_INSTALL",
  names: readonly string[] = PLUGIN_NAMES,
): string =>
  encodeJson({
    installed: [],
    available: names.map((name) => ({
      pluginId: `${name}@ask-gina-plugins`,
      name,
      marketplaceName: "ask-gina-plugins",
      version: "0.1.0",
      installed: false,
      enabled: false,
      source: { source: "local", path: `${marketplaceRoot}/plugins/${name}` },
      marketplaceSource: { sourceType: "git", source: "askgina/plugins" },
      installPolicy: "AVAILABLE",
      authPolicy: authenticationPolicy,
    })),
  });

const makeFakeRunner = (
  commands: MarketplaceCommandInput[],
  failStage?: MarketplaceCommandInput["stage"],
  // A plugin whose install is missing its last skill, to prove failures name the plugin.
  incompletePlugin?: string,
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
      const isolatedHome = input.environment.HOME;
      const repositoryTokenExists =
        isolatedHome !== undefined &&
        (yield* fs.exists(path.join(isolatedHome, ".repository-token")).pipe(Effect.orDie));
      const gitAskpassExists =
        isolatedHome !== undefined &&
        (yield* fs.exists(path.join(isolatedHome, "git-askpass")).pipe(Effect.orDie));
      if (input.stage !== "marketplace-add" && (repositoryTokenExists || gitAskpassExists)) {
        return yield* new CodexMarketplaceSmokeError({
          stage: input.stage,
          reason: "command-failed",
          detail: "repository credential remained after marketplace clone",
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
        yield* writeMarketplaceCheckoutFixture(marketplaceRoot);
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
        const pluginId = input.args[2] ?? "";
        const fixture = FIXTURES.find(
          (candidate) => `${candidate.name}@ask-gina-plugins` === pluginId,
        );
        if (fixture === undefined) {
          return yield* new CodexMarketplaceSmokeError({
            stage: input.stage,
            reason: "command-failed",
            detail: `fake runner has no plugin ${pluginId}`,
          });
        }
        const installedRoot = path.join(
          codexHome,
          "plugins",
          "cache",
          "ask-gina-plugins",
          fixture.name,
          "0.1.0",
        );
        yield* writeInstalledPluginFixture(
          installedRoot,
          fixture.name === incompletePlugin
            ? { ...fixture, skills: fixture.skills.slice(0, -1) }
            : fixture,
        );
        return {
          stdout: encodeJson({
            pluginId,
            name: fixture.name,
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
      const expected = { marketplaceRoot: "/tmp/marketplace", pluginNames: PLUGIN_NAMES };
      yield* parseMarketplaceListOutput(marketplaceListing("/tmp/marketplace"), expected);
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
          "ask-gina",
        ),
        { installedPath: "/tmp/plugin" },
      );

      const oauth = yield* Effect.result(
        parseMarketplaceListOutput(marketplaceListing("/tmp/marketplace", "OAUTH"), expected),
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

  it.effect("reads every plugin name from the repository marketplace file", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* parseRepositoryMarketplaceManifest(marketplaceManifest()),
        PLUGIN_NAMES,
      );
      assert.deepStrictEqual(
        yield* parseRepositoryMarketplaceManifest(marketplaceManifest(["ask-gina"])),
        ["ask-gina"],
      );

      const wrongSource = yield* Effect.result(
        parseRepositoryMarketplaceManifest(
          encodeJson({
            name: "ask-gina-plugins",
            plugins: [
              {
                name: "ask-gina-spot",
                source: { source: "local", path: "./plugins/ask-gina" },
              },
            ],
          }),
        ),
      );
      assert.strictEqual(wrongSource._tag, "Failure");
      if (wrongSource._tag === "Failure") {
        assert.include(wrongSource.failure.detail, "ask-gina-spot");
        assert.include(wrongSource.failure.detail, "./plugins/ask-gina-spot");
      }
      const duplicate = yield* Effect.result(
        parseRepositoryMarketplaceManifest(marketplaceManifest(["ask-gina", "ask-gina"])),
      );
      assert.strictEqual(duplicate._tag, "Failure");
      const empty = yield* Effect.result(
        parseRepositoryMarketplaceManifest(marketplaceManifest([])),
      );
      assert.strictEqual(empty._tag, "Failure");
      const otherMarketplace = yield* Effect.result(
        parseRepositoryMarketplaceManifest(encodeJson({ name: "other", plugins: [] })),
      );
      assert.strictEqual(otherMarketplace._tag, "Failure");
    }),
  );

  it.effect("requires the available listing to contain exactly the marketplace plugins", () =>
    Effect.gen(function* () {
      const expected = { marketplaceRoot: "/tmp/marketplace", pluginNames: PLUGIN_NAMES };
      const missingSpot = yield* Effect.result(
        parseMarketplaceListOutput(
          marketplaceListing("/tmp/marketplace", "ON_INSTALL", ["ask-gina"]),
          expected,
        ),
      );
      assert.strictEqual(missingSpot._tag, "Failure");
      if (missingSpot._tag === "Failure") {
        assert.include(missingSpot.failure.detail, "ask-gina-spot");
      }
      const unlisted = yield* Effect.result(
        parseMarketplaceListOutput(marketplaceListing("/tmp/marketplace"), {
          marketplaceRoot: "/tmp/marketplace",
          pluginNames: ["ask-gina"],
        }),
      );
      assert.strictEqual(unlisted._tag, "Failure");
      const swapped = yield* Effect.result(
        parseMarketplaceListOutput(
          marketplaceListing("/tmp/marketplace", "ON_INSTALL", ["ask-gina", "ask-gina-other"]),
          expected,
        ),
      );
      assert.strictEqual(swapped._tag, "Failure");
      if (swapped._tag === "Failure") {
        assert.include(swapped.failure.detail, "ask-gina-spot@ask-gina-plugins");
      }
      const wrongSource = yield* Effect.result(
        parseMarketplaceListOutput(marketplaceListing("/tmp/elsewhere"), expected),
      );
      assert.strictEqual(wrongSource._tag, "Failure");
      if (wrongSource._tag === "Failure") {
        assert.include(wrongSource.failure.detail, "must resolve to plugins/ask-gina");
      }
      const wrongInstall = yield* Effect.result(
        parsePluginAddOutput(
          encodeJson({
            pluginId: "ask-gina@ask-gina-plugins",
            name: "ask-gina",
            marketplaceName: "ask-gina-plugins",
            version: "0.1.0",
            installedPath: "/tmp/plugin",
            authPolicy: "ON_INSTALL",
          }),
          "ask-gina-spot",
        ),
      );
      assert.strictEqual(wrongInstall._tag, "Failure");
      if (wrongInstall._tag === "Failure") {
        assert.include(wrongInstall.failure.detail, "ask-gina-spot@ask-gina-plugins");
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
        CODEX_MARKETPLACE_REPOSITORY_TOKEN: "repository-secret",
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
      assert.notProperty(environment, "CODEX_MARKETPLACE_REPOSITORY_TOKEN");
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
            CODEX_MARKETPLACE_REPOSITORY_TOKEN: "repository-secret",
          },
        });

        assert.deepStrictEqual(result, {
          repository: "askgina/plugins",
          ref: IMMUTABLE_REF,
          marketplaceName: "ask-gina-plugins",
          pluginIds: ["ask-gina@ask-gina-plugins", "ask-gina-spot@ask-gina-plugins"],
        });
        assert.deepStrictEqual(
          commands.map((command) => command.stage),
          [
            "marketplace-add",
            "marketplace-list",
            "plugin-add",
            "plugin-add",
            "plugin-remove",
            "plugin-remove",
            "marketplace-remove",
          ],
        );
        assert.deepStrictEqual(
          commands
            .filter((command) => command.stage === "plugin-add")
            .map((command) => command.args),
          [
            ["plugin", "add", "ask-gina@ask-gina-plugins", "--json"],
            ["plugin", "add", "ask-gina-spot@ask-gina-plugins", "--json"],
          ],
        );
        assert.deepStrictEqual(
          commands
            .filter((command) => command.stage === "plugin-remove")
            .map((command) => command.args[2]),
          ["ask-gina@ask-gina-plugins", "ask-gina-spot@ask-gina-plugins"],
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
        assert.notProperty(commands[0]?.environment ?? {}, "CODEX_MARKETPLACE_REPOSITORY_TOKEN");
        assert.match(commands[0]?.environment.GIT_ASKPASS ?? "", /git-askpass$/u);
        assert.notInclude(commands[0]?.environment.GIT_ASKPASS ?? "", "repository-secret");
        assert.isFalse(commands.slice(1).some((command) => "GIT_ASKPASS" in command.environment));
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
          [
            "marketplace-add",
            "marketplace-list",
            "plugin-remove",
            "plugin-remove",
            "marketplace-remove",
          ],
        );
        const codexHome = commands[0]?.environment.CODEX_HOME;
        if (codexHome === undefined) return yield* Effect.die("fake runner did not capture home");
        assert.isFalse(yield* fs.exists(path.dirname(codexHome)));
      }),
    );
    it.effect("names the plugin whose install fails inspection and still cleans every plugin", () =>
      Effect.gen(function* () {
        const commands: MarketplaceCommandInput[] = [];
        const result = yield* Effect.result(
          runCodexMarketplaceSmoke({
            ...OPTIONS,
            runner: makeFakeRunner(commands, undefined, "ask-gina-spot"),
            parentEnvironment: { PATH: "/usr/bin:/bin" },
          }),
        );

        assert.strictEqual(result._tag, "Failure");
        if (result._tag === "Failure") {
          assert.strictEqual(result.failure.stage, "inspection");
          assert.strictEqual(result.failure.reason, "invalid-plugin");
          assert.include(result.failure.detail, "ask-gina-spot:");
          assert.include(result.failure.detail, "marketplace checkout");
        }
        assert.deepStrictEqual(
          commands.map((command) => command.stage),
          [
            "marketplace-add",
            "marketplace-list",
            "plugin-add",
            "plugin-add",
            "plugin-remove",
            "plugin-remove",
            "marketplace-remove",
          ],
        );
      }),
    );

    it.effect("names the plugin whose install command fails", () =>
      Effect.gen(function* () {
        const commands: MarketplaceCommandInput[] = [];
        const result = yield* Effect.result(
          runCodexMarketplaceSmoke({
            ...OPTIONS,
            runner: makeFakeRunner(commands, "plugin-add"),
            parentEnvironment: { PATH: "/usr/bin:/bin" },
          }),
        );

        assert.strictEqual(result._tag, "Failure");
        if (result._tag === "Failure") {
          assert.strictEqual(result.failure.stage, "plugin-add");
          assert.strictEqual(
            result.failure.detail,
            "ask-gina: plugin-add failed (exit 7): synthetic diagnostic",
          );
        }
      }),
    );

    it.effect("does not run Codex cleanup when repository credential removal fails", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const commands: MarketplaceCommandInput[] = [];
        let removalAttempts = 0;
        const result = yield* Effect.result(
          runCodexMarketplaceSmoke({
            ...OPTIONS,
            runner: makeFakeRunner(commands),
            parentEnvironment: {
              PATH: "/usr/bin:/bin",
              CODEX_MARKETPLACE_REPOSITORY_TOKEN: "repository-secret",
            },
            removeRepositoryCredentialFile: () => {
              removalAttempts += 1;
              return Effect.fail(
                new CodexMarketplaceSmokeError({
                  stage: "environment",
                  reason: "io-failed",
                  detail: "synthetic credential removal failure",
                }),
              );
            },
          }),
        );

        assert.strictEqual(result._tag, "Failure");
        if (result._tag === "Failure") {
          assert.strictEqual(result.failure.stage, "environment");
          assert.strictEqual(result.failure.reason, "io-failed");
          assert.strictEqual(
            result.failure.detail,
            "cannot remove isolated repository credentials",
          );
        }
        assert.strictEqual(removalAttempts, 2);
        assert.deepStrictEqual(
          commands.map((command) => command.stage),
          ["marketplace-add"],
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
        yield* writeInstalledPluginFixture(root, ASK_GINA_FIXTURE);
        yield* fs.writeFileString(
          path.join(root, ".mcp.json"),
          encodeJson({
            mcpServers: {
              gina: { type: "http", url: PRODUCTION_MCP_URL },
            },
          }),
        );

        const result = yield* Effect.result(
          inspectInstalledPlugin({ pluginName: "ask-gina", installedRoot: root, sourceRoot: root }),
        );
        assert.strictEqual(result._tag, "Failure");
        if (result._tag === "Failure") {
          assert.strictEqual(result.failure.reason, "invalid-plugin");
          assert.include(result.failure.detail, "ask-gina");
        }
      }),
    );

    it.effect("checks a non-canonical plugin against its own checkout", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "marketplace-inspection-test-" });
        const marketplaceRoot = path.join(root, "checkout");
        const installedRoot = path.join(root, "installed");
        yield* writeMarketplaceCheckoutFixture(marketplaceRoot);
        yield* writeInstalledPluginFixture(installedRoot, SPOT_FIXTURE);
        const sourceRoot = path.join(marketplaceRoot, "plugins", "ask-gina-spot");
        const inspect = inspectInstalledPlugin({
          pluginName: "ask-gina-spot",
          installedRoot,
          sourceRoot,
        });
        yield* inspect;

        // A manifest named for another plugin is rejected, so one package cannot stand in for another.
        const asCanonical = yield* Effect.result(
          inspectInstalledPlugin({ pluginName: "ask-gina", installedRoot, sourceRoot }),
        );
        assert.strictEqual(asCanonical._tag, "Failure");

        yield* fs.writeFileString(
          path.join(installedRoot, ".mcp.json"),
          encodeJson({
            mcpServers: { "ask-gina-spot": { type: "http", url: PRODUCTION_MCP_URL } },
          }),
        );
        const wrongUrl = yield* Effect.result(inspect);
        assert.strictEqual(wrongUrl._tag, "Failure");
        if (wrongUrl._tag === "Failure") {
          assert.include(wrongUrl.failure.detail, SPOT_MCP_URL);
        }

        yield* writeInstalledPluginFixture(installedRoot, SPOT_FIXTURE);
        yield* fs.remove(path.join(installedRoot, "skills", "lp-pool-scan"), { recursive: true });
        const missingSkill = yield* Effect.result(inspect);
        assert.strictEqual(missingSkill._tag, "Failure");
        if (missingSkill._tag === "Failure") {
          assert.include(missingSkill.failure.detail, "ask-gina-spot");
          assert.include(missingSkill.failure.detail, "marketplace checkout");
        }
      }),
    );
  });
});
