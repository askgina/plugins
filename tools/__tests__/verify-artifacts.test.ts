import * as BunServices from "@effect/platform-bun/BunServices";
import { assert, describe, it } from "@effect/vitest";
import { ChildProcess } from "effect/unstable/process";
import { Effect, FileSystem, Path } from "effect";

import { snapshotArtifactInputs } from "../verify-artifacts";

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
  });
});
