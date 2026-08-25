import * as BunServices from "@effect/platform-bun/BunServices";
import { assert, describe, it } from "@effect/vitest";
import { ChildProcess } from "effect/unstable/process";
import { Data, Effect, FileSystem, Path } from "effect";

import { ArtifactPackError, buildArtifacts } from "../pack-artifacts.js";
class TestCommandError extends Data.TaggedError("TestCommandError")<{
  readonly command: string;
  readonly exitCode: number;
}> {}

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
