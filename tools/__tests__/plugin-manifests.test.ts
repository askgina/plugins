import { fileURLToPath } from "node:url";

import * as BunServices from "@effect/platform-bun/BunServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";

import {
  generateAllManifests,
  generateMarketplaceFiles,
  generatePluginFiles,
  loadMarketplaceSource,
  loadPluginSource,
  PluginManifestError,
  renderJson,
  runPluginManifests,
} from "../plugin-manifests";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

describe("plugin manifests", () => {
  it("renders expanded objects and inline arrays that fit the print width", () => {
    assert.strictEqual(
      renderJson({ a: ["x", "y"], b: { c: [] }, d: [{ e: "f" }] }),
      [
        "{",
        '  "a": ["x", "y"],',
        '  "b": {',
        '    "c": []',
        "  },",
        '  "d": [',
        "    {",
        '      "e": "f"',
        "    }",
        "  ]",
        "}",
        "",
      ].join("\n"),
    );
    const long = Array.from({ length: 12 }, (_, index) => `keyword-number-${index}`);
    const rendered = renderJson({ keywords: long });
    assert.include(rendered, '  "keywords": [\n    "keyword-number-0",\n');
  });

  it.layer(BunServices.layer)((it) => {
    it.effect("reproduces every committed manifest byte for byte", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const files = yield* generateAllManifests(repositoryRoot);

        assert.strictEqual(Object.keys(files).length, 48);
        assert.include(Object.keys(files), "plugins/ask-gina-spot/.codex-plugin/plugin.json");
        assert.include(Object.keys(files), "plugins/ask-gina-perps/.codex-plugin/plugin.json");
        assert.include(
          Object.keys(files),
          "plugins/ask-gina-predictions/targets/claude/.claude-plugin/plugin.json",
        );
        assert.notInclude(
          Object.keys(files),
          "plugins/ask-gina-spot/targets/gemini/gemini-extension.json",
        );
        for (const [relative, content] of Object.entries(files)) {
          assert.strictEqual(
            yield* fs.readFileString(path.join(repositoryRoot, relative)),
            content,
            `${relative} drifted from plugin.yaml`,
          );
        }
      }),
    );

    it.effect("generates a target only when the plugin gives it a description", () =>
      Effect.gen(function* () {
        const source = yield* loadPluginSource(`${repositoryRoot}plugins/ask-gina`);
        const { devin, copilot, gemini, antigravity, ...required } = source.listing.descriptions;
        assert.isDefined(devin);
        assert.isDefined(copilot);
        assert.isDefined(gemini);
        assert.isDefined(antigravity);

        const files = generatePluginFiles({
          ...source,
          listing: { ...source.listing, descriptions: required },
        });

        assert.deepStrictEqual(Object.keys(files).sort(), [
          ".codex-plugin/plugin.json",
          ".cursor-plugin/plugin.json",
          ".mcp.json",
          "mcp.json",
          "targets/claude/.claude-plugin/plugin.json",
          "targets/claude/.mcp.json",
        ]);
      }),
    );

    it.effect("projects Antigravity metadata and limits starter prompts to three", () =>
      Effect.gen(function* () {
        const source = yield* loadPluginSource(`${repositoryRoot}plugins/ask-gina`);
        const listing = source.listing;
        const prompts = ["First prompt", "Second prompt", "Third prompt", "Omitted prompt"];
        const files = generatePluginFiles({
          ...source,
          listing: { ...listing, codex: { ...listing.codex, defaultPrompt: prompts } },
        });
        assert.strictEqual(
          files[".antigravity-plugin/plugin.json"],
          renderJson({
            $schema: "https://antigravity.google/schemas/v1/plugin.json",
            name: source.name,
            displayName: listing.displayName,
            description:
              listing.descriptions.antigravity ?? assert.fail("Missing Antigravity description"),
            version: listing.version,
            logo: listing.icon,
            suggestedPrompts: prompts.slice(0, 3),
            author: listing.author,
            homepage: listing.homepage,
            repository: listing.repository,
            license: listing.license,
            keywords: listing.keywords,
          }),
        );
        assert.strictEqual(
          files["mcp_config.json"],
          renderJson({
            mcpServers: { [listing.mcpServerName]: { url: source.mcp.url } },
          }),
        );
        assert.notEqual(source.version, listing.version);
      }),
    );

    it.effect("omits the skills path of a package that declares no skills", () =>
      Effect.gen(function* () {
        const source = yield* loadPluginSource(`${repositoryRoot}plugins/ask-gina-perps`);
        assert.deepStrictEqual(source.skills, []);

        const files = generatePluginFiles(source);
        for (const relative of [".codex-plugin/plugin.json", ".devin-plugin/plugin.json"]) {
          assert.notInclude(files[relative] ?? "", '"skills"', `${relative} names a skills path`);
        }

        const withSkill = generatePluginFiles({
          ...source,
          skills: [{ id: "example", mcpServed: false }],
        });
        assert.include(withSkill[".codex-plugin/plugin.json"] ?? "", '"skills": "./skills/"');
        assert.include(withSkill[".devin-plugin/plugin.json"] ?? "", '"skills": "skills"');

        const marketplace = generateMarketplaceFiles({
          marketplace: yield* loadMarketplaceSource(repositoryRoot),
          plugins: [source],
        });
        assert.notInclude(marketplace[".claude-plugin/marketplace.json"] ?? "", '"skills"');
      }),
    );

    it.effect("writes missing files and fails --check on drift", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const paths = yield* Path.Path;
          const root = yield* fs.makeTempDirectoryScoped({ prefix: "plugin-manifests-test-" });
          yield* fs.makeDirectory(paths.join(root, "plugins/ask-gina"), { recursive: true });
          for (const relative of ["marketplace.yaml", "plugins/ask-gina/plugin.yaml"]) {
            yield* fs.copyFile(paths.join(repositoryRoot, relative), paths.join(root, relative));
          }

          const missing = yield* runPluginManifests({ root, check: true }).pipe(Effect.flip);
          assert.instanceOf(missing, PluginManifestError);
          assert.include(missing.problems, ".claude-plugin/marketplace.json is out of date");

          yield* runPluginManifests({ root, check: false });
          yield* runPluginManifests({ root, check: true });

          const target = paths.join(root, "plugins/ask-gina/.codex-plugin/plugin.json");
          yield* fs.writeFileString(target, "{}\n");
          const drifted = yield* runPluginManifests({ root, check: true }).pipe(Effect.flip);
          assert.deepStrictEqual(drifted.problems, [
            "plugins/ask-gina/.codex-plugin/plugin.json is out of date",
            "Run bun run manifests:generate and commit the result.",
          ]);

          yield* runPluginManifests({ root, check: false });
          yield* runPluginManifests({ root, check: true });
        }),
      ),
    );
  });
});
