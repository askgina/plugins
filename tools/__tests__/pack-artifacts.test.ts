import * as BunServices from "@effect/platform-bun/BunServices";
import { assert, describe, it } from "@effect/vitest";
import { ChildProcess } from "effect/unstable/process";
import { Data, Effect, FileSystem, Path, Schema } from "effect";

import {
  ArtifactPackError,
  buildArtifacts,
  stagePackage,
  verifyCompiledPackageOutput,
} from "../pack-artifacts";
class TestCommandError extends Data.TaggedError("TestCommandError")<{
  readonly command: string;
  readonly exitCode: number;
}> {}

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
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
