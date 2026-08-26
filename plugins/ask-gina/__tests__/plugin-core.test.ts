import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import * as BunServices from "@effect/platform-bun/BunServices";
import { assert, describe, it } from "@effect/vitest";
import { ASK_GINA_SKILL_DEFINITIONS, PRODUCTION_MCP_URL, READ_SCOPE } from "@askgina/contracts";
import { Effect, FileSystem, Path, PlatformError, Schema } from "effect";

import { loadCanonicalSkillDocuments, loadPluginManifest } from "../src/index";
import { createGeneratedPluginTargets, TARGET_NAMES } from "../../../tools/sync-plugin-skills";
import {
  checkGeneratedTargetConformance,
  runTargetConformanceChecks,
} from "../../../tools/check-target-conformance";

const pluginRoot = fileURLToPath(new URL("../", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

const ClaudeMarketplaceJson = Schema.fromJsonString(
  Schema.Struct({
    name: Schema.String,
    owner: Schema.Struct({ name: Schema.String, url: Schema.String }),
    plugins: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        source: Schema.String,
        strict: Schema.Boolean,
        skills: Schema.String,
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
        assert.strictEqual(marketplace.plugins.length, 1);
        const plugin = marketplace.plugins[0];
        assert.isDefined(plugin);
        assert.deepStrictEqual(plugin, {
          name: "ask-gina",
          source: { source: "local", path: "./plugins/ask-gina" },
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
        assert.strictEqual(marketplace.plugins.length, 1);
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
                generated.targets[target],
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
    it.effect("rejects loss of canonical OpenAI support and skill metadata", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const paths = yield* Path.Path;
          const generated = yield* makeGeneratedTargets(pluginRoot);
          const openai = generated.targets.openai;
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
