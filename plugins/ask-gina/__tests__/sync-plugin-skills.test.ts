import * as BunServices from "@effect/platform-bun/BunServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";

import {
  createGeneratedPluginTarget,
  createGeneratedPluginTargets,
  SKILL_NAMES,
  TARGET_NAMES,
} from "../../../tools/sync-plugin-skills";

const makeGeneratedTargets = Effect.acquireRelease(
  createGeneratedPluginTargets(),
  (generatedTargets) => generatedTargets.cleanup.pipe(Effect.orDie),
);

describe("sync-plugin-skills", () => {
  it.layer(BunServices.layer)((it) => {
    it.effect("loads OpenAI from the plugin root and retains non-OpenAI overlays", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const paths = yield* Path.Path;
          const generatedTargets = yield* makeGeneratedTargets;
          const packageRoot = paths.resolve("plugins/ask-gina");
          const canonicalSkillsRoot = paths.join(packageRoot, "skills");

          assert.isTrue(yield* fs.exists(paths.join(packageRoot, ".codex-plugin", "plugin.json")));
          assert.isTrue(yield* fs.exists(paths.join(packageRoot, ".mcp.json")));
          assert.isTrue(yield* fs.exists(paths.join(packageRoot, "assets", "icon.svg")));
          assert.isFalse(yield* fs.exists(paths.join(packageRoot, "targets", "openai")));
          assert.deepStrictEqual(
            (yield* fs.readDirectory(generatedTargets.targets.openai)).sort(),
            [".codex-plugin", ".mcp.json", "assets", "skills"],
          );

          for (const relative of [
            [".codex-plugin", "plugin.json"],
            [".mcp.json"],
            ["assets", "icon.svg"],
          ] as const) {
            assert.strictEqual(
              yield* fs.readFileString(paths.join(generatedTargets.targets.openai, ...relative)),
              yield* fs.readFileString(paths.join(packageRoot, ...relative)),
            );
          }

          for (const hostName of TARGET_NAMES.filter((hostName) => hostName !== "openai")) {
            assert.deepStrictEqual(
              (yield* fs.readDirectory(generatedTargets.targets[hostName]))
                .filter((entry) => entry !== "skills")
                .sort(),
              (yield* fs.readDirectory(paths.join(packageRoot, "targets", hostName))).sort(),
            );
          }

          for (const hostName of TARGET_NAMES) {
            for (const skillName of SKILL_NAMES) {
              const canonicalSkillPath = paths.join(canonicalSkillsRoot, skillName, "SKILL.md");
              const generatedSkillPath = paths.join(
                generatedTargets.targets[hostName],
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
                  generatedTargets.targets.openai,
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
                    generatedTargets.targets[hostName],
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
  });
});
