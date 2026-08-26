import * as BunServices from "@effect/platform-bun/BunServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";

import {
  createGeneratedPluginTargets,
  SKILL_NAMES,
  TARGET_NAMES,
} from "../../../tools/sync-plugin-skills.js";

const makeGeneratedTargets = Effect.acquireRelease(
  createGeneratedPluginTargets(),
  (generatedTargets) => generatedTargets.cleanup.pipe(Effect.orDie),
);

describe("sync-plugin-skills", () => {
  it.layer(BunServices.layer)((it) => {
    it.effect(
      "copies every canonical skill into every host and keeps the OpenAI overlay isolated",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const paths = yield* Path.Path;
            const generatedTargets = yield* makeGeneratedTargets;
            const canonicalSkillsRoot = paths.resolve("plugins/ask-gina/skills");

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
  });
});
