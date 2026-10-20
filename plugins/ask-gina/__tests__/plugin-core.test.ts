import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import * as BunServices from "@effect/platform-bun/BunServices";
import { assert, describe, it } from "@effect/vitest";
import { ASK_GINA_SKILL_DEFINITIONS, PRODUCTION_MCP_URL, READ_SCOPE } from "@askgina/contracts";
import { Effect, FileSystem, Path, PlatformError, Schema } from "effect";

import { loadCanonicalSkillDocuments, loadPluginManifest } from "../src/index";
import {
  createGeneratedPluginTargets,
  TARGET_NAMES,
  type GeneratedPluginTargets,
  type TargetName,
} from "../../../tools/sync-plugin-skills";
import {
  checkGeneratedTargetConformance,
  runTargetConformanceChecks,
} from "../../../tools/check-target-conformance";

const pluginRoot = fileURLToPath(new URL("../", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const spotPluginRoot = fileURLToPath(new URL("../../ask-gina-spot/", import.meta.url));

const ClaudeMarketplaceJson = Schema.fromJsonString(
  Schema.Struct({
    name: Schema.String,
    owner: Schema.Struct({ name: Schema.String, url: Schema.String }),
    plugins: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        source: Schema.String,
        strict: Schema.Boolean,
        skills: Schema.optional(Schema.String),
        mcpServers: Schema.String,
        displayName: Schema.String,
        author: Schema.Struct({ name: Schema.String, url: Schema.String }),
        repository: Schema.String,
      }),
    ),
  }),
);

const OpenAiMarketplaceJson = Schema.fromJsonString(
  Schema.Struct({
    name: Schema.String,
    interface: Schema.Struct({ displayName: Schema.String }),
    plugins: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        source: Schema.Struct({ source: Schema.String, path: Schema.String }),
        policy: Schema.Struct({ installation: Schema.String, authentication: Schema.String }),
        category: Schema.String,
      }),
    ),
  }),
);
const DevinPluginJson = Schema.fromJsonString(
  Schema.Struct({
    name: Schema.String,
    version: Schema.String,
    skills: Schema.String,
    mcpServers: Schema.String,
  }),
);
const collectSkillDocuments = (
  directory: string,
): Effect.Effect<
  readonly string[],
  PlatformError.PlatformError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;
    const entries = yield* fs.readDirectory(directory);
    const nested = yield* Effect.forEach(
      entries,
      (entry) => {
        const entryPath = paths.join(directory, entry);
        return fs.stat(entryPath).pipe(
          Effect.flatMap((info) => {
            if (info.type === "Directory") return collectSkillDocuments(entryPath);
            return Effect.succeed(entry === "SKILL.md" ? [entryPath] : []);
          }),
        );
      },
      { concurrency: "unbounded" },
    );
    return nested.flat();
  });

const targetPath = (generated: GeneratedPluginTargets, host: TargetName): string => {
  const path = generated.targets[host];
  return path === undefined ? assert.fail(`${host} was not generated`) : path;
};

const makeGeneratedTargets = (packageRoot: string) =>
  Effect.acquireRelease(createGeneratedPluginTargets({ packageRoot }), (generated) =>
    generated.cleanup.pipe(Effect.orDie),
  );

