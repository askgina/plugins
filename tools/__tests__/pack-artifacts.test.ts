import { fileURLToPath } from "node:url";

import * as BunServices from "@effect/platform-bun/BunServices";
import { assert, describe, it } from "@effect/vitest";
import { ChildProcess } from "effect/unstable/process";
import { Data, Effect, FileSystem, Path, Schema } from "effect";

import {
  ArtifactPackError,
  buildArtifacts,
  loadArtifactPackages,
  packPluginPackage,
  skillArchiveFiles,
  stagePackage,
  stagePluginTarget,
  targetManifestVersion,
  validateTargetVersion,
  verifyCompiledPackageOutput,
} from "../pack-artifacts";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
class TestCommandError extends Data.TaggedError("TestCommandError")<{
  readonly command: string;
  readonly exitCode: number;
}> {}

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const SKILL_NAMES = [
  "research-hyperliquid",
  "research-prediction-markets",
  "research-spot-tokens",
  "review-gina-account",
] as const;
const OVERLAY_MANIFESTS = {
  claude: [".claude-plugin", "plugin.json"],
  copilot: ["plugin.json"],
  gemini: ["gemini-extension.json"],
} as const;

const makePluginFixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const temporary = yield* fs.makeTempDirectoryScoped({
    prefix: "pack-plugin-test-",
  });
  const plugin = path.join(temporary, "ask-gina");
  const stage = path.join(temporary, "stage");
  const version = "1.2.3";

  yield* fs.makeDirectory(path.join(plugin, ".codex-plugin"), { recursive: true });
  yield* fs.writeFileString(
    path.join(plugin, ".codex-plugin", "plugin.json"),
    `${encodeJson({ version, marker: "root-openai" })}\n`,
  );
  yield* fs.writeFileString(path.join(plugin, ".mcp.json"), '{"mcpServers":{}}\n');
  yield* fs.makeDirectory(path.join(plugin, ".devin-plugin"), { recursive: true });
  yield* fs.writeFileString(
    path.join(plugin, ".devin-plugin", "plugin.json"),
    `${encodeJson({ version, marker: "root-devin" })}\n`,
  );
  yield* fs.makeDirectory(path.join(plugin, ".cursor-plugin"), { recursive: true });
  yield* fs.writeFileString(
    path.join(plugin, ".cursor-plugin", "plugin.json"),
    `${encodeJson({ version, marker: "root-cursor" })}\n`,
  );
  yield* fs.writeFileString(path.join(plugin, "mcp.json"), '{"mcpServers":{}}\n');
  yield* fs.makeDirectory(path.join(plugin, "assets"), { recursive: true });
  yield* fs.writeFileString(path.join(plugin, "assets", "icon.svg"), "<svg/>\n");
  yield* fs.makeDirectory(path.join(plugin, "rules"), { recursive: true });
  yield* fs.writeFileString(
    path.join(plugin, "rules", "gina-read-only.mdc"),
    "alwaysApply: true\n",
  );
  yield* fs.makeDirectory(path.join(plugin, "commands"), { recursive: true });
  for (const skill of SKILL_NAMES) {
    yield* fs.writeFileString(path.join(plugin, "commands", `${skill}.md`), `# ${skill}\n`);
  }
  for (const skill of SKILL_NAMES) {
    const skillRoot = path.join(plugin, "skills", skill);
    yield* fs.makeDirectory(path.join(skillRoot, "agents"), { recursive: true });
    yield* fs.writeFileString(path.join(skillRoot, "SKILL.md"), `# ${skill}\n`);
    yield* fs.writeFileString(path.join(skillRoot, "agents", "openai.yaml"), `name: ${skill}\n`);
  }

  for (const [host, manifest] of Object.entries(OVERLAY_MANIFESTS)) {
    const overlay = path.join(plugin, "targets", host);
    const manifestPath = path.join(overlay, ...manifest);
    yield* fs.makeDirectory(path.dirname(manifestPath), { recursive: true });
    yield* fs.writeFileString(
      manifestPath,
      `${encodeJson({ version, marker: `${host}-overlay` })}\n`,
    );
    yield* fs.writeFileString(path.join(overlay, `${host}.txt`), `${host}\n`);
  }

  for (const relative of ["package.json", "plugin.yaml", "README.md", "LICENSE"] as const) {
    yield* fs.writeFileString(path.join(plugin, relative), `${relative}\n`);
  }
  for (const directory of ["src", "evals"] as const) {
    yield* fs.makeDirectory(path.join(plugin, directory), { recursive: true });
    yield* fs.writeFileString(path.join(plugin, directory, "foreign.txt"), `${directory}\n`);
  }

  return { plugin, stage, version };
});
const json = (value: unknown): string => `${encodeJson(value)}\n`;

const IndexFile = Schema.Struct({
  version: Schema.Finite,
  skills: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      package: Schema.String,
      path: Schema.String,
      files: Schema.Array(Schema.String),
    }),
  ),
});
const decodeIndex = Schema.decodeUnknownSync(Schema.fromJsonString(IndexFile));
const encodeIndex = Schema.encodeSync(Schema.fromJsonString(IndexFile));
type IndexSkills = (typeof IndexFile.Type)["skills"];

