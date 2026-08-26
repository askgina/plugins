#!/usr/bin/env bun

import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Console, Data, Effect, FileSystem, Layer, Path } from "effect";

export interface TypeScriptJsSpecifierFinding {
  readonly file: string;
  readonly line: number;
  readonly specifier: string;
}

export class TypeScriptImportCheckError extends Data.TaggedError("TypeScriptImportCheckError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}
const fail = (message: string, cause?: unknown): TypeScriptImportCheckError =>
  new TypeScriptImportCheckError(cause === undefined ? { message } : { message, cause });

const listTypeScriptFiles = (root: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const visit = (
      directory: string,
      prefix: string,
    ): Effect.Effect<readonly string[], TypeScriptImportCheckError> =>
      Effect.gen(function* () {
        const names = yield* fs
          .readDirectory(directory)
          .pipe(Effect.mapError((cause) => fail(`cannot list ${directory}`, cause)));
        const nested = yield* Effect.forEach(names.sort(), (name) =>
          Effect.gen(function* () {
            if (name === "node_modules" || name === "dist") return [];
            const absolute = path.join(directory, name);
            const relative = prefix.length > 0 ? `${prefix}/${name}` : name;
            const info = yield* fs
              .stat(absolute)
              .pipe(Effect.mapError((cause) => fail(`cannot inspect ${absolute}`, cause)));
            if (info.type === "Directory") return yield* visit(absolute, relative);
            return info.type === "File" && name.endsWith(".ts") ? [relative] : [];
          }),
        );
        return nested.flat();
      });

    const files = (yield* fs.exists(path.join(root, "vite.config.ts"))) ? ["vite.config.ts"] : [];
    for (const sourceRoot of ["packages", "plugins", "scripts", "tools"]) {
      const directory = path.join(root, sourceRoot);
      if (!(yield* fs.exists(directory))) continue;
      const nested = yield* visit(directory, sourceRoot);
      files.push(...nested);
    }
    return files.sort();
  });

export const findTypeScriptJsSpecifiers = (root: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const files = yield* listTypeScriptFiles(root);
    const findings: TypeScriptJsSpecifierFinding[] = [];

    for (const relativeFile of files) {
      const file = path.join(root, relativeFile);
      if (!(yield* fs.exists(file))) continue;
      const source = yield* fs
        .readFileString(file)
        .pipe(Effect.mapError((cause) => fail(`cannot read ${relativeFile}`, cause)));
      const specifiers = source.matchAll(/(["'])((?:\.\.?\/)[^"'\n]+\.js)\1/gu);
      for (const match of specifiers) {
        const specifier = match[2];
        if (specifier === undefined || match.index === undefined) continue;
        const base = path.resolve(path.dirname(file), specifier.slice(0, -3));
        const candidates = [
          `${base}.ts`,
          `${base}.tsx`,
          path.join(base, "index.ts"),
          path.join(base, "index.tsx"),
        ];
        let resolvesToTypeScript = false;
        for (const candidate of candidates) {
          if (yield* fs.exists(candidate)) {
            resolvesToTypeScript = true;
            break;
          }
        }
        if (!resolvesToTypeScript) continue;
        findings.push({
          file: relativeFile,
          line: source.slice(0, match.index).split("\n").length,
          specifier,
        });
      }
    }

    return findings;
  });

export const checkTypeScriptImports = (root: string) =>
  findTypeScriptJsSpecifiers(root).pipe(
    Effect.flatMap((findings) =>
      findings.length === 0
        ? Console.log("TypeScript import specifiers are extensionless")
        : Effect.fail(
            fail(
              findings
                .map(({ file, line, specifier }) => `${file}:${line}: ${specifier}`)
                .join("\n"),
            ),
          ),
    ),
  );

if (import.meta.main) {
  const main = Layer.build(BunServices.layer).pipe(
    Effect.flatMap((context) =>
      checkTypeScriptImports(process.cwd()).pipe(Effect.provide(context)),
    ),
    Effect.scoped,
  );
  BunRuntime.runMain(main);
}