describe("Ask Gina portable plugin core", () => {
  it.layer(BunServices.layer)((it) => {
    it.effect("loads the portable plugin manifest", () =>
      Effect.gen(function* () {
        const manifest = yield* loadPluginManifest;

        assert.strictEqual(manifest.name, "ask-gina");
        assert.strictEqual(manifest.mcp.url, PRODUCTION_MCP_URL);
        assert.deepStrictEqual(manifest.mcp.scopes, [READ_SCOPE]);
        assert.deepStrictEqual(
          manifest.skills,
          ASK_GINA_SKILL_DEFINITIONS.map((skill) => ({ id: skill.name, mcpServed: true })),
        );
      }),
    );

    it.effect("loads exactly the four contract-defined canonical skills", () =>
      Effect.gen(function* () {
        const skills = yield* loadCanonicalSkillDocuments;

        assert.deepStrictEqual(
          skills.map((skill) => skill.definition.name),
          ASK_GINA_SKILL_DEFINITIONS.map((skill) => skill.name),
        );
      }),
    );

    it.effect("keeps every SKILL.md under the canonical skills directory", () =>
      Effect.gen(function* () {
        const paths = yield* Path.Path;
        const skillDocuments = [...(yield* collectSkillDocuments(pluginRoot))].sort();
        const canonicalSkillsRoot = paths.join(pluginRoot, "skills") + paths.sep;

        assert.strictEqual(skillDocuments.length, 4);
        assert.isTrue(skillDocuments.every((document) => document.startsWith(canonicalSkillsRoot)));
      }),
    );

    it.effect("publishes OpenAI marketplace metadata for the loadable root plugin", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const paths = yield* Path.Path;
        const marketplace = yield* Schema.decodeEffect(OpenAiMarketplaceJson)(
          yield* fs.readFileString(
            paths.join(repositoryRoot, ".agents", "plugins", "marketplace.json"),
          ),
        );

        assert.strictEqual(marketplace.name, "ask-gina-plugins");
        assert.deepStrictEqual(marketplace.interface, { displayName: "Ask Gina Plugins" });
        assert.deepStrictEqual(
          marketplace.plugins.map(({ name }) => name),
          ["ask-gina", "ask-gina-perps", "ask-gina-predictions", "ask-gina-spot"],
        );
        const plugin = marketplace.plugins[0];
        assert.isDefined(plugin);
        assert.deepStrictEqual(plugin, {
          name: "ask-gina",
          source: { source: "local", path: "./plugins/ask-gina" },
          policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
          category: "Finance",
        });
        assert.deepStrictEqual(marketplace.plugins[1], {
          name: "ask-gina-perps",
          source: { source: "local", path: "./plugins/ask-gina-perps" },
          policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
          category: "Finance",
        });
        assert.deepStrictEqual(marketplace.plugins[3], {
          name: "ask-gina-spot",
          source: { source: "local", path: "./plugins/ask-gina-spot" },
          policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
          category: "Finance",
        });
        const sourceRoot = paths.resolve(repositoryRoot, plugin?.source.path ?? "");
        assert.strictEqual(sourceRoot, paths.resolve(pluginRoot));
        assert.isTrue(yield* fs.exists(paths.join(sourceRoot, ".codex-plugin", "plugin.json")));
        assert.isTrue(yield* fs.exists(paths.join(sourceRoot, ".mcp.json")));
        assert.isTrue(yield* fs.exists(paths.join(sourceRoot, "assets", "icon.svg")));
        assert.isTrue(yield* fs.exists(paths.join(sourceRoot, "skills")));
      }),
    );

    it.effect("publishes Claude marketplace metadata for the canonical plugin directory", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const paths = yield* Path.Path;
        const marketplace = yield* Schema.decodeEffect(ClaudeMarketplaceJson)(
          yield* fs.readFileString(
            paths.join(repositoryRoot, ".claude-plugin", "marketplace.json"),
          ),
        );

        assert.strictEqual(marketplace.name, "ask-gina-plugins");
        assert.deepStrictEqual(marketplace.owner, {
          name: "Ask Gina",
          url: "https://askgina.ai",
        });
        assert.strictEqual(marketplace.plugins.length, 4);
        // Packages without skills carry no skills path.
        for (const index of [1, 2]) {
          const venue = marketplace.plugins[index];
          assert.isDefined(venue);
          assert.isUndefined(venue?.skills);
          assert.strictEqual(venue?.mcpServers, "./targets/claude/.mcp.json");
        }
        assert.deepNestedInclude(marketplace.plugins[3] as object, {
          name: "ask-gina-spot",
          source: "./plugins/ask-gina-spot",
          strict: false,
          skills: "./skills",
          mcpServers: "./targets/claude/.mcp.json",
          displayName: "Ask Gina Spot",
        });
        assert.deepNestedInclude(marketplace.plugins[0] as object, {
          name: "ask-gina",
          source: "./plugins/ask-gina",
          strict: false,
          skills: "./skills",
          mcpServers: "./targets/claude/.mcp.json",
          displayName: "Ask Gina",
          "author.name": "Ask Gina",
          "author.url": "https://askgina.ai",
          repository: "https://github.com/askgina/plugins",
        });
        assert.strictEqual(
          paths.resolve(repositoryRoot, marketplace.plugins[0]?.source ?? ""),
          paths.resolve(pluginRoot),
        );
        const plugin = marketplace.plugins[0];
        assert.isDefined(plugin);
        assert.isTrue(yield* fs.exists(paths.resolve(pluginRoot, plugin?.skills ?? "")));
        assert.isTrue(yield* fs.exists(paths.resolve(pluginRoot, plugin?.mcpServers ?? "")));
      }),
    );

    it.effect("publishes a directly loadable Devin plugin", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const paths = yield* Path.Path;
        const plugin = yield* Schema.decodeEffect(DevinPluginJson)(
          yield* fs.readFileString(paths.join(pluginRoot, ".devin-plugin", "plugin.json")),
        );

        assert.deepStrictEqual(plugin, {
          name: "ask-gina",
          version: "0.1.0",
          skills: "skills",
          mcpServers: ".mcp.json",
        });
        assert.isTrue(yield* fs.exists(paths.join(pluginRoot, "skills")));
        assert.isTrue(yield* fs.exists(paths.join(pluginRoot, ".mcp.json")));
      }),
    );

    it.effect("generates temporary host trees with only the OpenAI metadata overlay", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const paths = yield* Path.Path;
          const canonicalSkills = yield* loadCanonicalSkillDocuments;
          const before = yield* Effect.forEach(
            canonicalSkills,
            (skill) => fs.readFileString(skill.path),
            { concurrency: "unbounded" },
          );
          const generated = yield* makeGeneratedTargets(pluginRoot);
          const tempRelative = paths.relative(tmpdir(), generated.path);
          assert.isFalse(
            tempRelative.startsWith(`..${paths.sep}`) || paths.isAbsolute(tempRelative),
          );

          for (const target of TARGET_NAMES) {
            assert.isFalse(yield* fs.exists(paths.join(pluginRoot, "targets", target, "skills")));

            for (const skill of ASK_GINA_SKILL_DEFINITIONS) {
              const generatedSkillRoot = paths.join(
                targetPath(generated, target),
                "skills",
                skill.name,
              );
              assert.isTrue(yield* fs.exists(paths.join(generatedSkillRoot, "SKILL.md")));
              const metadataExists = yield* fs.exists(
                paths.join(generatedSkillRoot, "agents", "openai.yaml"),
              );
              assert.strictEqual(metadataExists, target === "openai");
            }
          }

          const after = yield* Effect.forEach(
            canonicalSkills,
            (skill) => fs.readFileString(skill.path),
            { concurrency: "unbounded" },
          );
          assert.deepStrictEqual(after, before);
        }),
      ),
    );

    it.effect("passes contracts-based conformance for every generated host target", () =>
      Effect.gen(function* () {
        const report = yield* runTargetConformanceChecks({ packageRoot: pluginRoot });

        assert.isTrue(report.allPassed);
        assert.strictEqual(report.totalFailed, 0);
        assert.strictEqual(Object.keys(report.targets).length, TARGET_NAMES.length);
      }),
    );
    it.effect("passes conformance for every Ask Gina Spot host target", () =>
      Effect.gen(function* () {
        const report = yield* runTargetConformanceChecks({ packageRoot: spotPluginRoot });

        assert.isTrue(report.allPassed);
        assert.deepStrictEqual(Object.keys(report.targets), [
          "ask-gina-spot:openai",
          "ask-gina-spot:cursor",
          "ask-gina-spot:claude",
          "ask-gina-spot:copilot",
          "ask-gina-spot:devin",
        ]);
      }),
    );

    it.effect("passes conformance for every skill-less write host target", () =>
      Effect.forEach(["ask-gina-perps", "ask-gina-predictions"], (name) =>
        Effect.gen(function* () {
          const report = yield* runTargetConformanceChecks({
            packageRoot: fileURLToPath(new URL(`../../${name}/`, import.meta.url)),
          });

          assert.isTrue(report.allPassed);
          assert.deepStrictEqual(Object.keys(report.targets), [
            `${name}:openai`,
            `${name}:cursor`,
            `${name}:claude`,
            `${name}:copilot`,
            `${name}:devin`,
          ]);
        }),
      ),
    );

    it.effect("rejects loss of canonical OpenAI support and skill metadata", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const paths = yield* Path.Path;
          const generated = yield* makeGeneratedTargets(pluginRoot);
          const openai = targetPath(generated, "openai");
          const manifestPath = paths.join(openai, ".codex-plugin", "plugin.json");
          const manifest = yield* fs.readFileString(manifestPath);
          yield* fs.writeFileString(
            manifestPath,
            manifest.replace("https://askgina.ai/support", "https://invalid.example/support"),
          );
          yield* fs.remove(
            paths.join(openai, "skills", "research-hyperliquid", "agents", "openai.yaml"),
          );

          const report = yield* checkGeneratedTargetConformance("openai", openai, {
            packageRoot: pluginRoot,
          });
          const failed = report.checks.filter((check) => !check.passed).map((check) => check.id);
          assert.include(failed, "openai.manifest.contract");
          assert.include(failed, "openai.skill.research-hyperliquid.openai_metadata");
        }),
      ),
    );
  });
});