const SPOT_SKILL_FILES: Readonly<Record<string, readonly string[]>> = {
  "lp-pool-scan": ["README.md", "SKILL.md", "agents/openai.yaml", "scripts/scan.py"],
  "lp-rebalancing-playbook": ["SKILL.md", "agents/openai.yaml"],
};
const SPOT_SKILLS = Object.keys(SPOT_SKILL_FILES);

/** A plugin package like ask-gina-spot: no Cursor rules or commands, skills with extra files. */
const makeSpotPluginFixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const temporary = yield* fs.makeTempDirectoryScoped({ prefix: "pack-spot-plugin-test-" });
  const plugin = path.join(temporary, "ask-gina-spot");
  const stage = path.join(temporary, "stage");
  const files = [
    ".codex-plugin/plugin.json",
    ".cursor-plugin/plugin.json",
    ".devin-plugin/plugin.json",
    ".mcp.json",
    "mcp.json",
    "README.md",
    "assets/icon.svg",
    "targets/claude/.claude-plugin/plugin.json",
    "targets/claude/.mcp.json",
    "targets/copilot/plugin.json",
    "targets/copilot/mcp.json",
    ...Object.entries(SPOT_SKILL_FILES).flatMap(([skill, skillFiles]) =>
      skillFiles.map((file) => `skills/${skill}/${file}`),
    ),
  ];
  yield* Effect.forEach(files, (file) =>
    Effect.gen(function* () {
      const destination = path.join(plugin, file);
      yield* fs.makeDirectory(path.dirname(destination), { recursive: true });
      yield* fs.writeFileString(destination, `${file}\n`);
    }),
  );
  return { plugin, stage };
});

/** A temporary repository root holding the real plugin.yaml files and a mutated skills index. */
const indexFixture = (mutate: (skills: IndexSkills) => IndexSkills) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "pack-index-test-" });
    yield* Effect.forEach(["ask-gina", "ask-gina-spot"], (name) =>
      Effect.gen(function* () {
        yield* fs.makeDirectory(path.join(root, "plugins", name), { recursive: true });
        yield* fs.copy(
          path.join(repositoryRoot, "plugins", name, "plugin.yaml"),
          path.join(root, "plugins", name, "plugin.yaml"),
        );
      }),
    );
    const index = decodeIndex(
      yield* fs.readFileString(path.join(repositoryRoot, "skills", "index.json")),
    );
    yield* fs.makeDirectory(path.join(root, "skills"), { recursive: true });
    yield* fs.writeFileString(
      path.join(root, "skills", "index.json"),
      encodeIndex({ ...index, skills: mutate(index.skills) }),
    );
    return root;
  });

const SOURCE_DIRECTORIES = [
  "packages/contracts",
  "packages/sdk",
  "packages/cli",
  "plugins/ask-gina",
  "packages/evals",
] as const;

const run = (command: string, args: readonly string[], cwd: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const child = yield* ChildProcess.make(command, args, {
        cwd,
        env: {
          PATH: "/usr/bin:/bin",
          HOME: "/nonexistent",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
          LC_ALL: "C",
        },
        extendEnv: false,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      });
      const exitCode = yield* child.exitCode;
      if (exitCode !== 0) return yield* new TestCommandError({ command, exitCode });
    }),
  );

const repositoryFixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const temporary = yield* fs.makeTempDirectoryScoped({ prefix: "pack-artifacts-test-" });
  const root = path.join(temporary, "source");
  const dist = path.join(temporary, "dist");
  const impact = path.join(temporary, "impact-marker");
  yield* Effect.forEach(SOURCE_DIRECTORIES, (directory) =>
    fs.makeDirectory(path.join(root, directory), { recursive: true }),
  );
  yield* Effect.forEach(SOURCE_DIRECTORIES, (directory) =>
    fs.writeFileString(path.join(root, directory, ".snapshot"), `${directory}\n`),
  );
  yield* fs.writeFileString(path.join(root, "packages/cli/bin.ts"), "export {};\n");
  yield* run("git", ["init", "--quiet"], root);
  yield* run("git", ["add", "--all"], root);
  yield* run(
    "git",
    [
      "-c",
      "user.name=Artifact Test",
      "-c",
      "user.email=artifact-test@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "fixture",
    ],
    root,
  );
  return { root, dist, impact };
});
const compiledContractFixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "compiled-contract-test-" });
  const packageRoot = path.join(root, "packages/contracts");
  const dist = path.join(packageRoot, "dist");
  const source = "export const value = 1;\n";
  yield* fs.makeDirectory(path.join(packageRoot, "src"), { recursive: true });
  yield* fs.makeDirectory(dist, { recursive: true });
  yield* fs.writeFileString(
    path.join(packageRoot, "package.json"),
    json({ name: "@askgina/contracts", version: "0.1.0", files: ["dist", "LICENSE", "README.md"] }),
  );
  yield* fs.writeFileString(path.join(packageRoot, "LICENSE"), "fixture license\n");
  yield* fs.writeFileString(path.join(packageRoot, "README.md"), "fixture readme\n");
  yield* fs.writeFileString(path.join(packageRoot, "src/index.ts"), source);
  yield* fs.writeFileString(
    path.join(dist, "index.js"),
    "const value = 1;\n//# sourceMappingURL=index.js.map\n",
  );
  yield* fs.writeFileString(path.join(dist, "index.d.ts"), "declare const value = 1;\n");
  const writeMap = (value: unknown) =>
    fs.writeFileString(path.join(dist, "index.js.map"), json(value));
  yield* writeMap({
    version: 3,
    sources: ["../src/index.ts"],
    sourcesContent: [source],
    names: [],
    mappings: "",
  });
  return { root, packageRoot, dist, source, writeMap };
});

