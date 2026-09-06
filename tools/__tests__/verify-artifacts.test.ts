import { fileURLToPath } from "node:url";

import * as BunServices from "@effect/platform-bun/BunServices";
import { assert, describe, it } from "@effect/vitest";
import { ChildProcess } from "effect/unstable/process";
import { Config, Effect, FileSystem, Path, Schema } from "effect";

import {
  findEmbeddedSourceMapBoundaryRules,
  inspectSourceMapText,
  isDeclaredPngAsset,
} from "../check-public-boundary";
import { checkRepositoryConformance, type RepositorySummary } from "../check-target-conformance";
import {
  ArtifactVerificationError,
  OPENAI_ASSETS,
  runNodeEsmSmoke,
  snapshotArtifactInputs,
  verifyNoInstalledLibrarySources,
  verifyNode24Consumer,
  verifyOpenAiArchivePayload,
} from "../verify-artifacts";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const SKILLS = [
  "research-hyperliquid",
  "research-prediction-markets",
  "research-spot-tokens",
  "review-gina-account",
] as const;
const UnknownJsonString = Schema.fromJsonString(Schema.Unknown);
const decodeUnknownJson = Schema.decodeUnknownSync(UnknownJsonString);
const encodeUnknownJson = Schema.encodeUnknownSync(UnknownJsonString);

const repositoryFixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "repository-conformance-test-" });
  yield* Effect.all(
    [
      fs.copy(path.join(repositoryRoot, ".agents"), path.join(root, ".agents")),
      fs.copy(path.join(repositoryRoot, ".claude-plugin"), path.join(root, ".claude-plugin")),
      fs.copy(path.join(repositoryRoot, ".cursor-plugin"), path.join(root, ".cursor-plugin")),
      fs.copy(
        path.join(repositoryRoot, "plugins", "ask-gina"),
        path.join(root, "plugins", "ask-gina"),
      ),
    ],
    { concurrency: "unbounded" },
  );
  return { root, packageRoot: path.join(root, "plugins", "ask-gina") };
});

const readMarketplace = (root: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return decodeUnknownJson(
      yield* fs.readFileString(path.join(root, ".agents", "plugins", "marketplace.json")),
    ) as Record<string, unknown>;
  });

const writeMarketplace = (root: string, marketplace: Record<string, unknown>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fs.writeFileString(
      path.join(root, ".agents", "plugins", "marketplace.json"),
      `${encodeUnknownJson(marketplace)}\n`,
    );
  });

const failedCheck = (report: RepositorySummary, id: string): boolean =>
  report.checks.some((check) => check.id === id && !check.passed);

const makeLeanOpenAiPayload = (root: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const files = [
      ".codex-plugin/plugin.json",
      ".mcp.json",
      ...OPENAI_ASSETS.map((asset) => `assets/${asset}`),
      ...SKILLS.flatMap((skill) => [
        `skills/${skill}/SKILL.md`,
        `skills/${skill}/agents/openai.yaml`,
      ]),
    ];
    yield* Effect.forEach(files, (file) =>
      Effect.gen(function* () {
        const destination = path.join(root, file);
        yield* fs.makeDirectory(path.dirname(destination), { recursive: true });
        yield* fs.writeFileString(destination, `${file}\n`);
      }),
    );
  });

