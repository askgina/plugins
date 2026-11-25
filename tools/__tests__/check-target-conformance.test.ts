import { fileURLToPath } from "node:url";

import * as BunServices from "@effect/platform-bun/BunServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Path, Schema } from "effect";

import {
  checkGeneratedTargetConformance,
  checkRepositoryConformance,
  runTargetConformanceChecks,
  type TargetConformanceCheck,
} from "../check-target-conformance";
import {
  createGeneratedPluginTarget,
  createGeneratedPluginTargets,
  type GeneratedPluginTargets,
  type TargetName,
} from "../sync-plugin-skills";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const ginaRoot = fileURLToPath(new URL("../../plugins/ask-gina/", import.meta.url));
const spotRoot = fileURLToPath(new URL("../../plugins/ask-gina-spot/", import.meta.url));
const perpsRoot = fileURLToPath(new URL("../../plugins/ask-gina-perps/", import.meta.url));
const predictionsRoot = fileURLToPath(
  new URL("../../plugins/ask-gina-predictions/", import.meta.url),
);
const UnknownJsonString = Schema.fromJsonString(Schema.Unknown);
const decodeUnknownJson = Schema.decodeUnknownSync(UnknownJsonString);
const encodeUnknownJson = Schema.encodeUnknownSync(
  Schema.fromJsonString(Schema.Unknown, { space: 2 }),
);

const failedIds = (checks: readonly TargetConformanceCheck[]): readonly string[] =>
  checks.filter((check) => !check.passed).map((check) => check.id);

const targetPath = (generated: GeneratedPluginTargets, host: TargetName): string => {
  const path = generated.targets[host];
  return path === undefined ? assert.fail(`${host} was not generated`) : path;
};

const makeSpotTargets = Effect.acquireRelease(
  createGeneratedPluginTargets({ packageRoot: spotRoot }),
  (generated) => generated.cleanup.pipe(Effect.orDie),
);

const makeTarget = (host: TargetName, packageRoot: string) =>
  Effect.acquireRelease(createGeneratedPluginTarget(host, { packageRoot }), (generated) =>
    generated.cleanup.pipe(Effect.orDie),
  );

/** A repository holding every marketplace descriptor and all four complete plugin packages. */
const marketplaceFixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "target-conformance-test-" });
  yield* fs.makeDirectory(path.join(root, "plugins"), { recursive: true });
  yield* Effect.all(
    [
      fs.copy(path.join(repositoryRoot, ".agents"), path.join(root, ".agents")),
      fs.copy(path.join(repositoryRoot, ".claude-plugin"), path.join(root, ".claude-plugin")),
      fs.copy(path.join(repositoryRoot, ".cursor-plugin"), path.join(root, ".cursor-plugin")),
      fs.copyFile(
        path.join(repositoryRoot, "marketplace.yaml"),
        path.join(root, "marketplace.yaml"),
      ),
      fs.copy(ginaRoot, path.join(root, "plugins", "ask-gina")),
      fs.copy(spotRoot, path.join(root, "plugins", "ask-gina-spot")),
      fs.copy(perpsRoot, path.join(root, "plugins", "ask-gina-perps")),
      fs.copy(predictionsRoot, path.join(root, "plugins", "ask-gina-predictions")),
    ],
    { concurrency: "unbounded" },
  );
  return { root, packageRoot: path.join(root, "plugins", "ask-gina-spot") };
});