const EVALS_MAPPED_JS_FILES = [
  "bin/check-codex-marketplace.js",
  "bin/export-public-results.js",
  "bin/execution.js",
  "bin/live.js",
  "bin/replay.js",
  "canonical-json-x.js",
  "codex-cli-x.js",
  "omp-harness-x.js",
  "publication-x.js",
  "replay-x.js",
  "report-x.js",
  "runner-x.js",
  "sanitize-x.js",
  "trial-journal-x.js",
] as const;
const EVALS_MAPPED_CHUNK = "runner-x.js";

const compiledEvalsFixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "compiled-evals-test-" });
  const packageRoot = path.join(root, "packages/evals");
  const dist = path.join(packageRoot, "dist");
  const source = "export const value = 1;\n";
  yield* fs.makeDirectory(path.join(packageRoot, "src"), { recursive: true });
  yield* fs.makeDirectory(path.join(dist, "bin"), { recursive: true });
  yield* fs.writeFileString(
    path.join(packageRoot, "package.json"),
    json({
      name: "@askgina/evals",
      version: "0.1.0",
      files: ["dist", "LICENSE", "README.md"],
    }),
  );
  yield* fs.writeFileString(path.join(packageRoot, "LICENSE"), "fixture license\n");
  yield* fs.writeFileString(path.join(packageRoot, "README.md"), "fixture readme\n");
  yield* fs.writeFileString(path.join(packageRoot, "src/index.ts"), source);
  yield* fs.writeFileString(path.join(dist, "bin/check-codex-marketplace.d.ts"), "export {};\n");
  yield* fs.writeFileString(path.join(dist, "bin/export-public-results.d.ts"), "export {};\n");
  yield* fs.writeFileString(path.join(dist, "bin/execution.d.ts"), "export {};\n");
  yield* fs.writeFileString(path.join(dist, "bin/live.d.ts"), "export {};\n");
  yield* fs.writeFileString(path.join(dist, "bin/replay.d.ts"), "export {};\n");
  yield* fs.writeFileString(path.join(dist, "index.d.ts"), "export {};\n");
  yield* fs.writeFileString(path.join(dist, "omp-harness-x.d.ts"), "export {};\n");
  yield* fs.writeFileString(
    path.join(dist, "index.js"),
    `export * from "./${EVALS_MAPPED_CHUNK}";\n`,
  );
  const writeChunkMap = (value: unknown) =>
    fs.writeFileString(path.join(dist, `${EVALS_MAPPED_CHUNK}.map`), json(value));
  yield* Effect.forEach(EVALS_MAPPED_JS_FILES, (file) =>
    Effect.gen(function* () {
      yield* fs.writeFileString(
        path.join(dist, file),
        `export {};\n//# sourceMappingURL=${path.basename(file)}.map\n`,
      );
      yield* fs.writeFileString(
        path.join(dist, `${file}.map`),
        json({
          version: 3,
          sources: [file.startsWith("bin/") ? "../../src/index.ts" : "../src/index.ts"],
          sourcesContent: [source],
          names: [],
          mappings: "",
        }),
      );
    }),
  );
  return {
    root,
    packageRoot,
    dist,
    source,
    writeChunkMap,
  };
});

const rejectCompiledContract = (root: string) =>
  verifyCompiledPackageOutput(root, root, "@askgina/contracts").pipe(Effect.flip);

const rejectCompiledEvals = (root: string) =>
  verifyCompiledPackageOutput(root, root, "@askgina/evals").pipe(Effect.flip);

const assertRejectedBeforeImpact = (root: string, dist: string, impact: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const error = yield* buildArtifacts({ root, dist }).pipe(Effect.flip);
    assert.instanceOf(error, ArtifactPackError);
    assert.isFalse(yield* fs.exists(dist));
    assert.isFalse(yield* fs.exists(impact));
    return error;
  });

