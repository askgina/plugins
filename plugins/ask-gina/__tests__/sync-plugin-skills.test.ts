import * as BunServices from "@effect/platform-bun/BunServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";

import {
  createGeneratedPluginTarget,
  createGeneratedPluginTargets,
  SKILL_NAMES,
  TARGET_NAMES,
  targetsForPackage,
  type GeneratedPluginTargets,
  type TargetName,
} from "../../../tools/sync-plugin-skills";

const makeGeneratedTargets = (packageRoot?: string) =>
  Effect.acquireRelease(createGeneratedPluginTargets({ packageRoot }), (generatedTargets) =>
    generatedTargets.cleanup.pipe(Effect.orDie),
  );

const targetPath = (generated: GeneratedPluginTargets, host: TargetName): string => {
  const path = generated.targets[host];
  return path === undefined ? assert.fail(`${host} was not generated`) : path;
};

describe("sync-plugin-skills", () => {
  it.layer(BunServices.layer)((it) => {
    it.effect("loads OpenAI, Cursor, and Devin from the plugin root", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const paths = yield* Path.Path;
          const generatedTargets = yield* makeGeneratedTargets();
          const packageRoot = paths.resolve("plugins/ask-gina");
          const canonicalSkillsRoot = paths.join(packageRoot, "skills");

          assert.deepStrictEqual(generatedTargets.hosts, TARGET_NAMES);
          assert.isTrue(yield* fs.exists(paths.join(packageRoot, ".codex-plugin", "plugin.json")));
          assert.isTrue(yield* fs.exists(paths.join(packageRoot, ".devin-plugin", "plugin.json")));
          assert.isTrue(yield* fs.exists(paths.join(packageRoot, ".mcp.json")));
          assert.isTrue(yield* fs.exists(paths.join(packageRoot, "assets", "icon.svg")));
          assert.isFalse(yield* fs.exists(paths.join(packageRoot, "targets", "openai")));
          assert.isFalse(yield* fs.exists(paths.join(packageRoot, "targets", "cursor")));
          assert.isFalse(yield* fs.exists(paths.join(packageRoot, "targets", "devin")));
          assert.deepStrictEqual(
            (yield* fs.readDirectory(targetPath(generatedTargets, "openai"))).sort(),
            [".codex-plugin", ".mcp.json", "assets", "skills"],
          );
          assert.deepStrictEqual(
            (yield* fs.readDirectory(targetPath(generatedTargets, "cursor"))).sort(),
            [".cursor-plugin", "README.md", "assets", "commands", "mcp.json", "rules", "skills"],
          );
          assert.deepStrictEqual(
            (yield* fs.readDirectory(targetPath(generatedTargets, "devin"))).sort(),
            [".devin-plugin", ".mcp.json", "assets", "skills"],
          );
          assert.deepStrictEqual(
            yield* fs.readDirectory(paths.join(targetPath(generatedTargets, "devin"), "assets")),
            ["icon.svg"],
          );

          for (const relative of [
            [".codex-plugin", "plugin.json"],
            [".mcp.json"],
            ["assets", "icon.svg"],
          ] as const) {
            assert.strictEqual(
              yield* fs.readFileString(
                paths.join(targetPath(generatedTargets, "openai"), ...relative),
              ),
              yield* fs.readFileString(paths.join(packageRoot, ...relative)),
            );
          }

          for (const relative of [
            [".cursor-plugin", "plugin.json"],
            ["mcp.json"],
            ["assets", "icon.svg"],
            ["README.md"],
            ["rules", "gina-read-only.mdc"],
            ["commands", "review-gina-account.md"],
            ["commands", "research-spot-tokens.md"],
            ["commands", "research-hyperliquid.md"],
            ["commands", "research-prediction-markets.md"],
          ] as const) {
            assert.strictEqual(
              yield* fs.readFileString(
                paths.join(targetPath(generatedTargets, "cursor"), ...relative),
              ),
              yield* fs.readFileString(paths.join(packageRoot, ...relative)),
            );
          }

          for (const relative of [
            [".devin-plugin", "plugin.json"],
            [".mcp.json"],
            ["assets", "icon.svg"],
          ] as const) {
            assert.strictEqual(
              yield* fs.readFileString(
                paths.join(targetPath(generatedTargets, "devin"), ...relative),
              ),
              yield* fs.readFileString(paths.join(packageRoot, ...relative)),
            );
          }

          for (const hostName of TARGET_NAMES.filter(
            (hostName) => hostName !== "openai" && hostName !== "cursor" && hostName !== "devin",
          )) {
            assert.deepStrictEqual(
              (yield* fs.readDirectory(targetPath(generatedTargets, hostName)))
                .filter((entry) => entry !== "skills")
                .sort(),
              (yield* fs.readDirectory(paths.join(packageRoot, "targets", hostName))).sort(),
            );
          }

          for (const hostName of TARGET_NAMES) {
            for (const skillName of SKILL_NAMES) {
              const canonicalSkillPath = paths.join(canonicalSkillsRoot, skillName, "SKILL.md");
              const generatedSkillPath = paths.join(
                targetPath(generatedTargets, hostName),
                "skills",
                skillName,
                "SKILL.md",
              );

              assert.isTrue(
                yield* fs.exists(generatedSkillPath),
                `${hostName} must include ${skillName}/SKILL.md`,
              );
              assert.strictEqual(
                yield* fs.readFileString(generatedSkillPath),
                yield* fs.readFileString(canonicalSkillPath),
                `${hostName} must preserve canonical ${skillName}/SKILL.md`,
              );
            }
          }

          for (const skillName of SKILL_NAMES) {
            assert.isTrue(
              yield* fs.exists(
                paths.join(
                  targetPath(generatedTargets, "openai"),
                  "skills",
                  skillName,
                  "agents",
                  "openai.yaml",
                ),
              ),
              `OpenAI must include ${skillName}/agents/openai.yaml`,
            );

            for (const hostName of TARGET_NAMES.filter((hostName) => hostName !== "openai")) {
              assert.isFalse(
                yield* fs.exists(
                  paths.join(
                    targetPath(generatedTargets, hostName),
                    "skills",
                    skillName,
                    "agents",
                    "openai.yaml",
                  ),
                ),
                `${hostName} must not include the OpenAI-only overlay for ${skillName}`,
              );
            }
          }
        }),
      ),
    );

    it.effect("generates the Ask Gina Spot hosts with every file of each skill", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const paths = yield* Path.Path;
          const packageRoot = paths.resolve("plugins/ask-gina-spot");
          const generated = yield* makeGeneratedTargets(packageRoot);

          assert.deepStrictEqual(generated.hosts, [
            "openai",
            "cursor",
            "claude",
            "copilot",
            "devin",
          ]);
          assert.deepStrictEqual(yield* targetsForPackage({ packageRoot }), generated.hosts);
          assert.isUndefined(generated.targets.gemini);
          assert.isTrue(paths.basename(generated.path).startsWith("ask-gina-spot-targets-"));

          assert.deepStrictEqual(
            (yield* fs.readDirectory(targetPath(generated, "openai"))).sort(),
            [".codex-plugin", ".mcp.json", "assets", "skills"],
          );
          // Spot ships no Cursor rule or commands; Cursor receives only what the package has.
          assert.deepStrictEqual(
            (yield* fs.readDirectory(targetPath(generated, "cursor"))).sort(),
            [".cursor-plugin", "README.md", "assets", "mcp.json", "skills"],
          );
          assert.deepStrictEqual((yield* fs.readDirectory(targetPath(generated, "devin"))).sort(), [
            ".devin-plugin",
            ".mcp.json",
            "assets",
            "skills",
          ]);

          const skills = (yield* fs.readDirectory(paths.join(packageRoot, "skills"))).sort();
          assert.deepStrictEqual(skills, ["lp-pool-scan", "lp-rebalancing-playbook"]);
          for (const host of generated.hosts) {
            for (const skill of skills) {
              const canonicalDirectory = paths.join(packageRoot, "skills", skill);
              const generatedDirectory = paths.join(targetPath(generated, host), "skills", skill);
              const canonicalFiles = (yield* fs.readDirectory(canonicalDirectory, {
                recursive: true,
              }))
                .filter((entry) => host === "openai" || !entry.startsWith("agents"))
                .sort();
              assert.deepStrictEqual(
                (yield* fs.readDirectory(generatedDirectory, { recursive: true })).sort(),
                canonicalFiles,
                `${host} must carry every file of ${skill}`,
              );
            }
          }
          assert.isTrue(
            yield* fs.exists(
              paths.join(
                targetPath(generated, "claude"),
                "skills",
                "lp-pool-scan",
                "scripts",
                "lp_pool_scan.py",
              ),
            ),
          );
          assert.isFalse(
            yield* fs.exists(
              paths.join(
                targetPath(generated, "cursor"),
                "skills",
                "lp-pool-scan",
                "agents",
                "openai.yaml",
              ),
            ),
          );
        }),
      ),
    );

    it.effect("rejects a host the package does not publish", () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          createGeneratedPluginTarget("gemini", { packageRoot: "plugins/ask-gina-spot" }),
        );
        assert.include(error.reason, "does not publish the gemini target");
      }),
    );

    it.effect("rejects a legacy OpenAI target overlay", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const paths = yield* Path.Path;
          const temporary = yield* fs.makeTempDirectoryScoped({
            prefix: "sync-plugin-skills-test-",
          });
          const packageRoot = paths.join(temporary, "ask-gina");
          yield* fs.copy(paths.resolve("plugins/ask-gina"), packageRoot, { overwrite: true });
          const legacyOverlay = paths.join(packageRoot, "targets", "openai");
          yield* fs.makeDirectory(legacyOverlay, { recursive: true });

          const error = yield* Effect.flip(createGeneratedPluginTarget("openai", { packageRoot }));
          assert.strictEqual(error.path, legacyOverlay);
          assert.include(error.reason, "legacy OpenAI target overlay");
        }),
      ),
    );

    it.effect("rejects a legacy Cursor target overlay", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const paths = yield* Path.Path;
          const temporary = yield* fs.makeTempDirectoryScoped({
            prefix: "sync-plugin-skills-test-",
          });
          const packageRoot = paths.join(temporary, "ask-gina");
          yield* fs.copy(paths.resolve("plugins/ask-gina"), packageRoot, { overwrite: true });
          const legacyOverlay = paths.join(packageRoot, "targets", "cursor");
          yield* fs.makeDirectory(legacyOverlay, { recursive: true });

          const error = yield* Effect.flip(createGeneratedPluginTarget("cursor", { packageRoot }));
          assert.strictEqual(error.path, legacyOverlay);
          assert.include(error.reason, "legacy Cursor target overlay");
        }),
      ),
    );

    it.effect("rejects a legacy Devin target overlay", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const paths = yield* Path.Path;
          const temporary = yield* fs.makeTempDirectoryScoped({
            prefix: "sync-plugin-skills-test-",
          });
          const packageRoot = paths.join(temporary, "ask-gina");
          yield* fs.copy(paths.resolve("plugins/ask-gina"), packageRoot, { overwrite: true });
          const legacyOverlay = paths.join(packageRoot, "targets", "devin");
          yield* fs.makeDirectory(legacyOverlay, { recursive: true });

          const error = yield* Effect.flip(createGeneratedPluginTarget("devin", { packageRoot }));
          assert.strictEqual(error.path, legacyOverlay);
          assert.include(error.reason, "legacy Devin target overlay");
        }),
      ),
    );
  });
});