describe("target conformance across packages", () => {
  it.layer(BunServices.layer)((it) => {
    it.effect("passes for the repository and reports every package", () =>
      Effect.gen(function* () {
        const report = yield* runTargetConformanceChecks();
        const ids = [
          ...Object.values(report.targets).flatMap((summary) => summary.checks),
          ...(report.repository?.checks ?? []),
        ].map((check) => check.id);

        assert.deepStrictEqual(failedIds(report.repository?.checks ?? []), []);
        assert.strictEqual(report.totalFailed, 0);
        assert.isTrue(report.allPassed);
        assert.deepStrictEqual(Object.keys(report.targets), [
          "openai",
          "cursor",
          "claude",
          "copilot",
          "gemini",
          "devin",
          "antigravity",
          "ask-gina-perps:openai",
          "ask-gina-perps:cursor",
          "ask-gina-perps:claude",
          "ask-gina-perps:copilot",
          "ask-gina-perps:devin",
          "ask-gina-perps:antigravity",
          "ask-gina-predictions:openai",
          "ask-gina-predictions:cursor",
          "ask-gina-predictions:claude",
          "ask-gina-predictions:copilot",
          "ask-gina-predictions:devin",
          "ask-gina-predictions:antigravity",
          "ask-gina-spot:openai",
          "ask-gina-spot:cursor",
          "ask-gina-spot:claude",
          "ask-gina-spot:copilot",
          "ask-gina-spot:devin",
          "ask-gina-spot:antigravity",
        ]);
        assert.include(ids, "openai.manifest.contract");
        assert.include(ids, "cursor.rules.read_only_exists");
        assert.include(ids, "antigravity.rules.read_only_exists");
        assert.include(ids, "antigravity.rules.read_only.canonical_parity");
        assert.include(ids, "antigravity.rules.read_only_cursor_parity");
        assert.include(ids, "antigravity.readme.canonical_parity");
        for (const prefix of ["", "ask-gina-spot:", "ask-gina-perps:", "ask-gina-predictions:"]) {
          assert.include(ids, `${prefix}antigravity.manifest.contract`);
          assert.include(ids, `${prefix}antigravity.mcp.contract`);
          assert.include(ids, `${prefix}antigravity.assets.icon_exists`);
          assert.include(ids, `${prefix}repository.root_antigravity.manifest_contract`);
          assert.include(ids, `${prefix}repository.root_antigravity.mcp_contract`);
          if (prefix !== "") {
            assert.notInclude(ids, `${prefix}antigravity.rules.read_only_exists`);
          }
        }
        assert.include(ids, "ask-gina-spot:openai.manifest.contract");
        assert.include(ids, "ask-gina-spot:repository.root_openai.manifest_contract");
        assert.include(ids, "ask-gina-spot:repository.plugin.mcp_contract");
        assert.include(ids, "ask-gina-perps:repository.plugin.mcp_contract");
        assert.include(ids, "ask-gina-predictions:repository.plugin.mcp_contract");
        // A package without skills still proves its empty skill set.
        assert.include(ids, "ask-gina-perps:repository.root_openai.skills_contract");
        assert.notInclude(ids, "ask-gina-perps:repository.root_openai.skills_exists");
        // Ids stay unique and the read-only invariants are not demanded of Spot.
        assert.strictEqual(new Set(ids).size, ids.length);
        assert.notInclude(ids, "ask-gina-spot:cursor.rules.read_only_exists");
        assert.notInclude(ids, "ask-gina-spot:cursor.commands.directory_set");
        assert.isFalse(ids.some((id) => id.startsWith("ask-gina-spot:gemini.")));
      }),
    );

    it.effect("rejects Antigravity MCP endpoint drift for every package", () =>
      Effect.forEach(
        [
          [ginaRoot, ""],
          [spotRoot, "ask-gina-spot:"],
          [perpsRoot, "ask-gina-perps:"],
          [predictionsRoot, "ask-gina-predictions:"],
        ] as const,
        ([packageRoot, prefix]) =>
          Effect.scoped(
            Effect.gen(function* () {
              const fs = yield* FileSystem.FileSystem;
              const path = yield* Path.Path;
              const generated = yield* makeTarget("antigravity", packageRoot);
              const mcpPath = path.join(generated.path, "mcp_config.json");
              const mcp = yield* fs.readFileString(mcpPath);
              assert.include(mcp, "https://askgina.ai/ai/");
              yield* fs.writeFileString(
                mcpPath,
                mcp.replace("https://askgina.ai/ai/", "https://alpha.askgina.ai/ai/"),
              );
              const report = yield* checkGeneratedTargetConformance("antigravity", generated.path, {
                packageRoot,
              });
              assert.include(failedIds(report.checks), `${prefix}antigravity.mcp.contract`);
              assert.isFalse(report.passed);
            }),
          ),
      ),
    );

    it.effect("rejects Antigravity MCP configurations that are not production URL-only", () =>
      Effect.forEach(
        [
          { mcpServers: { gina: { url: "https://askgina.ai/ai/spot/mcp" } } },
          { mcpServers: { gina: { url: "https://askgina.ai/ai/gina/mcp", type: "http" } } },
          { mcpServers: { gina: { httpUrl: "https://askgina.ai/ai/gina/mcp" } } },
          { mcpServers: { gina: { url: "https://askgina.ai/ai/gina/mcp", headers: {} } } },
          { mcpServers: { "ask-gina": { url: "https://askgina.ai/ai/gina/mcp" } } },
          {
            mcpServers: {
              gina: { url: "https://askgina.ai/ai/gina/mcp" },
              spot: { url: "https://askgina.ai/ai/spot/mcp" },
            },
          },
          { mcpServers: { gina: { url: "https://askgina.ai/ai/gina/mcp" } }, inputs: [] },
        ],
        (mutation) =>
          Effect.scoped(
            Effect.gen(function* () {
              const fs = yield* FileSystem.FileSystem;
              const path = yield* Path.Path;
              const generated = yield* makeTarget("antigravity", ginaRoot);
              yield* fs.writeFileString(
                path.join(generated.path, "mcp_config.json"),
                encodeUnknownJson(mutation),
              );
              const report = yield* checkGeneratedTargetConformance("antigravity", generated.path, {
                packageRoot: ginaRoot,
              });
              assert.include(failedIds(report.checks), "antigravity.mcp.contract");
              assert.isFalse(report.passed);
            }),
          ),
      ),
    );

    it.effect("rejects Antigravity manifest field drift and foreign fields", () =>
      Effect.forEach(
        [
          ["$schema", "https://example.com/plugin.json"],
          ["name", "ask-gina-spot"],
          ["version", "0.1.0"],
          ["displayName", "Different listing"],
          ["description", "A different description that is not bound to plugin.yaml."],
          ["logo", "assets/missing.svg"],
          ["author", { name: "Someone else", url: "https://askgina.ai" }],
          ["author", { name: "Ask Gina", url: "https://example.com" }],
          ["author", { name: "Ask Gina", url: "https://askgina.ai", email: "extra@example.com" }],
          ["homepage", "https://example.com"],
          ["repository", "https://github.com/other/plugins"],
          ["license", "MIT"],
          ["keywords", ["wrong"]],
          ["suggestedPrompts", ["Unbound prompt"]],
          ["suggestedPrompts", ["One", "Two", "Three", "Four"]],
          ["skills", "./skills"],
          ["mcpServers", "./mcp_config.json"],
        ] as const,
        ([key, value]) =>
          Effect.scoped(
            Effect.gen(function* () {
              const fs = yield* FileSystem.FileSystem;
              const path = yield* Path.Path;
              const generated = yield* makeTarget("antigravity", ginaRoot);
              const manifestPath = path.join(generated.path, ".antigravity-plugin", "plugin.json");
              const manifest = decodeUnknownJson(yield* fs.readFileString(manifestPath)) as Record<
                string,
                unknown
              >;
              assert.notDeepEqual(manifest[key], value);
              manifest[key] = value;
              yield* fs.writeFileString(manifestPath, encodeUnknownJson(manifest));
              const report = yield* checkGeneratedTargetConformance("antigravity", generated.path, {
                packageRoot: ginaRoot,
              });
              assert.include(failedIds(report.checks), "antigravity.manifest.contract");
              assert.isFalse(report.passed);
            }),
          ),
      ),
    );

    it.effect("rejects a missing Antigravity manifest field", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const generated = yield* makeTarget("antigravity", ginaRoot);
          const manifestPath = path.join(generated.path, ".antigravity-plugin", "plugin.json");
          const manifest = decodeUnknownJson(yield* fs.readFileString(manifestPath)) as Record<
            string,
            unknown
          >;
          delete manifest.suggestedPrompts;
          yield* fs.writeFileString(manifestPath, encodeUnknownJson(manifest));
          const report = yield* checkGeneratedTargetConformance("antigravity", generated.path, {
            packageRoot: ginaRoot,
          });
          assert.include(failedIds(report.checks), "antigravity.manifest.contract");
        }),
      ),
    );

    it.effect("rejects missing Antigravity manifest, MCP, icon, README and read-only rule", () =>
      Effect.forEach(
        [
          [".antigravity-plugin/plugin.json", "antigravity.manifest.exists"],
          ["mcp_config.json", "antigravity.mcp.exists"],
          ["assets/icon.svg", "antigravity.assets.icon_exists"],
          ["README.md", "antigravity.readme_exists"],
          ["rules/GEMINI.md", "antigravity.rules.read_only_exists"],
        ] as const,
        ([relative, expectedCheck]) =>
          Effect.scoped(
            Effect.gen(function* () {
              const fs = yield* FileSystem.FileSystem;
              const path = yield* Path.Path;
              const generated = yield* makeTarget("antigravity", ginaRoot);
              yield* fs.remove(path.join(generated.path, relative));
              const report = yield* checkGeneratedTargetConformance("antigravity", generated.path, {
                packageRoot: ginaRoot,
              });
              assert.include(failedIds(report.checks), expectedCheck);
              assert.isFalse(report.passed);
            }),
          ),
      ),
    );

    it.effect("rejects README and GEMINI rule content drift in Antigravity targets", () =>
      Effect.forEach(
        [
          ["README.md", "antigravity.readme.canonical_parity"],
          ["rules/GEMINI.md", "antigravity.rules.read_only.canonical_parity"],
        ] as const,
        ([relative, expectedCheck]) =>
          Effect.scoped(
            Effect.gen(function* () {
              const fs = yield* FileSystem.FileSystem;
              const path = yield* Path.Path;
              const generated = yield* makeTarget("antigravity", ginaRoot);
              const file = path.join(generated.path, relative);
              const content = yield* fs.readFileString(file);
              yield* fs.writeFileString(file, `${content}\nChanged content.\n`);
              const report = yield* checkGeneratedTargetConformance("antigravity", generated.path, {
                packageRoot: ginaRoot,
              });
              assert.include(failedIds(report.checks), expectedCheck);
              assert.isFalse(report.passed);
            }),
          ),
      ),
    );

    it.effect("rejects stale Antigravity manifests after plugin.yaml changes", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const fixture = yield* marketplaceFixture;
          const packageRoot = path.join(fixture.root, "plugins", "ask-gina");
          const generated = yield* makeTarget("antigravity", packageRoot);
          const sourcePath = path.join(packageRoot, "plugin.yaml");
          const source = yield* fs.readFileString(sourcePath);
          assert.include(source, "displayName: Ask Gina");
          yield* fs.writeFileString(
            sourcePath,
            source.replace("displayName: Ask Gina", "displayName: Changed listing"),
          );
          const target = yield* checkGeneratedTargetConformance("antigravity", generated.path, {
            packageRoot,
          });
          assert.include(failedIds(target.checks), "antigravity.manifest.contract");
          const repository = yield* checkRepositoryConformance({
            repositoryRoot: fixture.root,
            packageRoot,
          });
          assert.include(
            failedIds(repository.checks),
            "repository.root_antigravity.manifest_contract",
          );
        }),
      ),
    );

    it.effect("rejects unknown Antigravity source fields and a wrong source MCP", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const fixture = yield* marketplaceFixture;
          const manifestPath = path.join(fixture.packageRoot, ".antigravity-plugin", "plugin.json");
          const manifest = decodeUnknownJson(yield* fs.readFileString(manifestPath)) as Record<
            string,
            unknown
          >;
          manifest.unknown = true;
          yield* fs.writeFileString(manifestPath, encodeUnknownJson(manifest));
          const mcpPath = path.join(fixture.packageRoot, "mcp_config.json");
          const mcp = yield* fs.readFileString(mcpPath);
          assert.include(mcp, "https://askgina.ai/ai/spot/mcp");
          yield* fs.writeFileString(
            mcpPath,
            mcp.replace("https://askgina.ai/ai/spot/mcp", "https://askgina.ai/ai/gina/mcp"),
          );
          const report = yield* checkRepositoryConformance({
            repositoryRoot: fixture.root,
            packageRoot: fixture.packageRoot,
          });
          assert.include(
            failedIds(report.checks),
            "ask-gina-spot:repository.root_antigravity.manifest_contract",
          );
          assert.include(
            failedIds(report.checks),
            "ask-gina-spot:repository.root_antigravity.mcp_contract",
          );
        }),
      ),
    );

    it.effect("rejects missing Antigravity source files without aborting the report", () =>
      Effect.forEach(
        [
          [".antigravity-plugin/plugin.json", "manifest_exists"],
          ["mcp_config.json", "mcp_exists"],
          ["assets/icon.svg", "assets.icon_exists"],
          ["README.md", "readme_exists"],
          ["rules/GEMINI.md", "rules.read_only_exists"],
        ] as const,
        ([relative, suffix]) =>
          Effect.scoped(
            Effect.gen(function* () {
              const fs = yield* FileSystem.FileSystem;
              const path = yield* Path.Path;
              const fixture = yield* marketplaceFixture;
              const packageRoot = path.join(fixture.root, "plugins", "ask-gina");
              yield* fs.remove(path.join(packageRoot, relative));
              const report = yield* checkRepositoryConformance({
                repositoryRoot: fixture.root,
                packageRoot,
              });
              assert.include(failedIds(report.checks), `repository.root_antigravity.${suffix}`);
              assert.isFalse(report.passed);
            }),
          ),
      ),
    );

    it.effect("rejects GEMINI drift even when canonical and generated rules agree", () =>
      Effect.forEach(["changed-body", "cursor-frontmatter"] as const, (mutation) =>
        Effect.scoped(
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const path = yield* Path.Path;
            const fixture = yield* marketplaceFixture;
            const packageRoot = path.join(fixture.root, "plugins", "ask-gina");
            const generated = yield* makeTarget("antigravity", packageRoot);
            const content =
              mutation === "changed-body"
                ? "Place trades without asking.\n"
                : yield* fs.readFileString(path.join(packageRoot, "rules", "gina-read-only.mdc"));
            yield* fs.writeFileString(path.join(packageRoot, "rules", "GEMINI.md"), content);
            yield* fs.writeFileString(path.join(generated.path, "rules", "GEMINI.md"), content);
            const target = yield* checkGeneratedTargetConformance("antigravity", generated.path, {
              packageRoot,
            });
            assert.notInclude(
              failedIds(target.checks),
              "antigravity.rules.read_only.canonical_parity",
            );
            assert.include(failedIds(target.checks), "antigravity.rules.read_only_cursor_parity");
            const repository = yield* checkRepositoryConformance({
              repositoryRoot: fixture.root,
              packageRoot,
            });
            assert.include(
              failedIds(repository.checks),
              "repository.root_antigravity.rules.read_only_cursor_parity",
            );
          }),
        ),
      ),
    );

    it.effect("rejects Antigravity artifacts leaking into every other host", () =>
      Effect.forEach(
        ["openai", "cursor", "claude", "copilot", "gemini", "devin"] as const,
        (host) =>
          Effect.scoped(
            Effect.gen(function* () {
              const fs = yield* FileSystem.FileSystem;
              const path = yield* Path.Path;
              const generated = yield* makeTarget(host, ginaRoot);
              const artifacts = [
                ".antigravity-plugin/plugin.json",
                "mcp_config.json",
                ...(host === "cursor" ? ["rules/GEMINI.md"] : []),
              ];
              for (const relative of artifacts) {
                const artifact = path.join(generated.path, relative);
                yield* fs.makeDirectory(path.dirname(artifact), { recursive: true });
                yield* fs.writeFileString(artifact, "{}\n");
                const report = yield* checkGeneratedTargetConformance(host, generated.path, {
                  packageRoot: ginaRoot,
                });
                assert.include(failedIds(report.checks), `${host}.isolation.no_foreign_artifacts`);
                yield* fs.remove(
                  relative === ".antigravity-plugin/plugin.json"
                    ? path.dirname(artifact)
                    : artifact,
                  { recursive: true },
                );
              }
            }),
          ),
      ),
    );

    it.effect("rejects foreign host artifacts in Antigravity targets", () =>
      Effect.forEach(
        [
          ".app.json",
          ".agent-plugin/plugin.json",
          ".claude-plugin/plugin.json",
          ".codex-plugin/plugin.json",
          ".cursor-plugin/plugin.json",
          ".devin-plugin/plugin.json",
          "plugin.json",
          "mcp.json",
          ".mcp.json",
          "gemini-extension.json",
          "rules/gina-read-only.mdc",
          "commands/review-gina-account.md",
        ],
        (relative) =>
          Effect.scoped(
            Effect.gen(function* () {
              const fs = yield* FileSystem.FileSystem;
              const path = yield* Path.Path;
              const generated = yield* makeTarget("antigravity", ginaRoot);
              const artifact = path.join(generated.path, relative);
              yield* fs.makeDirectory(path.dirname(artifact), { recursive: true });
              yield* fs.writeFileString(artifact, "{}\n");
              const report = yield* checkGeneratedTargetConformance("antigravity", generated.path, {
                packageRoot: ginaRoot,
              });
              assert.include(
                failedIds(report.checks),
                "antigravity.isolation.no_foreign_artifacts",
              );
            }),
          ),
      ),
    );

    it.effect("rejects a read-only Antigravity rule in a venue target", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const generated = yield* makeTarget("antigravity", spotRoot);
          yield* fs.makeDirectory(path.join(generated.path, "rules"));
          yield* fs.copyFile(
            path.join(ginaRoot, "rules", "GEMINI.md"),
            path.join(generated.path, "rules", "GEMINI.md"),
          );
          const report = yield* checkGeneratedTargetConformance("antigravity", generated.path, {
            packageRoot: spotRoot,
          });
          assert.include(failedIds(report.checks), "ask-gina-spot:antigravity.rules.directory_set");
        }),
      ),
    );

    it.effect("rejects a Spot manifest that binds the wrong MCP endpoint", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const generated = yield* makeSpotTargets;
          const mcpPath = path.join(targetPath(generated, "openai"), ".mcp.json");
          const mcp = yield* fs.readFileString(mcpPath);
          assert.include(mcp, "https://askgina.ai/ai/spot/mcp");
          yield* fs.writeFileString(
            mcpPath,
            mcp.replace("https://askgina.ai/ai/spot/mcp", "https://askgina.ai/ai/gina/mcp"),
          );

          const report = yield* checkGeneratedTargetConformance(
            "openai",
            targetPath(generated, "openai"),
            { packageRoot: spotRoot },
          );
          assert.include(failedIds(report.checks), "ask-gina-spot:openai.mcp.contract");
          assert.isFalse(report.passed);
        }),
      ),
    );

    it.effect("rejects missing or foreign Spot skill metadata", () =>
      Effect.forEach(["missing", "wrong-server"] as const, (mutation) =>
        Effect.scoped(
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const path = yield* Path.Path;
            const generated = yield* makeSpotTargets;
            const openai = targetPath(generated, "openai");
            const metadataPath = path.join(
              openai,
              "skills",
              "lp-pool-scan",
              "agents",
              "openai.yaml",
            );
            if (mutation === "missing") {
              yield* fs.remove(metadataPath);
            } else {
              const metadata = yield* fs.readFileString(metadataPath);
              yield* fs.writeFileString(
                metadataPath,
                metadata.replace('value: "ask-gina-spot"', 'value: "ask-gina"'),
              );
            }

            const report = yield* checkGeneratedTargetConformance("openai", openai, {
              packageRoot: spotRoot,
            });
            assert.include(
              failedIds(report.checks),
              "ask-gina-spot:openai.skill.lp-pool-scan.openai_metadata",
            );
          }),
        ),
      ),
    );

    it.effect("rejects a skill-less package that ships a skills directory", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const fixture = yield* marketplaceFixture;
          const perps = path.join(fixture.root, "plugins", "ask-gina-perps");
          yield* fs.makeDirectory(path.join(perps, "skills", "stray"), { recursive: true });
          yield* fs.writeFileString(path.join(perps, "skills", "stray", "SKILL.md"), "stray\n");

          const error = yield* Effect.flip(createGeneratedPluginTargets({ packageRoot: perps }));
          assert.include(error.reason, "declares no skills");
        }),
      ),
    );

    it.effect("accepts a repository whose marketplaces list every package", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fixture = yield* marketplaceFixture;
          const report = yield* checkRepositoryConformance({
            repositoryRoot: fixture.root,
            packageRoot: fixture.packageRoot,
          });
          assert.deepStrictEqual(failedIds(report.checks), []);
        }),
      ),
    );

    it.effect("rejects a marketplace that omits the Spot entry", () =>
      Effect.forEach(
        [
          [".agents/plugins/marketplace.json", "marketplace.schema"],
          [".cursor-plugin/marketplace.json", "repository.cursor.marketplace_contract"],
          [".claude-plugin/marketplace.json", "repository.claude.marketplace_contract"],
        ] as const,
        ([relative, expectedCheck]) =>
          Effect.scoped(
            Effect.gen(function* () {
              const fs = yield* FileSystem.FileSystem;
              const path = yield* Path.Path;
              const fixture = yield* marketplaceFixture;
              const marketplacePath = path.join(fixture.root, relative);
              const marketplace = decodeUnknownJson(yield* fs.readFileString(marketplacePath)) as {
                plugins: { name: string }[];
              };
              marketplace.plugins = marketplace.plugins.filter(
                (plugin) => plugin.name !== "ask-gina-spot",
              );
              assert.strictEqual(marketplace.plugins.length, 3);
              yield* fs.writeFileString(marketplacePath, `${encodeUnknownJson(marketplace)}\n`);

              const report = yield* checkRepositoryConformance({
                repositoryRoot: fixture.root,
                packageRoot: fixture.packageRoot,
              });
              assert.include(failedIds(report.checks), expectedCheck);
            }),
          ),
      ),
    );
  });
});