describe("pack artifact source snapshot", () => {
  it.layer(BunServices.layer)((it) => {
    it.effect("accepts compiled output with matching embedded TypeScript", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const fixture = yield* compiledContractFixture;
          const result = yield* verifyCompiledPackageOutput(
            fixture.root,
            fixture.root,
            "@askgina/contracts",
          );
          assert.deepStrictEqual(result.files, ["index.d.ts", "index.js", "index.js.map"]);
          const staged = yield* stagePackage(
            fixture.root,
            fixture.root,
            "@askgina/contracts",
            path.join(fixture.root, "stage"),
            "0.1.0",
          );
          assert.isTrue(staged.some((proof) => proof.path === "package/dist/index.js"));
        }),
      ),
    );

    it.effect("accepts compiled evals output with matching embedded TypeScript", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const fixture = yield* compiledEvalsFixture;
          const result = yield* verifyCompiledPackageOutput(
            fixture.root,
            fixture.root,
            "@askgina/evals",
          );
          assert.isTrue(result.files.includes("index.js"));
          assert.isFalse(result.files.includes("index.js.map"));
          assert.isTrue(result.files.includes(`${EVALS_MAPPED_CHUNK}.map`));
          const staged = yield* stagePackage(
            fixture.root,
            fixture.root,
            "@askgina/evals",
            path.join(fixture.root, "stage"),
            "0.1.0",
          );
          assert.isTrue(staged.some((proof) => proof.path === "package/dist/index.js"));
          assert.isTrue(
            staged.some((proof) => proof.path === `package/dist/${EVALS_MAPPED_CHUNK}.map`),
          );
        }),
      ),
    );

    it.effect("rejects evals source maps that escape the package or go stale", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const fixture = yield* compiledEvalsFixture;
          yield* fixture.writeChunkMap({
            version: 3,
            sources: ["../src/index.ts"],
            sourcesContent: ["export const tampered = 1;\n"],
            names: [],
            mappings: "",
          });
          const tampered = yield* rejectCompiledEvals(fixture.root);
          assert.include(tampered.message, "content is stale");

          yield* fs.makeDirectory(
            path.join(fixture.packageRoot, "node_modules/unrelated-dep/src"),
            { recursive: true },
          );
          yield* fs.writeFileString(
            path.join(fixture.packageRoot, "node_modules/unrelated-dep/src/index.ts"),
            "export const unrelated = 1;\n",
          );
          yield* fixture.writeChunkMap({
            version: 3,
            sources: ["../node_modules/unrelated-dep/src/index.ts"],
            sourcesContent: ["export const unrelated = 1;\n"],
            names: [],
            mappings: "",
          });
          const unrelated = yield* rejectCompiledEvals(fixture.root);
          assert.include(unrelated.message, "escapes its package");

          const outside = path.join(fixture.root, "outside.ts");
          yield* fs.writeFileString(outside, "export const leaked = 1;\n");
          yield* fixture.writeChunkMap({
            version: 3,
            sources: ["../../../outside.ts"],
            sourcesContent: ["export const leaked = 1;\n"],
            names: [],
            mappings: "",
          });
          const escaped = yield* rejectCompiledEvals(fixture.root);
          assert.include(escaped.message, "escapes its package");
        }),
      ),
    );

    it.effect("rejects modified ignored executable bytes before staging", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const fixture = yield* compiledContractFixture;
          const committedRoot = yield* fs.makeTempDirectoryScoped({
            prefix: "committed-contract-test-",
          });
          const committedPackageRoot = path.join(committedRoot, "packages/contracts");
          yield* fs.makeDirectory(path.dirname(committedPackageRoot), { recursive: true });
          yield* fs.copy(fixture.packageRoot, committedPackageRoot, { overwrite: true });
          yield* fs.writeFileString(
            path.join(fixture.dist, "index.js"),
            "globalThis.compromised = true;\n//# sourceMappingURL=index.js.map\n",
          );
          const stage = path.join(fixture.root, "stage");
          const error = yield* stagePackage(
            fixture.root,
            committedRoot,
            "@askgina/contracts",
            stage,
            "0.1.0",
          ).pipe(Effect.flip);
          assert.instanceOf(error, ArtifactPackError);
          assert.include(error.message, "compiled output differs from source commit build");
          assert.isFalse(yield* fs.exists(stage));
        }),
      ),
    );

    it.effect("rejects missing and stale embedded source content", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fixture = yield* compiledContractFixture;
          yield* fixture.writeMap({ version: 3, sources: ["../src/index.ts"] });
          const missing = yield* rejectCompiledContract(fixture.root);
          assert.include(missing.message, "sourcesContent must match sources");

          yield* fixture.writeMap({
            version: 3,
            sources: ["../src/index.ts"],
            sourcesContent: ["export const value = 2;\n"],
          });
          const stale = yield* rejectCompiledContract(fixture.root);
          assert.include(stale.message, "content is stale");
        }),
      ),
    );

    it.effect("rejects absolute host paths in source maps", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fixture = yield* compiledContractFixture;
          yield* fixture.writeMap({
            version: 3,
            sources: ["/home/private/checkout/src/index.ts"],
            sourcesContent: [fixture.source],
          });
          const error = yield* rejectCompiledContract(fixture.root);
          assert.include(error.message, "unsafe source path");
        }),
      ),
    );

    it.effect("rejects raw-source allowlists and unexpected compiled files", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const fixture = yield* compiledContractFixture;
          yield* fs.writeFileString(
            path.join(fixture.packageRoot, "package.json"),
            json({ files: ["dist", "src", "LICENSE", "README.md"] }),
          );
          const rawSource = yield* rejectCompiledContract(fixture.root);
          assert.include(rawSource.message, "package files are inconsistent");

          yield* fs.writeFileString(
            path.join(fixture.packageRoot, "package.json"),
            json({ files: ["dist", "LICENSE", "README.md"] }),
          );
          yield* fs.writeFileString(path.join(fixture.dist, "unexpected.js"), "export {};\n");
          const unexpected = yield* rejectCompiledContract(fixture.root);
          assert.include(unexpected.message, "unexpected compiled output");
        }),
      ),
    );

    it.effect("rejects missing compiled files", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const fixture = yield* compiledContractFixture;
          yield* fs.remove(path.join(fixture.dist, "index.js"));
          const error = yield* rejectCompiledContract(fixture.root);
          assert.include(error.message, "compiled output is missing or ambiguous");
        }),
      ),
    );

    it.effect("rejects a declaration reference to an omitted map", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const fixture = yield* compiledContractFixture;
          yield* fs.writeFileString(
            path.join(fixture.dist, "index.d.ts"),
            "declare const value = 1;\n//# sourceMappingURL=index.d.ts.map\n",
          );
          const error = yield* rejectCompiledContract(fixture.root);
          assert.include(error.message, "compiled declaration references a missing source map");
        }),
      ),
    );

    it.effect("rejects a package wrapper symlink before archive output", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const fixture = yield* repositoryFixture;
          const wrapper = path.join(fixture.root, "packages/cli/bin.ts");
          yield* fs.remove(wrapper);
          yield* fs.symlink(".snapshot", wrapper);

          const error = yield* assertRejectedBeforeImpact(
            fixture.root,
            fixture.dist,
            fixture.impact,
          );
          assert.include(error.message, "symbolic link");
          assert.include(error.message, "packages/cli/bin.ts");
        }),
      ),
    );

    it.effect("rejects an ignored executable descendant before archive output or impact", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const fixture = yield* repositoryFixture;
          const relative = "plugins/ask-gina/ignored-wrapper";
          yield* fs.makeDirectory(
            path.join(fixture.root, "packages/contracts/node_modules/synthetic-dependency"),
            { recursive: true },
          );
          yield* fs.writeFileString(
            path.join(
              fixture.root,
              "packages/contracts/node_modules/synthetic-dependency/index.js",
            ),
            "export {};\n",
          );
          const executable = path.join(fixture.root, relative);
          yield* fs.writeFileString(executable, `#!/bin/sh\ntouch '${fixture.impact}'\n`);
          yield* fs.chmod(executable, 0o755);
          yield* fs.writeFileString(path.join(fixture.root, ".git/info/exclude"), `${relative}\n`);

          const error = yield* assertRejectedBeforeImpact(
            fixture.root,
            fixture.dist,
            fixture.impact,
          );
          assert.include(error.message, "absent from source commit");
          assert.include(error.message, relative);
        }),
      ),
    );
  });
});

