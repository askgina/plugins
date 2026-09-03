import * as BunServices from "@effect/platform-bun/BunServices";
import { assert, describe, it } from "@effect/vitest";
import { ChildProcess } from "effect/unstable/process";
import { Data, Effect, FileSystem, Path, Schema } from "effect";

import {
  ArtifactPackError,
  buildArtifacts,
  stagePackage,
  stagePluginTarget,
  validateTargetVersion,
  verifyCompiledPackageOutput,
} from "../pack-artifacts";
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

const rejectCompiledContract = (root: string) =>
  verifyCompiledPackageOutput(root, root, "@askgina/contracts").pipe(Effect.flip);

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

describe("plugin target packing", () => {
  it.layer(BunServices.layer)((it) => {
    it.effect("validates OpenAI and Cursor at the root and other hosts in overlays", () =>
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
        }),
      ),
    );

    it.effect("stages a lean OpenAI target from root source surfaces", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const fixture = yield* makePluginFixture;

          yield* stagePluginTarget("openai", fixture.plugin, fixture.stage);

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

          yield* stagePluginTarget("cursor", fixture.plugin, fixture.stage);

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

    it.effect("retains remaining overlay staging without OpenAI skill metadata", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const fixture = yield* makePluginFixture;

          yield* stagePluginTarget("claude", fixture.plugin, fixture.stage);

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
