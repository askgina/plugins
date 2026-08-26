import * as BunServices from "@effect/platform-bun/BunServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";

import { findTypeScriptJsSpecifiers } from "../check-typescript-imports";

describe("TypeScript import specifiers", () => {
  it.layer(BunServices.layer)((it) => {
    it.effect("rejects only relative .js specifiers that resolve to TypeScript", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const root = yield* fs.makeTempDirectoryScoped({ prefix: "typescript-import-test-" });
          const sourceRoot = path.join(root, "packages", "fixture", "src");
          yield* fs.makeDirectory(sourceRoot, { recursive: true });
          yield* fs.writeFileString(
            path.join(sourceRoot, "target.ts"),
            "export const value = 1;\n",
          );
          yield* fs.writeFileString(
            path.join(sourceRoot, "runtime.js"),
            "export const value = 1;\n",
          );
          yield* fs.writeFileString(
            path.join(sourceRoot, "source.ts"),
            [
              'import "./target.js";',
              'import "./runtime.js";',
              'import "./target";',
              'import "@modelcontextprotocol/sdk/client.js";',
              'import "https://example.com/module.js";',
              "",
            ].join("\n"),
          );

          assert.deepStrictEqual(yield* findTypeScriptJsSpecifiers(root), [
            {
              file: "packages/fixture/src/source.ts",
              line: 1,
              specifier: "./target.js",
            },
          ]);
        }),
      ),
    );
  });
});