describe("plugin package data", () => {
  it.layer(BunServices.layer)((it) => {
    it.effect("loads every plugin package with its hosts, skills and assets", () =>
      Effect.gen(function* () {
        const packages = yield* loadArtifactPackages({ root: repositoryRoot });
        assert.deepStrictEqual(
          packages.map(({ name }) => name),
          ["ask-gina", "ask-gina-perps", "ask-gina-predictions", "ask-gina-spot"],
        );
        const [gina, perps, predictions, spot] = packages;
        for (const venue of [perps, predictions]) {
          assert.deepStrictEqual(venue?.hosts, ["openai", "cursor", "claude", "copilot", "devin"]);
          assert.deepStrictEqual(venue?.skills, []);
          assert.deepStrictEqual(venue?.openAiAssets, ["icon.svg"]);
        }
        assert.deepStrictEqual(gina?.hosts, [
          "openai",
          "cursor",
          "claude",
          "copilot",
          "gemini",
          "devin",
        ]);
        assert.deepStrictEqual(spot?.hosts, ["openai", "cursor", "claude", "copilot", "devin"]);
        assert.deepStrictEqual(
          gina?.skills.map(({ id }) => id),
          [...SKILL_NAMES],
        );
        for (const skill of gina?.skills ?? []) {
          assert.deepStrictEqual(skill.files, ["SKILL.md", "agents/openai.yaml"]);
        }
        assert.deepStrictEqual(gina?.openAiAssets, [
          "gold-up-or-down-daily.png",
          "hyperliquid-chart.png",
          "icon.svg",
          "nba-champion-podium.png",
          "perpetual-positions.png",
          "premier-league-prediction-markets.png",
        ]);
        assert.deepStrictEqual(spot?.openAiAssets, ["icon.svg"]);
        assert.deepStrictEqual(
          spot?.skills.map(({ id }) => id),
          ["lp-pool-scan", "lp-rebalancing-playbook"],
        );
        const scan = spot?.skills.find(({ id }) => id === "lp-pool-scan");
        assert.isTrue(scan?.files.includes("SKILL.md"));
        assert.isAbove(
          skillArchiveFiles({ skill: scan ?? { id: "", files: [] }, overlay: false }).length,
          1,
          "lp-pool-scan ships files beyond SKILL.md",
        );
      }),
    );

    it.effect("takes the manifest version from each package's own plugin.yaml", () =>
      Effect.gen(function* () {
        const packages = yield* loadArtifactPackages({ root: repositoryRoot });
        for (const { source, hosts } of packages) {
          for (const host of hosts) {
            assert.strictEqual(
              targetManifestVersion({ source, host }),
              host === "openai" || host === "cursor" ? source.listing.version : source.version,
            );
          }
        }
      }),
    );

    it.effect("validates the generated ask-gina-spot manifests", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const packages = yield* loadArtifactPackages({ root: repositoryRoot });
        const spot = packages.find(({ name }) => name === "ask-gina-spot");
        assert.isDefined(spot);
        if (spot === undefined) return;
        const root = path.join(repositoryRoot, spot.directory);
        for (const host of spot.hosts) {
          yield* validateTargetVersion(
            root,
            host,
            targetManifestVersion({ source: spot.source, host }),
          );
        }
        const error = yield* validateTargetVersion(root, "claude", "9.9.9").pipe(Effect.flip);
        assert.instanceOf(error, ArtifactPackError);
        assert.include(error.message, "claude target version is inconsistent");
      }),
    );

    it.effect("fails when the skills index omits a declared skill", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const root = yield* indexFixture((skills) =>
            skills.filter(({ id }) => id !== "lp-pool-scan"),
          );
          const error = yield* loadArtifactPackages({ root }).pipe(Effect.flip);
          assert.instanceOf(error, ArtifactPackError);
          assert.include(
            error.message,
            "does not list exactly the skills declared by plugins/ask-gina-spot",
          );
        }),
      ),
    );

    it.effect("fails when the skills index credits a skill to another package", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const root = yield* indexFixture((skills) =>
            skills.map((skill) =>
              skill.id === "lp-pool-scan" ? { ...skill, package: "ask-gina" } : skill,
            ),
          );
          const error = yield* loadArtifactPackages({ root }).pipe(Effect.flip);
          assert.include(error.message, "does not list exactly the skills declared by");
        }),
      ),
    );

    it.effect("fails when an indexed file leaves its skill directory or SKILL.md is absent", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const outside = yield* indexFixture((skills) =>
            skills.map((skill) =>
              skill.id === "lp-pool-scan"
                ? { ...skill, files: [...skill.files, "plugins/ask-gina/README.md"] }
                : skill,
            ),
          );
          assert.include(
            (yield* loadArtifactPackages({ root: outside }).pipe(Effect.flip)).message,
            "lists unusable files for ask-gina-spot:lp-pool-scan",
          );
          const noSkillFile = yield* indexFixture((skills) =>
            skills.map((skill) =>
              skill.id === "lp-pool-scan"
                ? { ...skill, files: skill.files.filter((file) => !file.endsWith("/SKILL.md")) }
                : skill,
            ),
          );
          assert.include(
            (yield* loadArtifactPackages({ root: noSkillFile }).pipe(Effect.flip)).message,
            "lists unusable files for ask-gina-spot:lp-pool-scan",
          );
          const wrongPath = yield* indexFixture((skills) =>
            skills.map((skill) =>
              skill.id === "lp-pool-scan"
                ? { ...skill, path: "plugins/ask-gina/skills/lp-pool-scan" }
                : skill,
            ),
          );
          assert.include(
            (yield* loadArtifactPackages({ root: wrongPath }).pipe(Effect.flip)).message,
            "has a wrong path for ask-gina-spot:lp-pool-scan",
          );
        }),
      ),
    );

    it.effect("stages every spot skill file, with the overlay only in the OpenAI archive", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const files = (stage: string, skill: string) =>
            fs
              .readDirectory(path.join(stage, "skills", skill), { recursive: true })
              .pipe(Effect.map((entries) => entries.sort()));
          const openai = yield* makeSpotPluginFixture;
          yield* stagePluginTarget("openai", openai.plugin, openai.stage, SPOT_SKILLS);
          assert.deepStrictEqual(
            (yield* files(openai.stage, "lp-pool-scan")).filter((entry) => entry.includes(".")),
            ["README.md", "SKILL.md", "agents/openai.yaml", "scripts/scan.py"],
          );
          const claude = yield* makeSpotPluginFixture;
          yield* stagePluginTarget("claude", claude.plugin, claude.stage, SPOT_SKILLS);
          assert.deepStrictEqual(
            (yield* files(claude.stage, "lp-pool-scan")).filter((entry) => entry.includes(".")),
            ["README.md", "SKILL.md", "scripts/scan.py"],
          );
          assert.isFalse(
            yield* fs.exists(
              path.join(claude.stage, "skills", "lp-rebalancing-playbook", "agents"),
            ),
          );
        }),
      ),
    );

    it.effect("stages a Cursor target without rules and commands when the package has none", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const fixture = yield* makeSpotPluginFixture;
          yield* stagePluginTarget("cursor", fixture.plugin, fixture.stage, SPOT_SKILLS);
          assert.deepStrictEqual((yield* fs.readDirectory(fixture.stage)).sort(), [
            ".cursor-plugin",
            "README.md",
            "assets",
            "mcp.json",
            "skills",
          ]);
        }),
      ),
    );

    it.effect("packs ask-gina-spot into package-named archives with package receipts", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const packages = yield* loadArtifactPackages({ root: repositoryRoot });
          const spot = packages.find(({ name }) => name === "ask-gina-spot");
          assert.isDefined(spot);
          if (spot === undefined) return;
          const temporary = yield* fs.makeTempDirectoryScoped({ prefix: "pack-spot-test-" });
          const dist = path.join(temporary, "dist");
          const stages = path.join(temporary, "stages");
          yield* Effect.forEach(
            [path.join(dist, "targets"), path.join(dist, "skills"), stages],
            (directory) => fs.makeDirectory(directory, { recursive: true }),
          );
          const version = spot.source.version;
          const packed = yield* packPluginPackage({
            root: repositoryRoot,
            source: repositoryRoot,
            dist,
            temporary: stages,
            plugin: spot,
            version,
          });
          const archives = spot.hosts.map((host) => `ask-gina-spot-${host}-${version}.tgz`);
          assert.deepStrictEqual(
            (yield* fs.readDirectory(path.join(dist, "targets"))).sort(),
            [...archives].sort(),
          );
          assert.deepStrictEqual(yield* fs.readDirectory(path.join(dist, "skills")), [
            `ask-gina-spot-skills-${version}.tgz`,
          ]);
          assert.deepStrictEqual(
            packed.targets.map(({ package: name, host, archive }) => ({ name, host, archive })),
            spot.hosts.map((host) => ({
              name: "ask-gina-spot",
              host,
              archive: `targets/ask-gina-spot-${host}-${version}.tgz`,
            })),
          );
          const { candidate } = packed;
          assert.isDefined(candidate);
          if (candidate === undefined) return;
          assert.strictEqual(candidate.package, "ask-gina-spot");
          assert.strictEqual(candidate.archive, `skills/ask-gina-spot-skills-${version}.tgz`);
          for (const target of packed.targets) {
            assert.isTrue(target.conformance.passed);
            assert.strictEqual(target.skillSourceSha, candidate.skillSourceSha);
            const overlays = target.files.filter(({ path: file }) =>
              file.endsWith("/agents/openai.yaml"),
            );
            assert.strictEqual(overlays.length, target.host === "openai" ? spot.skills.length : 0);
            assert.isTrue(
              target.files.some(({ path: file }) => file === "skills/lp-pool-scan/SKILL.md"),
            );
          }
          assert.isFalse(
            candidate.files.some(
              ({ path: file }) => file.includes("/agents/") || file.startsWith("agents/"),
            ),
          );
        }),
      ),
    );
  });
});

