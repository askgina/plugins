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
  createGeneratedPluginTargets,
  type GeneratedPluginTargets,
  type TargetName,
} from "../sync-plugin-skills";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const spotRoot = fileURLToPath(new URL("../../plugins/ask-gina-spot/", import.meta.url));
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

/** A repository holding both marketplaces' descriptors, the Ask Gina manifest source and the whole Spot package. */
const marketplaceFixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "target-conformance-test-" });
  yield* fs.makeDirectory(path.join(root, "plugins", "ask-gina"), { recursive: true });
  yield* Effect.all(
    [
      fs.copy(path.join(repositoryRoot, ".agents"), path.join(root, ".agents")),
      fs.copy(path.join(repositoryRoot, ".claude-plugin"), path.join(root, ".claude-plugin")),
      fs.copy(path.join(repositoryRoot, ".cursor-plugin"), path.join(root, ".cursor-plugin")),
      fs.copyFile(
        path.join(repositoryRoot, "marketplace.yaml"),
        path.join(root, "marketplace.yaml"),
      ),
      fs.copyFile(
        path.join(repositoryRoot, "plugins", "ask-gina", "plugin.yaml"),
        path.join(root, "plugins", "ask-gina", "plugin.yaml"),
      ),
      fs.copy(spotRoot, path.join(root, "plugins", "ask-gina-spot")),
    ],
    { concurrency: "unbounded" },
  );
  return { root, packageRoot: path.join(root, "plugins", "ask-gina-spot") };
});

describe("target conformance across packages", () => {
  it.layer(BunServices.layer)((it) => {
    it.effect("passes for the repository and reports both packages", () =>
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
          "ask-gina-spot:openai",
          "ask-gina-spot:cursor",
          "ask-gina-spot:claude",
          "ask-gina-spot:copilot",
          "ask-gina-spot:devin",
        ]);
        assert.include(ids, "openai.manifest.contract");
        assert.include(ids, "cursor.rules.read_only_exists");
        assert.include(ids, "ask-gina-spot:openai.manifest.contract");
        assert.include(ids, "ask-gina-spot:repository.root_openai.manifest_contract");
        assert.include(ids, "ask-gina-spot:repository.plugin.mcp_contract");
        // Ids stay unique and the read-only invariants are not demanded of Spot.
        assert.strictEqual(new Set(ids).size, ids.length);
        assert.notInclude(ids, "ask-gina-spot:cursor.rules.read_only_exists");
        assert.notInclude(ids, "ask-gina-spot:cursor.commands.directory_set");
        assert.isFalse(ids.some((id) => id.startsWith("ask-gina-spot:gemini.")));
      }),
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
              assert.strictEqual(marketplace.plugins.length, 1);
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
