import { fileURLToPath } from "node:url";

import * as BunServices from "@effect/platform-bun/BunServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";

import { buildSkillIndex, runSkillIndex, SKILL_INDEX_PATH, SkillIndexError } from "../skill-index";

const skillDocument = (name: string, description = "Does a thing.") =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`;

const pluginManifest = (name: string, endpoint: string, skills: readonly string[]) =>
  [
    `name: ${name}`,
    "version: 0.1.0",
    "mcp:",
    `  url: https://askgina.ai/ai/${endpoint}/mcp`,
    "skills:",
    ...skills.flatMap((id) => [`  - id: ${id}`, "    mcpServed: true"]),
    "",
  ].join("\n");

const writeFixtureFile = (root: string, relative: string, content: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const target = path.join(root, relative);
    yield* fs.makeDirectory(path.dirname(target), { recursive: true });
    yield* fs.writeFileString(target, content);
  });

const makeRepository = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "skill-index-test-" });
  yield* writeFixtureFile(
    root,
    "plugins/alpha/plugin.yaml",
    pluginManifest("alpha", "gina", ["one", "two"]),
  );
  yield* writeFixtureFile(root, "plugins/alpha/skills/one/SKILL.md", skillDocument("one"));
  yield* writeFixtureFile(root, "plugins/alpha/skills/one/agents/openai.yaml", "interface: {}\n");
  yield* writeFixtureFile(root, "plugins/alpha/skills/two/SKILL.md", skillDocument("two"));
  yield* writeFixtureFile(
    root,
    "plugins/beta/plugin.yaml",
    pluginManifest("beta", "spot", ["three"]),
  );
  yield* writeFixtureFile(root, "plugins/beta/skills/three/SKILL.md", skillDocument("three"));
  return root;
});

const problemsOf = <A, R>(effect: Effect.Effect<A, SkillIndexError, R>) =>
  effect.pipe(
    Effect.flip,
    Effect.map((error) => error.problems),
  );

describe("skill index", () => {
  it.layer(BunServices.layer)((it) => {
    it.effect("indexes declared skills sorted by package then id", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const root = yield* makeRepository;
          const index = yield* buildSkillIndex(root);

          assert.strictEqual(index.version, 1);
          assert.deepStrictEqual(
            index.skills.map((skill) => `${skill.package}/${skill.id}`),
            ["alpha/one", "alpha/two", "beta/three"],
          );
          const one = index.skills[0];
          assert.deepStrictEqual(one?.files, [
            "plugins/alpha/skills/one/SKILL.md",
            "plugins/alpha/skills/one/agents/openai.yaml",
          ]);
          assert.strictEqual(one?.path, "plugins/alpha/skills/one");
          assert.strictEqual(one?.description, "Does a thing.");
          assert.strictEqual(one?.mcpEndpoint, "gina");
          assert.strictEqual(one?.mcpUrl, "https://askgina.ai/ai/gina/mcp");
          assert.isTrue(one?.mcpServed);
          assert.strictEqual(index.skills[2]?.mcpEndpoint, "spot");
        }),
      ),
    );

    it.effect("fails on a SKILL.md that no plugin declares, naming the file and the fix", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const root = yield* makeRepository;
          yield* writeFixtureFile(root, "skills/stray/SKILL.md", skillDocument("stray"));

          const problems = yield* problemsOf(buildSkillIndex(root));

          assert.strictEqual(problems.length, 1);
          assert.include(problems[0], "skills/stray/SKILL.md is not declared by any plugin");
          assert.include(problems[0], "plugins/<package>/skills/<id>/");
          assert.include(problems[0], "skills: in plugins/<package>/plugin.yaml");
        }),
      ),
    );

    it.effect("fails on a nested SKILL.md inside a declared skill directory", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const root = yield* makeRepository;
          yield* writeFixtureFile(
            root,
            "plugins/alpha/skills/one/nested/SKILL.md",
            skillDocument("nested"),
          );

          const problems = yield* problemsOf(buildSkillIndex(root));

          assert.include(problems[0], "plugins/alpha/skills/one/nested/SKILL.md is not declared");
        }),
      ),
    );

    it.effect("ignores .agents, node_modules, and dist", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const root = yield* makeRepository;
          for (const directory of [".agents/skills/x", "node_modules/pkg", "plugins/alpha/dist"]) {
            yield* writeFixtureFile(root, `${directory}/SKILL.md`, skillDocument("ignored"));
          }

          assert.strictEqual((yield* buildSkillIndex(root)).skills.length, 3);
        }),
      ),
    );

    it.effect("fails when a declared skill has no directory", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const root = yield* makeRepository;
          yield* writeFixtureFile(
            root,
            "plugins/alpha/plugin.yaml",
            pluginManifest("alpha", "gina", ["one", "two", "ghost"]),
          );

          const problems = yield* problemsOf(buildSkillIndex(root));

          assert.deepStrictEqual(problems, [
            "plugins/alpha/plugin.yaml lists ghost but plugins/alpha/skills/ghost/SKILL.md does not exist",
          ]);
        }),
      ),
    );

    it.effect(
      "fails when frontmatter name differs from the declared id or description is empty",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const root = yield* makeRepository;
            yield* writeFixtureFile(
              root,
              "plugins/alpha/skills/one/SKILL.md",
              skillDocument("uno"),
            );
            yield* writeFixtureFile(
              root,
              "plugins/alpha/skills/two/SKILL.md",
              "---\nname: two\n---\n\n# two\n",
            );

            const problems = yield* problemsOf(buildSkillIndex(root));

            assert.deepStrictEqual(problems, [
              "plugins/alpha/skills/one/SKILL.md declares name uno; expected one",
              "plugins/alpha/skills/two/SKILL.md must have a description in its frontmatter",
            ]);
          }),
        ),
    );

    it.effect("indexes the six skills of the two real plugin packages", () =>
      Effect.gen(function* () {
        const index = yield* buildSkillIndex(fileURLToPath(new URL("../../", import.meta.url)));

        assert.deepStrictEqual(
          index.skills.map((skill) => `${skill.mcpEndpoint}/${skill.package}/${skill.id}`),
          [
            "gina/ask-gina/research-hyperliquid",
            "gina/ask-gina/research-prediction-markets",
            "gina/ask-gina/research-spot-tokens",
            "gina/ask-gina/review-gina-account",
            "spot/ask-gina-spot/lp-pool-scan",
            "spot/ask-gina-spot/lp-rebalancing-playbook",
          ],
        );
        assert.deepStrictEqual(
          index.skills.filter((skill) => !skill.mcpServed).map((skill) => skill.id),
          ["lp-pool-scan"],
        );
      }),
    );

    it.effect("writes the index, then detects drift in --check mode", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const root = yield* makeRepository;

          const missing = yield* problemsOf(runSkillIndex({ root, check: true }));
          assert.include(missing[0], `${SKILL_INDEX_PATH} is out of date`);

          yield* runSkillIndex({ root, check: false });
          yield* runSkillIndex({ root, check: true });

          yield* writeFixtureFile(root, "plugins/alpha/skills/one/extra.md", "extra\n");
          const drifted = yield* problemsOf(runSkillIndex({ root, check: true }));
          assert.include(drifted[0], `${SKILL_INDEX_PATH} is out of date`);

          yield* runSkillIndex({ root, check: false });
          const written = yield* fs.readFileString(path.join(root, SKILL_INDEX_PATH));
          assert.include(written, "plugins/alpha/skills/one/extra.md");
        }),
      ),
    );
  });
});