describe("plugin target packing", () => {
  it.layer(BunServices.layer)((it) => {
    it.effect("validates root-sourced and overlay-sourced target versions", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const fixture = yield* makePluginFixture;
          const legacyOpenAiManifest = path.join(
            fixture.plugin,
            "targets",
            "openai",
            ".codex-plugin",
            "plugin.json",
          );
          const legacyCursorManifest = path.join(
            fixture.plugin,
            "targets",
            "cursor",
            ".cursor-plugin",
            "plugin.json",
          );
          yield* fs.makeDirectory(path.dirname(legacyOpenAiManifest), { recursive: true });
          yield* fs.writeFileString(legacyOpenAiManifest, `${encodeJson({ version: "9.9.9" })}\n`);
          yield* fs.makeDirectory(path.dirname(legacyCursorManifest), { recursive: true });
          yield* fs.writeFileString(legacyCursorManifest, `${encodeJson({ version: "9.9.9" })}\n`);

          yield* validateTargetVersion(fixture.plugin, "openai", fixture.version);
          yield* validateTargetVersion(fixture.plugin, "cursor", fixture.version);
          yield* validateTargetVersion(fixture.plugin, "devin", fixture.version);
          yield* fs.writeFileString(
            path.join(fixture.plugin, ".codex-plugin", "plugin.json"),
            `${encodeJson({ version: "8.8.8" })}\n`,
          );
          yield* validateTargetVersion(fixture.plugin, "cursor", fixture.version);
          yield* validateTargetVersion(fixture.plugin, "claude", fixture.version);

          yield* fs.remove(path.join(fixture.plugin, ".codex-plugin", "plugin.json"));
          const error = yield* validateTargetVersion(fixture.plugin, "openai", "9.9.9").pipe(
            Effect.flip,
          );
          assert.instanceOf(error, ArtifactPackError);
          assert.include(error.message, path.join(".codex-plugin", "plugin.json"));

          yield* fs.remove(path.join(fixture.plugin, ".cursor-plugin", "plugin.json"));
          const cursorError = yield* validateTargetVersion(fixture.plugin, "cursor", "9.9.9").pipe(
            Effect.flip,
          );
          assert.instanceOf(cursorError, ArtifactPackError);
          assert.include(cursorError.message, path.join(".cursor-plugin", "plugin.json"));

          yield* fs.remove(path.join(fixture.plugin, ".devin-plugin", "plugin.json"));
          const devinError = yield* validateTargetVersion(fixture.plugin, "devin", "9.9.9").pipe(
            Effect.flip,
          );
          assert.instanceOf(devinError, ArtifactPackError);
          assert.include(devinError.message, path.join(".devin-plugin", "plugin.json"));
        }),
      ),
    );

    it.effect("stages a lean OpenAI target from root source surfaces", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const fixture = yield* makePluginFixture;

          yield* stagePluginTarget("openai", fixture.plugin, fixture.stage, SKILL_NAMES);

          assert.deepStrictEqual((yield* fs.readDirectory(fixture.stage)).sort(), [
            ".codex-plugin",
            ".mcp.json",
            "assets",
            "skills",
          ]);
          for (const relative of [
            [".codex-plugin", "plugin.json"],
            [".mcp.json"],
            ["assets", "icon.svg"],
          ] as const) {
            assert.strictEqual(
              yield* fs.readFileString(path.join(fixture.stage, ...relative)),
              yield* fs.readFileString(path.join(fixture.plugin, ...relative)),
            );
          }
          for (const excluded of [
            "package.json",
            "plugin.yaml",
            "README.md",
            "LICENSE",
            "src",
            "evals",
            "targets",
          ]) {
            assert.isFalse(yield* fs.exists(path.join(fixture.stage, excluded)));
          }
          for (const skill of SKILL_NAMES) {
            assert.isTrue(
              yield* fs.exists(path.join(fixture.stage, "skills", skill, "agents", "openai.yaml")),
            );
          }
        }),
      ),
    );

    it.effect("stages a lean Cursor target from root source surfaces", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const fixture = yield* makePluginFixture;

          yield* stagePluginTarget("cursor", fixture.plugin, fixture.stage, SKILL_NAMES);

          assert.deepStrictEqual((yield* fs.readDirectory(fixture.stage)).sort(), [
            ".cursor-plugin",
            "README.md",
            "assets",
            "commands",
            "mcp.json",
            "rules",
            "skills",
          ]);
          for (const relative of [
            [".cursor-plugin", "plugin.json"],
            ["mcp.json"],
            ["assets", "icon.svg"],
            ["README.md"],
            ["rules", "gina-read-only.mdc"],
            ["commands", "review-gina-account.md"],
          ] as const) {
            assert.strictEqual(
              yield* fs.readFileString(path.join(fixture.stage, ...relative)),
              yield* fs.readFileString(path.join(fixture.plugin, ...relative)),
            );
          }
          for (const excluded of [
            "package.json",
            "plugin.yaml",
            "LICENSE",
            "src",
            "evals",
            "targets",
          ]) {
            assert.isFalse(yield* fs.exists(path.join(fixture.stage, excluded)));
          }
          for (const skill of SKILL_NAMES) {
            assert.isTrue(yield* fs.exists(path.join(fixture.stage, "skills", skill, "SKILL.md")));
            assert.isFalse(yield* fs.exists(path.join(fixture.stage, "skills", skill, "agents")));
          }
        }),
      ),
    );

    it.effect("stages a lean Devin target from root source files", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const fixture = yield* makePluginFixture;

          yield* stagePluginTarget("devin", fixture.plugin, fixture.stage, SKILL_NAMES);

          assert.deepStrictEqual((yield* fs.readDirectory(fixture.stage)).sort(), [
            ".devin-plugin",
            ".mcp.json",
            "assets",
            "skills",
          ]);
          assert.deepStrictEqual(yield* fs.readDirectory(path.join(fixture.stage, "assets")), [
            "icon.svg",
          ]);
          for (const relative of [
            [".devin-plugin", "plugin.json"],
            [".mcp.json"],
            ["assets", "icon.svg"],
          ] as const) {
            assert.strictEqual(
              yield* fs.readFileString(path.join(fixture.stage, ...relative)),
              yield* fs.readFileString(path.join(fixture.plugin, ...relative)),
            );
          }
          for (const skill of SKILL_NAMES) {
            assert.isTrue(yield* fs.exists(path.join(fixture.stage, "skills", skill, "SKILL.md")));
            assert.isFalse(yield* fs.exists(path.join(fixture.stage, "skills", skill, "agents")));
          }
        }),
      ),
    );

    it.effect("retains remaining overlay staging without OpenAI skill metadata", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const fixture = yield* makePluginFixture;

          yield* stagePluginTarget("claude", fixture.plugin, fixture.stage, SKILL_NAMES);

          assert.deepStrictEqual((yield* fs.readDirectory(fixture.stage)).sort(), [
            ".claude-plugin",
            "claude.txt",
            "skills",
          ]);
          for (const relative of [[".claude-plugin", "plugin.json"], ["claude.txt"]] as const) {
            assert.strictEqual(
              yield* fs.readFileString(path.join(fixture.stage, ...relative)),
              yield* fs.readFileString(path.join(fixture.plugin, "targets", "claude", ...relative)),
            );
          }
          for (const skill of SKILL_NAMES) {
            assert.isTrue(yield* fs.exists(path.join(fixture.stage, "skills", skill, "SKILL.md")));
            assert.isFalse(yield* fs.exists(path.join(fixture.stage, "skills", skill, "agents")));
          }
        }),
      ),
    );
  });
});
