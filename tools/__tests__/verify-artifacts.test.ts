import * as BunServices from "@effect/platform-bun/BunServices";
import { assert, describe, it } from "@effect/vitest";
import { ChildProcess } from "effect/unstable/process";
import { Config, Effect, FileSystem, Path } from "effect";

import { findEmbeddedSourceMapBoundaryRules, inspectSourceMapText } from "../check-public-boundary";
import {
  runNodeEsmSmoke,
  snapshotArtifactInputs,
  verifyNoInstalledLibrarySources,
  verifyNode24Consumer,
} from "../verify-artifacts";

describe("artifact verification snapshots", () => {
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
  });
});