describe("artifact and source conformance verification", () => {
  it.layer(BunServices.layer)((it) => {
    it.effect("executes only snapshotted bytes after canonical comparison", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const directory = yield* fs.makeTempDirectoryScoped({ prefix: "artifact-input-test-" });
          const dist = path.join(directory, "dist");
          const snapshot = path.join(directory, "snapshot");
          const canonical = path.join(directory, "canonical.sh");
          const relative = "packages/askgina-cli.tgz";
          const mutableArtifact = path.join(dist, relative);
          const snapshottedArtifact = path.join(snapshot, relative);
          const marker = path.join(directory, "impact-marker");
          const trusted = '#!/bin/sh\nprintf trusted > "$1"\n';
          const attacker = '#!/bin/sh\nprintf attacker > "$1"\n';

          yield* fs.makeDirectory(path.dirname(mutableArtifact), { recursive: true });
          yield* fs.writeFileString(mutableArtifact, trusted);
          yield* fs.writeFileString(canonical, trusted);
          yield* snapshotArtifactInputs(dist, snapshot, [relative]);

          assert.deepStrictEqual(
            yield* fs.readFile(snapshottedArtifact),
            yield* fs.readFile(canonical),
          );
          yield* fs.writeFileString(mutableArtifact, attacker);

          const child = yield* ChildProcess.make("sh", [snapshottedArtifact, marker], {
            cwd: directory,
            env: { PATH: "/usr/bin:/bin" },
            extendEnv: false,
            stdin: "ignore",
            stdout: "ignore",
            stderr: "ignore",
          });
          assert.strictEqual(yield* child.exitCode, 0);
          assert.strictEqual(yield* fs.readFileString(marker), "trusted");
        }),
      ),
    );
    it.effect("fails closed when Node 24 is unavailable", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const directory = yield* fs.makeTempDirectoryScoped({ prefix: "node24-missing-test-" });
          const missingNode = path.join(directory, "missing-node");
          const error = yield* verifyNode24Consumer({
            node: missingNode,
            project: directory,
            env: { PATH: "/usr/bin:/bin" },
          }).pipe(Effect.flip);
          assert.include(error.message, `cannot start ${missingNode}`);
        }),
      ),
    );

    it.effect("rejects raw installed library sources", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const directory = yield* fs.makeTempDirectoryScoped({ prefix: "raw-source-test-" });
          yield* fs.makeDirectory(path.join(directory, "node_modules/@askgina/sdk/src"), {
            recursive: true,
          });
          const error = yield* verifyNoInstalledLibrarySources(directory).pipe(Effect.flip);
          assert.strictEqual(error.message, "@askgina/sdk installed raw source");
        }),
      ),
    );

    it.effect("rejects broken exports and undeclared runtime imports", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const directory = yield* fs.makeTempDirectoryScoped({ prefix: "node-esm-test-" });
          const packageRoot = path.join(directory, "node_modules/@askgina/sdk");
          const dist = path.join(packageRoot, "dist");
          yield* fs.makeDirectory(dist, { recursive: true });
          const writeManifest = (entry: string) =>
            fs.writeFileString(
              path.join(packageRoot, "package.json"),
              `${JSON.stringify({
                name: "@askgina/sdk",
                type: "module",
                exports: { ".": { import: entry } },
              })}\n`,
            );
          const env = {
            PATH: yield* Config.string("PATH").pipe(Config.withDefault("/usr/bin:/bin")),
            HOME: directory,
          };
          const importScript =
            '// Dynamic import intentionally exercises the installed package export boundary.\nawait import("@askgina/sdk");';

          yield* writeManifest("./dist/missing.js");
          const brokenExports = yield* runNodeEsmSmoke({
            node: "node",
            cwd: directory,
            source: importScript,
            env,
          }).pipe(Effect.flip);
          assert.strictEqual(brokenExports.message, "Node ESM smoke failed");

          yield* writeManifest("./dist/index.js");
          yield* fs.writeFileString(
            path.join(dist, "index.js"),
            'import "undeclared-runtime"; export const value = 1;\n',
          );
          const undeclaredDependency = yield* runNodeEsmSmoke({
            node: "node",
            cwd: directory,
            source: importScript,
            env,
          }).pipe(Effect.flip);
          assert.strictEqual(undeclaredDependency.message, "Node ESM smoke failed");
        }),
      ),
    );

    it("inspects embedded source without treating map identifiers as imports", () => {
      const harmlessText = JSON.stringify({
        version: 3,
        names: ["@effect/platform-node"],
        sources: ["../src/index.ts"],
        sourcesContent: ['const platformNodeIdentifier = "@effect/platform-node";\n'],
      });
      const harmless = inspectSourceMapText(harmlessText);
      assert.isDefined(harmless);
      assert.isFalse(harmless.unsafeSourcePath);
      assert.notInclude(findEmbeddedSourceMapBoundaryRules(harmlessText), "forbidden-runtime");

      const forbiddenRuntime = ["@effect/platform", "-node"].join("");
      const forbiddenText = JSON.stringify({
        version: 3,
        sources: ["../src/index.ts"],
        sourcesContent: [`import "${forbiddenRuntime}";\n`],
      });
      assert.isDefined(inspectSourceMapText(forbiddenText));
      assert.include(findEmbeddedSourceMapBoundaryRules(forbiddenText), "forbidden-runtime");
      assert.isUndefined(
        inspectSourceMapText(
          JSON.stringify({ version: 3, sources: ["../src/index.ts"], sourcesContent: [] }),
        ),
      );
      assert.isTrue(
        inspectSourceMapText(
          JSON.stringify({
            version: 3,
            sources: ["/home/private/src/index.ts"],
            sourcesContent: ["export {};\n"],
          }),
        )?.unsafeSourcePath,
      );
    });

    it("admits only reviewed PNG assets at their declared paths", () => {
      const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
      for (const path of [
        "docs/images/product/agent-setup-read-only.png",
        "docs/images/product/create-prompt.png",
        "docs/images/product/perps-markets.png",
        "docs/images/product/prediction-outcomes.png",
        "docs/images/product/recipient-review.png",
        "docs/images/product/wallet-balance.png",
        "docs/images/product/workflow-results.png",
      ]) {
        assert.isTrue(isDeclaredPngAsset({ label: path, bytes: png }));
      }
      assert.isFalse(
        isDeclaredPngAsset({ label: "docs/images/product/unreviewed.png", bytes: png }),
      );
      assert.isFalse(
        isDeclaredPngAsset({
          label: "docs/images/product/wallet-balance.png",
          bytes: Uint8Array.from([0]),
        }),
      );
    });

    it.effect("accepts the exact repository marketplace and clean root plugin layout", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fixture = yield* repositoryFixture;
          const report = yield* checkRepositoryConformance({
            repositoryRoot: fixture.root,
            packageRoot: fixture.packageRoot,
          });
          assert.isTrue(report.passed);
        }),
      ),
    );

    it.effect("rejects malformed marketplace policy, category, source, escape, and version", () =>
      Effect.gen(function* () {
        const cases: readonly Readonly<{
          readonly expectedCheck: string;
          readonly mutate: (marketplace: Record<string, unknown>) => void;
        }>[] = [
          {
            expectedCheck: "marketplace.schema",
            mutate: (marketplace) => {
              const plugin = (marketplace.plugins as Record<string, unknown>[])[0];
              if (plugin !== undefined) {
                plugin.policy = { installation: "ENABLED", authentication: "ON_INSTALL" };
              }
            },
          },
          {
            expectedCheck: "marketplace.schema",
            mutate: (marketplace) => {
              const plugin = (marketplace.plugins as Record<string, unknown>[])[0];
              if (plugin !== undefined) plugin.category = "Other";
            },
          },
          {
            expectedCheck: "marketplace.schema",
            mutate: (marketplace) => {
              const plugin = (marketplace.plugins as Record<string, unknown>[])[0];
              if (plugin !== undefined) plugin.source = "./plugins/ask-gina";
            },
          },
          {
            expectedCheck: "marketplace.source_containment",
            mutate: (marketplace) => {
              const plugin = (marketplace.plugins as Record<string, unknown>[])[0];
              if (plugin !== undefined) {
                plugin.source = { source: "local", path: "../outside" };
              }
            },
          },
          {
            expectedCheck: "marketplace.no_version",
            mutate: (marketplace) => {
              marketplace.version = "0.1.0";
            },
          },
        ];

        yield* Effect.forEach(cases, ({ expectedCheck, mutate }) =>
          Effect.scoped(
            Effect.gen(function* () {
              const fixture = yield* repositoryFixture;
              const marketplace = yield* readMarketplace(fixture.root);
              mutate(marketplace);
              yield* writeMarketplace(fixture.root, marketplace);
              const report = yield* checkRepositoryConformance({
                repositoryRoot: fixture.root,
                packageRoot: fixture.packageRoot,
              });
              assert.isTrue(failedCheck(report, expectedCheck));
            }),
          ),
        );
      }),
    );

    it.effect(
      "rejects missing Cursor marketplace, missing mcp.json, and a legacy Cursor overlay",
      () =>
        Effect.forEach(
          ["missing-marketplace", "missing-mcp", "legacy-overlay"] as const,
          (mutation) =>
            Effect.scoped(
              Effect.gen(function* () {
                const fs = yield* FileSystem.FileSystem;
                const path = yield* Path.Path;
                const fixture = yield* repositoryFixture;
                if (mutation === "missing-marketplace") {
                  yield* fs.remove(path.join(fixture.root, ".cursor-plugin"), {
                    recursive: true,
                    force: true,
                  });
                } else if (mutation === "missing-mcp") {
                  yield* fs.remove(path.join(fixture.packageRoot, "mcp.json"));
                } else {
                  yield* fs.makeDirectory(path.join(fixture.packageRoot, "targets", "cursor"), {
                    recursive: true,
                  });
                }
                const report = yield* checkRepositoryConformance({
                  repositoryRoot: fixture.root,
                  packageRoot: fixture.packageRoot,
                });
                const expected =
                  mutation === "missing-marketplace"
                    ? "repository.cursor.marketplace_exists"
                    : mutation === "missing-mcp"
                      ? "repository.root_cursor.mcp_exists"
                      : "repository.legacy_cursor.absent";
                assert.isTrue(failedCheck(report, expected));
              }),
            ),
        ),
    );

    it.effect("rejects an unsafe root Devin plugin and malformed direct plugin source", () =>
      Effect.forEach(
        [
          "root-manifest",
          "missing-plugin-manifest",
          "plugin-version-drift",
          "legacy-overlay",
        ] as const,
        (mutation) =>
          Effect.scoped(
            Effect.gen(function* () {
              const fs = yield* FileSystem.FileSystem;
              const path = yield* Path.Path;
              const fixture = yield* repositoryFixture;
              if (mutation === "root-manifest") {
                const rootManifest = path.join(fixture.root, ".devin-plugin", "plugin.json");
                yield* fs.makeDirectory(path.dirname(rootManifest), { recursive: true });
                yield* fs.writeFileString(rootManifest, "{}\n");
              } else if (mutation === "legacy-overlay") {
                yield* fs.makeDirectory(path.join(fixture.packageRoot, "targets", "devin"), {
                  recursive: true,
                });
              } else {
                const manifestPath = path.join(fixture.packageRoot, ".devin-plugin", "plugin.json");
                if (mutation === "missing-plugin-manifest") {
                  yield* fs.remove(manifestPath);
                } else {
                  const manifest = decodeUnknownJson(
                    yield* fs.readFileString(manifestPath),
                  ) as Record<string, unknown>;
                  manifest.version = "99.0.0";
                  yield* fs.writeFileString(manifestPath, `${encodeUnknownJson(manifest)}\n`);
                }
              }
              const report = yield* checkRepositoryConformance({
                repositoryRoot: fixture.root,
                packageRoot: fixture.packageRoot,
              });
              const expected =
                mutation === "root-manifest"
                  ? "repository.devin.root_manifest_absent"
                  : mutation === "missing-plugin-manifest"
                    ? "repository.devin.plugin_manifest_exists"
                    : mutation === "plugin-version-drift"
                      ? "repository.devin.plugin_manifest_contract"
                      : "repository.legacy_devin.absent";
              assert.isTrue(failedCheck(report, expected));
            }),
          ),
      ),
    );

    it.effect("rejects missing root files, version drift, and a legacy OpenAI overlay", () =>
      Effect.forEach(["missing-mcp", "version-drift", "legacy-overlay"] as const, (mutation) =>
        Effect.scoped(
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const path = yield* Path.Path;
            const fixture = yield* repositoryFixture;
            if (mutation === "missing-mcp") {
              yield* fs.remove(path.join(fixture.packageRoot, ".mcp.json"));
            } else if (mutation === "version-drift") {
              const manifestPath = path.join(fixture.packageRoot, ".codex-plugin", "plugin.json");
              const manifest = decodeUnknownJson(yield* fs.readFileString(manifestPath)) as Record<
                string,
                unknown
              >;
              manifest.version = "99.0.0";
              yield* fs.writeFileString(manifestPath, `${encodeUnknownJson(manifest)}\n`);
            } else {
              yield* fs.makeDirectory(path.join(fixture.packageRoot, "targets", "openai"), {
                recursive: true,
              });
            }
            const report = yield* checkRepositoryConformance({
              repositoryRoot: fixture.root,
              packageRoot: fixture.packageRoot,
            });
            const expected =
              mutation === "missing-mcp"
                ? "repository.root_openai.mcp_exists"
                : mutation === "version-drift"
                  ? "repository.root_openai.manifest_contract"
                  : "repository.legacy_openai.absent";
            assert.isTrue(failedCheck(report, expected));
          }),
        ),
      ),
    );

    it.effect("rejects symbolic links in the loadable plugin source", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const fixture = yield* repositoryFixture;
          const external = path.join(fixture.root, "external-icon.svg");
          const icon = path.join(fixture.packageRoot, "assets", "icon.svg");
          yield* fs.writeFileString(external, "<svg />\n");
          yield* fs.remove(icon);
          yield* fs.symlink(external, icon);
          const report = yield* checkRepositoryConformance({
            repositoryRoot: fixture.root,
            packageRoot: fixture.packageRoot,
          });
          assert.isTrue(failedCheck(report, "repository.source.no_symlinks"));
        }),
      ),
    );

    it.effect("requires the exact lean OpenAI archive payload", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const stage = yield* fs.makeTempDirectoryScoped({ prefix: "openai-payload-test-" });
          yield* makeLeanOpenAiPayload(stage);
          yield* verifyOpenAiArchivePayload(stage);

          const foreign = path.join(stage, "targets", "claude", ".mcp.json");
          yield* fs.makeDirectory(path.dirname(foreign), { recursive: true });
          yield* fs.writeFileString(foreign, "{}\n");
          const error = yield* verifyOpenAiArchivePayload(stage).pipe(Effect.flip);
          assert.instanceOf(error, ArtifactVerificationError);
          assert.include(error.message, "OpenAI archive root");
        }),
      ),
    );
  });
});
