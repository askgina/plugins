#!/usr/bin/env bun

import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import { ChildProcess } from "effect/unstable/process";
import { Crypto, Data, Effect, FileSystem, Function, Layer, Path, Schema, Stream } from "effect";

import { runHermeticEvalReplay, sanitizeEvalReplay } from "../packages/evals/src/index";
import { copyCheckedRegularFile } from "./archive-security";
import { checkGeneratedTargetConformance } from "./check-target-conformance";

const HOSTS = ["openai", "cursor", "claude", "copilot", "gemini"] as const;
const SKILLS = [
  "research-hyperliquid",
  "research-prediction-markets",
  "research-spot-tokens",
  "review-gina-account",
];
const PACKAGES = [
  {
    slug: "contracts",
    name: "@askgina/contracts",
    directory: "packages/contracts",
    packageFiles: ["dist", "LICENSE", "README.md"],
    compiledFiles: [/^index\.d\.ts$/u, /^index\.js$/u, /^index\.js\.map$/u],
  },
  {
    slug: "sdk",
    name: "@askgina/sdk",
    directory: "packages/sdk",
    packageFiles: ["dist", "LICENSE", "README.md"],
    compiledFiles: [/^index\.d\.ts$/u, /^index\.js$/u, /^index\.js\.map$/u],
  },
  {
    slug: "cli",
    name: "@askgina/cli",
    directory: "packages/cli",
    packageFiles: ["dist", "LICENSE", "README.md"],
    compiledFiles: [
      /^bin\.d\.ts$/u,
      /^bin\.js$/u,
      /^bin\.js\.map$/u,
      /^index\.d\.ts$/u,
      /^index\.js$/u,
      /^run-[A-Za-z0-9_-]+\.js$/u,
      /^run-[A-Za-z0-9_-]+\.js\.map$/u,
    ],
  },
  {
    slug: "plugin-core",
    name: "@askgina/plugin-core",
    directory: "plugins/ask-gina",
    packageFiles: [
      "dist",
      "plugin.yaml",
      "skills",
      "evals/model/v1/activation.yaml",
      "evals/model/v1/smoke.yaml",
      "evals/model/v1/families",
      "evals/model/v1/fixtures",
      "LICENSE",
      "README.md",
    ],
    compiledFiles: [/^index\.d\.ts$/u, /^index\.js$/u, /^index\.js\.map$/u],
  },
  {
    slug: "evals",
    name: "@askgina/evals",
    directory: "packages/evals",
    packageFiles: ["dist", "LICENSE", "README.md"],
    compiledFiles: [
      /^bin\/live\.d\.ts$/u,
      /^bin\/live\.js$/u,
      /^bin\/live\.js\.map$/u,
      /^bin\/replay\.d\.ts$/u,
      /^bin\/replay\.js$/u,
      /^bin\/replay\.js\.map$/u,
      /^index\.d\.ts$/u,
      /^index\.js$/u,
      /^report-[A-Za-z0-9_-]+\.js$/u,
      /^report-[A-Za-z0-9_-]+\.js\.map$/u,
      /^responses-api-[A-Za-z0-9_-]+\.js$/u,
      /^responses-api-[A-Za-z0-9_-]+\.js\.map$/u,
      /^runner-[A-Za-z0-9_-]+\.js$/u,
      /^runner-[A-Za-z0-9_-]+\.js\.map$/u,
    ],
  },
];
const TARGET_MANIFESTS: Readonly<Record<string, string>> = {
  openai: ".codex-plugin/plugin.json",
  cursor: ".cursor-plugin/plugin.json",
  claude: ".claude-plugin/plugin.json",
  copilot: "plugin.json",
  gemini: "gemini-extension.json",
};
const SHA_256 = /^[a-f0-9]{64}$/u;
const GIT_COMMIT = /^[a-f0-9]{40}$/u;
const SEMVER =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const MAX_GIT_PORCELAIN_BYTES = 64 * 1024;
const RAW_EVAL_FIELDS =
  /"(?:prompts?|toolCalls?|tool_calls|payloads?|models?|accounts?|addresses?|final_answer|report)"\s*:/iu;

export class ArtifactPackError extends Data.TaggedError("ArtifactPackError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const stableJson = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const fail = (message: string, cause?: unknown) =>
  new ArtifactPackError(cause === undefined ? { message } : { message, cause });
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const readText = (file: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs
      .readFileString(file)
      .pipe(Effect.mapError((cause) => fail(`cannot read ${file}`, cause)));
  });

const readJson = (file: string) =>
  readText(file).pipe(
    Effect.flatMap((text) =>
      Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(text).pipe(
        Effect.mapError((cause) => fail(`cannot parse ${file}`, cause)),
      ),
    ),
  );

const requiredString = (value: unknown, label: string) =>
  typeof value === "string" && value.length > 0
    ? Effect.succeed(value)
    : Effect.fail(fail(`${label} must be a non-empty string`));

const normalizedPackageFiles = (value: unknown, label: string) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    if (
      !Array.isArray(value) ||
      value.some((item) => typeof item !== "string" || item.length === 0)
    ) {
      return yield* fail(`${label} must be an array of non-empty strings`);
    }
    const entries = value.filter((item): item is string => typeof item === "string");
    const seen = new Set<string>();
    for (const entry of entries) {
      if (
        entry.includes("\\") ||
        path.isAbsolute(entry) ||
        /^[A-Za-z]:\//u.test(entry) ||
        path.normalize(entry) !== entry ||
        entry
          .split("/")
          .some((segment) => segment.length === 0 || segment === "." || segment === "..") ||
        seen.has(entry)
      ) {
        return yield* fail(`${label} contains a non-normalized path: ${entry}`);
      }
      seen.add(entry);
    }
    return entries;
  });

const hash = (bytes: Uint8Array | string) =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto;
    const input = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
    return toHex(
      yield* crypto
        .digest("SHA-256", input)
        .pipe(Effect.mapError((cause) => fail("cannot calculate SHA-256", cause))),
    );
  });

const hashFile = (file: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const bytes = yield* fs
      .readFile(file)
      .pipe(Effect.mapError((cause) => fail(`cannot read ${file}`, cause)));
    return yield* hash(bytes);
  });

const childEnvironment = (): Readonly<Record<string, string>> => ({
  PATH: "/usr/bin:/bin",
  HOME: "/nonexistent",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_OPTIONAL_LOCKS: "0",
  LC_ALL: "C",
  TZ: "UTC",
});

const commandOutput = (command: string, args: readonly string[], cwd: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const child = yield* ChildProcess.make(command, args, {
        cwd,
        env: childEnvironment(),
        extendEnv: false,
        stdin: "ignore",
        stderr: "ignore",
      }).pipe(Effect.mapError((cause) => fail(`cannot start ${command}`, cause)));
      const chunks = yield* child.stdout.pipe(
        Stream.decodeText(),
        Stream.runCollect,
        Effect.mapError((cause) => fail(`cannot read ${command} output`, cause)),
      );
      const exitCode = yield* child.exitCode.pipe(
        Effect.mapError((cause) => fail(`cannot wait for ${command}`, cause)),
      );
      return exitCode === 0 ? chunks.join("") : yield* fail(`${command} exited with ${exitCode}`);
    }),
  );

const commandHasBoundedOutput = (
  command: string,
  args: readonly string[],
  cwd: string,
  maximumBytes: number,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const child = yield* ChildProcess.make(command, args, {
        cwd,
        env: childEnvironment(),
        extendEnv: false,
        stdin: "ignore",
        stderr: "ignore",
      }).pipe(Effect.mapError((cause) => fail(`cannot start ${command}`, cause)));
      const result = yield* child.stdout.pipe(
        Stream.decodeText(),
        Stream.runFoldEffect(
          () => ({ bytes: 0, hasOutput: false }),
          (state, chunk) => {
            const bytes = state.bytes + new TextEncoder().encode(chunk).byteLength;
            return bytes <= maximumBytes
              ? Effect.succeed({ bytes, hasOutput: state.hasOutput || chunk.length > 0 })
              : Effect.fail(fail(`${command} output exceeds ${maximumBytes} bytes`));
          },
        ),
        Effect.mapError((cause) => fail(`cannot read ${command} output`, cause)),
      );
      const exitCode = yield* child.exitCode.pipe(
        Effect.mapError((cause) => fail(`cannot wait for ${command}`, cause)),
      );
      return exitCode === 0 ? result.hasOutput : yield* fail(`${command} exited with ${exitCode}`);
    }),
  );

const runCommand = (command: string, args: readonly string[], cwd: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const child = yield* ChildProcess.make(command, args, {
        cwd,
        env: childEnvironment(),
        extendEnv: false,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "inherit",
      }).pipe(Effect.mapError((cause) => fail(`cannot start ${command}`, cause)));
      const exitCode = yield* child.exitCode.pipe(
        Effect.mapError((cause) => fail(`cannot wait for ${command}`, cause)),
      );
      if (exitCode !== 0) return yield* fail(`${command} exited with ${exitCode}`);
    }),
  );

const filesBelow = (directory: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const visit = (current: string, prefix: string): Effect.Effect<string[], ArtifactPackError> =>
      Effect.gen(function* () {
        const names = yield* fs
          .readDirectory(current)
          .pipe(Effect.mapError((cause) => fail(`cannot list ${current}`, cause)));
        const nested = yield* Effect.forEach(names.sort(), (name) =>
          Effect.gen(function* () {
            const absolute = path.join(current, name);
            const relative = prefix.length > 0 ? `${prefix}/${name}` : name;
            const symbolicLink = yield* fs
              .readLink(absolute)
              .pipe(Effect.match({ onFailure: () => false, onSuccess: () => true }));
            if (symbolicLink) {
              return yield* fail(`archive input contains a symbolic link: ${relative}`);
            }
            const info = yield* fs
              .stat(absolute)
              .pipe(Effect.mapError((cause) => fail(`cannot inspect ${absolute}`, cause)));
            if (info.type === "Directory") return yield* visit(absolute, relative);
            if (info.type === "File") return [relative];
            return yield* fail(`archive input contains unsupported content: ${relative}`);
          }),
        );
        return nested.flat();
      });
    return yield* visit(directory, "");
  });

const fileProofs = (directory: string, prefix = "") =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const files = yield* filesBelow(directory);
    return yield* Effect.forEach(files, (file) =>
      hashFile(path.join(directory, file)).pipe(
        Effect.map((sha256) => ({ path: prefix.length > 0 ? `${prefix}/${file}` : file, sha256 })),
      ),
    );
  });
const packageDefinition = (name: string) => {
  const definition = PACKAGES.find((candidate) => candidate.name === name);
  return definition === undefined
    ? Effect.fail(fail(`unknown package definition: ${name}`))
    : Effect.succeed(definition);
};

const verifyEmbeddedSourceMap = (
  livePackageRoot: string,
  sourcePackageRoot: string,
  mapFile: string,
) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const value = yield* readJson(mapFile);
    if (!isObject(value) || value.version !== 3) {
      return yield* fail("compiled source map must be a version 3 object");
    }
    if (value.sourceRoot !== undefined && value.sourceRoot !== "") {
      return yield* fail("compiled source map must not declare sourceRoot");
    }
    const companion = mapFile.slice(0, -".map".length);
    const companionName = path.basename(companion);
    if (value.file !== undefined && value.file !== companionName) {
      return yield* fail("compiled source map file does not match its companion");
    }
    const compiled = yield* readText(companion);
    if (!compiled.trimEnd().endsWith(`//# sourceMappingURL=${path.basename(mapFile)}`)) {
      return yield* fail("compiled file does not reference its source map");
    }
    if (!Array.isArray(value.sources) || value.sources.length === 0) {
      return yield* fail("compiled source map must contain sources");
    }
    if (
      !Array.isArray(value.sourcesContent) ||
      value.sourcesContent.length !== value.sources.length
    ) {
      return yield* fail("compiled source map sourcesContent must match sources");
    }
    for (const [index, sourceValue] of value.sources.entries()) {
      const content = value.sourcesContent[index];
      if (typeof sourceValue !== "string" || sourceValue.length === 0) {
        return yield* fail("compiled source map contains an invalid source path");
      }
      if (typeof content !== "string" || content.length === 0) {
        return yield* fail("compiled source map contains empty sourcesContent");
      }
      if (
        sourceValue.includes("\\") ||
        sourceValue.startsWith("/") ||
        /^[A-Za-z]:/u.test(sourceValue) ||
        /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(sourceValue) ||
        Array.from(sourceValue).some((character) => {
          const code = character.charCodeAt(0);
          return code <= 0x1f || code === 0x7f;
        }) ||
        sourceValue.split("/").some((segment) => segment.length === 0 || segment === ".")
      ) {
        return yield* fail(`compiled source map contains an unsafe source path: ${sourceValue}`);
      }
      const liveSource = path.resolve(path.dirname(mapFile), sourceValue);
      const packageRelative = path.relative(livePackageRoot, liveSource);
      if (
        packageRelative === ".." ||
        packageRelative.startsWith("../") ||
        packageRelative.startsWith("..\\") ||
        path.isAbsolute(packageRelative) ||
        !packageRelative.endsWith(".ts")
      ) {
        return yield* fail(`compiled source map escapes its package: ${sourceValue}`);
      }
      const expected = yield* readText(path.join(sourcePackageRoot, packageRelative));
      if (content !== expected) {
        return yield* fail(`compiled source map content is stale: ${sourceValue}`);
      }
    }
  });

export interface VerifiedCompiledPackageOutput {
  readonly allowlist: readonly string[];
  readonly files: readonly string[];
}

export type VerifyCompiledPackageOutputEffect = Effect.Effect<
  VerifiedCompiledPackageOutput,
  ArtifactPackError,
  FileSystem.FileSystem | Path.Path
>;

const verifyCompiledPackageOutputImpl = (
  liveRoot: string,
  sourceRoot: string,
  packageName: string,
): VerifyCompiledPackageOutputEffect =>
  Effect.gen(function* () {
    const definition = yield* packageDefinition(packageName);
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const livePackageRoot = path.join(liveRoot, definition.directory);
    const sourcePackageRoot = path.join(sourceRoot, definition.directory);
    const metadata = yield* readJson(path.join(sourcePackageRoot, "package.json"));
    if (!isObject(metadata)) {
      return yield* fail(`${definition.name} package.json must be an object`);
    }
    const allowlist = yield* normalizedPackageFiles(metadata.files, `${definition.name} files`);
    if (stableJson(allowlist) !== stableJson(definition.packageFiles)) {
      return yield* fail(`${definition.name} package files are inconsistent`);
    }
    const dist = path.join(livePackageRoot, "dist");
    const files = yield* filesBelow(dist);
    const committedDist = path.join(sourcePackageRoot, "dist");
    const committedFiles = yield* filesBelow(committedDist);
    if (files.join("\n") !== committedFiles.join("\n")) {
      return yield* fail(`${definition.name} compiled output differs from source commit build`);
    }
    yield* Effect.forEach(files, (file) =>
      Effect.gen(function* () {
        const liveBytes = yield* fs
          .readFile(path.join(dist, file))
          .pipe(Effect.mapError((cause) => fail(`cannot read ${definition.name}:${file}`, cause)));
        const committedBytes = yield* fs
          .readFile(path.join(committedDist, file))
          .pipe(
            Effect.mapError((cause) =>
              fail(`cannot read source commit build ${definition.name}:${file}`, cause),
            ),
          );
        if (
          liveBytes.length !== committedBytes.length ||
          liveBytes.some((byte, index) => byte !== committedBytes[index])
        ) {
          return yield* fail(
            `${definition.name} compiled output differs from source commit build: ${file}`,
          );
        }
      }),
    );
    for (const pattern of definition.compiledFiles) {
      if (files.filter((file) => pattern.test(file)).length !== 1) {
        return yield* fail(
          `${definition.name} compiled output is missing or ambiguous: ${pattern}`,
        );
      }
    }
    for (const file of files) {
      if (definition.compiledFiles.filter((pattern) => pattern.test(file)).length !== 1) {
        return yield* fail(`${definition.name} has unexpected compiled output: ${file}`);
      }
    }
    yield* Effect.forEach(
      files.filter((file) => file.endsWith(".d.ts")),
      (file) =>
        Effect.gen(function* () {
          const declaration = yield* readText(path.join(dist, file));
          const referencedMap = declaration.match(/\/\/# sourceMappingURL=([^\r\n]+)\s*$/u)?.[1];
          if (
            referencedMap !== undefined &&
            (referencedMap !== `${path.basename(file)}.map` || !files.includes(`${file}.map`))
          ) {
            return yield* fail(
              `${definition.name} compiled declaration references a missing source map: ${file}`,
            );
          }
        }),
    );
    const maps = files.filter((file) => file.endsWith(".map"));
    if (maps.length === 0) return yield* fail(`${definition.name} has no compiled source maps`);
    yield* Effect.forEach(maps, (file) =>
      verifyEmbeddedSourceMap(livePackageRoot, sourcePackageRoot, path.join(dist, file)),
    );
    return { allowlist, files };
  });

export const verifyCompiledPackageOutput: {
  (
    sourceRoot: string,
    packageName: string,
  ): (liveRoot: string) => VerifyCompiledPackageOutputEffect;
  (liveRoot: string, sourceRoot: string, packageName: string): VerifyCompiledPackageOutputEffect;
} = Function.dual(3, verifyCompiledPackageOutputImpl);

const rewriteWorkspaceRanges = (value: unknown, version: string): void => {
  if (!isObject(value)) return;
  for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    const dependencies = Reflect.get(value, field);
    if (!isObject(dependencies)) continue;
    for (const [name, range] of Object.entries(dependencies)) {
      if (typeof range === "string" && range.startsWith("workspace:")) dependencies[name] = version;
    }
  }
};

const stagePackageImpl = (
  liveRoot: string,
  sourceRoot: string,
  packageName: string,
  stage: string,
  version: string,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const definition = yield* packageDefinition(packageName);
    const sourcePackageRoot = path.join(sourceRoot, definition.directory);
    const verified = yield* verifyCompiledPackageOutput(liveRoot, sourceRoot, definition.name);
    const metadata = yield* readJson(path.join(sourcePackageRoot, "package.json"));
    if (!isObject(metadata))
      return yield* fail(`${definition.name} package.json must be an object`);
    const name = yield* requiredString(metadata.name, `${definition.name} package name`);
    const declaredVersion = yield* requiredString(
      metadata.version,
      `${definition.name} package version`,
    );
    if (name !== definition.name || declaredVersion !== version) {
      return yield* fail(`${definition.name} package identity is inconsistent`);
    }
    const allowlist = verified.allowlist;
    rewriteWorkspaceRanges(metadata, version);
    const packageRoot = path.join(stage, "package");
    yield* fs
      .makeDirectory(packageRoot, { recursive: true })
      .pipe(Effect.mapError((cause) => fail(`cannot create ${packageRoot}`, cause)));
    yield* fs
      .writeFileString(path.join(packageRoot, "package.json"), stableJson(metadata))
      .pipe(Effect.mapError((cause) => fail(`cannot stage ${definition.name} metadata`, cause)));
    yield* Effect.forEach(allowlist, (entry) =>
      Effect.gen(function* () {
        const source = path.join(sourcePackageRoot, entry);
        const symbolicLink = yield* fs
          .readLink(source)
          .pipe(Effect.match({ onFailure: () => false, onSuccess: () => true }));
        if (symbolicLink) {
          return yield* fail(`archive input contains a symbolic link: ${definition.name}:${entry}`);
        }
        const info = yield* fs
          .stat(source)
          .pipe(
            Effect.mapError((cause) => fail(`cannot inspect ${definition.name}:${entry}`, cause)),
          );
        if (info.type === "Directory") yield* filesBelow(source);
        else if (info.type !== "File") {
          return yield* fail(
            `archive input contains unsupported content: ${definition.name}:${entry}`,
          );
        }
        yield* fs
          .copy(source, path.join(packageRoot, entry), { overwrite: true })
          .pipe(
            Effect.mapError((cause) => fail(`cannot stage ${definition.name}:${entry}`, cause)),
          );
      }),
    );
    return yield* fileProofs(packageRoot, "package");
  });
export const stagePackage: {
  (
    sourceRoot: string,
    packageName: string,
    stage: string,
    version: string,
  ): (liveRoot: string) => ReturnType<typeof stagePackageImpl>;
  (
    liveRoot: string,
    sourceRoot: string,
    packageName: string,
    stage: string,
    version: string,
  ): ReturnType<typeof stagePackageImpl>;
} = Function.dual(5, stagePackageImpl);

const archive = (root: string, stage: string, output: string, entries: readonly string[]) =>
  runCommand(
    "tar",
    [
      "--sort=name",
      "--mtime=@0",
      "--owner=0",
      "--group=0",
      "--numeric-owner",
      "-czf",
      output,
      "-C",
      stage,
      ...entries,
    ],
    root,
  );

const snapshotAtCommit = (root: string, sourceCommit: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const temporary = yield* fs
      .makeTempDirectoryScoped({ prefix: "askgina-pack-source-" })
      .pipe(Effect.mapError((cause) => fail("cannot create source snapshot directory", cause)));
    const archiveFile = path.join(temporary, "source.tar");
    const snapshot = path.join(temporary, "source");
    yield* fs
      .makeDirectory(snapshot, { recursive: true })
      .pipe(Effect.mapError((cause) => fail("cannot create source snapshot", cause)));
    yield* runCommand(
      "git",
      ["archive", "--format=tar", `--output=${archiveFile}`, sourceCommit],
      root,
    );
    yield* runCommand("tar", ["--extract", "--file", archiveFile, "--directory", snapshot], root);
    return snapshot;
  });

const buildSnapshotPackages = (root: string, snapshot: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const linkNodeModules = (relative: string, required: boolean) =>
      Effect.gen(function* () {
        const installed = path.join(root, relative, "node_modules");
        if (!(yield* fs.exists(installed))) {
          if (required) return yield* fail("installed dependencies are unavailable");
          return;
        }
        const linked = path.join(snapshot, relative, "node_modules");
        yield* fs
          .makeDirectory(linked, { recursive: true })
          .pipe(Effect.mapError((cause) => fail(`cannot create ${relative}/node_modules`, cause)));
        const names = yield* fs
          .readDirectory(installed)
          .pipe(Effect.mapError((cause) => fail(`cannot list ${relative}/node_modules`, cause)));
        yield* Effect.forEach(names.sort(), (name) =>
          Effect.gen(function* () {
            if (name === ".vite" || name === ".vite-temp") return;
            if (name !== "@askgina") {
              yield* fs
                .symlink(path.join(installed, name), path.join(linked, name))
                .pipe(
                  Effect.mapError((cause) =>
                    fail(`cannot link build dependency ${relative}/node_modules/${name}`, cause),
                  ),
                );
              return;
            }
            const installedScope = path.join(installed, name);
            const linkedScope = path.join(linked, name);
            yield* fs
              .makeDirectory(linkedScope, { recursive: true })
              .pipe(Effect.mapError((cause) => fail("cannot link workspace dependencies", cause)));
            const workspaceNames = yield* fs
              .readDirectory(installedScope)
              .pipe(Effect.mapError((cause) => fail("cannot list workspace dependencies", cause)));
            yield* Effect.forEach(workspaceNames.sort(), (workspaceName) =>
              Effect.gen(function* () {
                const definition = PACKAGES.find(
                  (candidate) => candidate.name === `@askgina/${workspaceName}`,
                );
                if (definition === undefined) {
                  return yield* fail(`unknown workspace dependency: @askgina/${workspaceName}`);
                }
                yield* fs
                  .symlink(
                    path.join(snapshot, definition.directory),
                    path.join(linkedScope, workspaceName),
                  )
                  .pipe(
                    Effect.mapError((cause) =>
                      fail(`cannot link workspace dependency ${definition.name}`, cause),
                    ),
                  );
              }),
            );
          }),
        );
      });
    yield* linkNodeModules("", true);
    yield* Effect.forEach(PACKAGES, (definition) => linkNodeModules(definition.directory, false));
    yield* runCommand(process.execPath, ["node_modules/.bin/vp", "pack"], snapshot);
  });

const assertLiveSourceBoundary = (root: string, snapshot: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const visit = (
      live: string,
      committed: string,
      relative: string,
    ): Effect.Effect<void, ArtifactPackError> =>
      Effect.gen(function* () {
        const symbolicLink = yield* fs
          .readLink(live)
          .pipe(Effect.match({ onFailure: () => false, onSuccess: () => true }));
        if (symbolicLink) return yield* fail(`archive input contains a symbolic link: ${relative}`);
        const liveInfo = yield* fs
          .stat(live)
          .pipe(Effect.mapError((cause) => fail(`cannot inspect ${relative}`, cause)));
        if (liveInfo.type !== "Directory" && liveInfo.type !== "File") {
          return yield* fail(`archive input contains unsupported content: ${relative}`);
        }
        const committedLink = yield* fs
          .readLink(committed)
          .pipe(Effect.match({ onFailure: () => false, onSuccess: () => true }));
        if (committedLink) {
          return yield* fail(`source commit contains a symbolic link: ${relative}`);
        }
        const committedInfo = yield* fs
          .stat(committed)
          .pipe(Effect.match({ onFailure: () => undefined, onSuccess: (info) => info }));
        if (committedInfo === undefined) {
          return yield* fail(`archive input is absent from source commit: ${relative}`);
        }
        if (committedInfo.type !== liveInfo.type) {
          return yield* fail(`archive input type differs from source commit: ${relative}`);
        }
        if (liveInfo.type !== "Directory") return;
        const names = yield* fs
          .readDirectory(live)
          .pipe(Effect.mapError((cause) => fail(`cannot list ${relative}`, cause)));
        yield* Effect.forEach(names.sort(), (name) =>
          name === "node_modules" ||
          (name === "dist" && PACKAGES.some((definition) => definition.directory === relative))
            ? Effect.void
            : visit(path.join(live, name), path.join(committed, name), `${relative}/${name}`),
        );
      });
    yield* Effect.forEach(PACKAGES, (definition) =>
      visit(
        path.join(root, definition.directory),
        path.join(snapshot, definition.directory),
        definition.directory,
      ),
    );
  });

const validateVersions = (root: string) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const rootJson = yield* readJson(path.join(root, "package.json"));
    const version = yield* requiredString(
      isObject(rootJson) ? rootJson.version : undefined,
      "root package version",
    );
    if (!SEMVER.test(version)) return yield* fail("root package version must be valid SemVer");
    yield* Effect.forEach(PACKAGES, (definition) =>
      Effect.gen(function* () {
        const metadata = yield* readJson(path.join(root, definition.directory, "package.json"));
        if (!isObject(metadata) || metadata.version !== version) {
          return yield* fail(`${definition.name} version must equal ${version}`);
        }
        yield* normalizedPackageFiles(metadata.files, `${definition.name} files`);
      }),
    );
    const pluginManifest = yield* readText(path.join(root, "plugins/ask-gina/plugin.yaml"));
    if (pluginManifest.match(/^version:\s*([^\s]+)$/mu)?.[1] !== version) {
      return yield* fail("plugin.yaml version is inconsistent");
    }
    yield* Effect.forEach(HOSTS, (host) =>
      Effect.gen(function* () {
        const manifest = TARGET_MANIFESTS[host];
        if (manifest === undefined) return yield* fail(`unknown target ${host}`);
        const value = yield* readJson(path.join(root, "plugins/ask-gina/targets", host, manifest));
        if (!isObject(value) || value.version !== version) {
          return yield* fail(`${host} target version is inconsistent`);
        }
      }),
    );
    return version;
  });

const buildEvalReceipt = (root: string, version: string, sourceCommit: string) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const result = yield* runHermeticEvalReplay({
      suitePath: path.join(root, "plugins/ask-gina/evals/model/v1/smoke.yaml"),
      observationsPath: path.join(
        root,
        "plugins/ask-gina/evals/model/v1/fixtures/synthetic-observations.yaml",
      ),
    }).pipe(Effect.mapError((cause) => fail("hermetic eval replay failed", cause)));
    const aggregate = yield* sanitizeEvalReplay(result).pipe(
      Effect.mapError((cause) => fail("hermetic eval sanitization failed", cause)),
    );
    if (RAW_EVAL_FIELDS.test(stableJson(aggregate))) {
      return yield* fail("eval sanitizer emitted a forbidden aggregate");
    }
    return { releaseVersion: version, sourceCommit, aggregate };
  });

export interface BuildArtifactsOptions {
  readonly root: string;
  readonly dist: string;
}

export const buildArtifacts = ({ root, dist }: BuildArtifactsOptions) =>
  Effect.scoped(
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const fs = yield* FileSystem.FileSystem;
      const sourceCommit = (yield* commandOutput(
        "git",
        ["rev-parse", "--verify", "HEAD"],
        root,
      )).trim();
      if (!GIT_COMMIT.test(sourceCommit)) return yield* fail("source commit is invalid");
      const source = yield* snapshotAtCommit(root, sourceCommit);
      yield* assertLiveSourceBoundary(root, source);
      const plugin = path.join(source, "plugins/ask-gina");
      const version = yield* validateVersions(source);
      const sourceDirty: boolean = yield* commandHasBoundedOutput(
        "git",
        ["status", "--porcelain=v1", "--untracked-files=all"],
        root,
        MAX_GIT_PORCELAIN_BYTES,
      );
      if (sourceDirty) return yield* fail("artifact source tree must be clean");
      yield* buildSnapshotPackages(root, source);
      const contractSource = yield* readText(path.join(source, "packages/contracts/src/index.ts"));
      const catalogSha = contractSource.match(/export const catalogSha = "([a-f0-9]{64})"/u)?.[1];
      const contractVersion = contractSource.match(
        /export const RELEASE_VERSION = "([^"\\]+)"/u,
      )?.[1];
      if (catalogSha === undefined || !SHA_256.test(catalogSha) || contractVersion !== version) {
        return yield* fail("public contract version or catalog SHA is inconsistent");
      }
      yield* fs
        .remove(dist, { recursive: true, force: true })
        .pipe(Effect.mapError((cause) => fail("cannot clean dist", cause)));
      yield* Effect.forEach(["packages", "targets", "skills", "receipts"], (directory) =>
        fs
          .makeDirectory(path.join(dist, directory), { recursive: true })
          .pipe(Effect.mapError((cause) => fail(`cannot create dist/${directory}`, cause))),
      );
      const temporary = yield* fs
        .makeTempDirectoryScoped({ prefix: "askgina-artifacts-" })
        .pipe(
          Effect.mapError((cause) => fail("cannot create temporary artifact directory", cause)),
        );

      const packageReceipts = yield* Effect.forEach(PACKAGES, (definition) =>
        Effect.gen(function* () {
          const stage = path.join(temporary, `package-${definition.slug}`);
          const files = yield* stagePackage(root, source, definition.name, stage, version);
          const filename = `askgina-${definition.slug}-${version}.tgz`;
          const output = path.join(dist, "packages", filename);
          yield* archive(root, stage, output, ["package"]);
          return {
            name: definition.name,
            version,
            archive: `packages/${filename}`,
            sha256: yield* hashFile(output),
            files,
          };
        }),
      );
      const contractFiles = yield* fileProofs(
        path.join(source, "packages/contracts/dist"),
        "packages/contracts/dist",
      );

      const sourceSkills = (yield* Effect.forEach(SKILLS, (skill) =>
        fileProofs(path.join(plugin, "skills", skill), skill),
      ))
        .flat()
        .sort((left, right) => left.path.localeCompare(right.path));
      const skillSourceSha = yield* hash(stableJson(sourceSkills));
      const targetReceipts = yield* Effect.forEach(HOSTS, (host) =>
        Effect.gen(function* () {
          const stage = path.join(temporary, `target-${host}`);
          yield* filesBelow(path.join(plugin, "targets", host));
          yield* fs
            .copy(path.join(plugin, "targets", host), stage, { overwrite: true })
            .pipe(Effect.mapError((cause) => fail(`cannot stage ${host} target`, cause)));
          yield* fs
            .makeDirectory(path.join(stage, "skills"), { recursive: true })
            .pipe(Effect.mapError((cause) => fail(`cannot create ${host} skills`, cause)));
          yield* Effect.forEach(SKILLS, (skill) =>
            Effect.gen(function* () {
              const destination = path.join(stage, "skills", skill);
              yield* fs
                .copy(path.join(plugin, "skills", skill), destination, { overwrite: true })
                .pipe(Effect.mapError((cause) => fail(`cannot stage ${host}:${skill}`, cause)));
              if (host !== "openai") {
                yield* fs
                  .remove(path.join(destination, "agents"), { recursive: true, force: true })
                  .pipe(Effect.mapError((cause) => fail(`cannot remove ${host} overlay`, cause)));
              }
            }),
          );
          const skills = (yield* fs
            .readDirectory(path.join(stage, "skills"))
            .pipe(Effect.mapError((cause) => fail(`cannot list ${host} skills`, cause)))).sort();
          if (skills.join("\n") !== [...SKILLS].sort().join("\n")) {
            return yield* fail(`${host} target has the wrong skills`);
          }
          const files = yield* filesBelow(stage);
          const overlays = files.filter((file) => file.endsWith("/agents/openai.yaml"));
          if (host === "openai" ? overlays.length !== SKILLS.length : overlays.length !== 0) {
            return yield* fail(`${host} target violates the OpenAI overlay rule`);
          }
          const conformance = yield* checkGeneratedTargetConformance(host, stage, {
            packageRoot: plugin,
          }).pipe(
            Effect.mapError((cause) => fail(`${host} staged target conformance failed`, cause)),
          );
          if (!conformance.passed) {
            return yield* fail(`${host} staged target is not conformant`);
          }
          const conformanceReceipt = {
            passed: conformance.passed,
            skillCount: conformance.checks.filter((check) => check.id.includes(".skill.")).length,
            openAiOverlayOnly: conformance.checks
              .filter(
                (check) =>
                  check.id.endsWith(".openai_metadata") || check.id.endsWith(".no_openai_metadata"),
              )
              .every((check) => check.passed),
          };
          const filename = `ask-gina-${host}-${version}.tgz`;
          const output = path.join(dist, "targets", filename);
          yield* archive(root, stage, output, ["."]);
          return {
            host,
            version,
            archive: `targets/${filename}`,
            sha256: yield* hashFile(output),
            skillSourceSha,
            skills: [...SKILLS].sort(),
            files: yield* fileProofs(stage),
            conformance: conformanceReceipt,
          };
        }),
      );

      const skillsStage = path.join(temporary, "skills");
      yield* fs
        .makeDirectory(skillsStage, { recursive: true })
        .pipe(Effect.mapError((cause) => fail("cannot create skills candidate", cause)));
      yield* Effect.forEach(["README.md", "LICENSE"], (file) =>
        copyCheckedRegularFile(path.join(plugin, file), path.join(skillsStage, file)).pipe(
          Effect.mapError((cause) => fail(`cannot stage skills ${file}`, cause)),
        ),
      );
      yield* Effect.forEach(SKILLS, (skill) =>
        Effect.gen(function* () {
          const destination = path.join(skillsStage, skill);
          yield* fs
            .copy(path.join(plugin, "skills", skill), destination, { overwrite: true })
            .pipe(Effect.mapError((cause) => fail(`cannot stage candidate ${skill}`, cause)));
          yield* fs
            .remove(path.join(destination, "agents"), { recursive: true, force: true })
            .pipe(
              Effect.mapError((cause) => fail(`cannot remove candidate overlay ${skill}`, cause)),
            );
        }),
      );
      const skillsFilename = `ask-gina-skills-${version}.tgz`;
      const skillsOutput = path.join(dist, "skills", skillsFilename);
      yield* archive(root, skillsStage, skillsOutput, ["."]);

      const receipts: readonly [string, unknown][] = [
        [
          "contract.json",
          {
            schemaVersion: "v1",
            releaseVersion: version,
            sourceCommit,
            sourceDirty,
            catalogSha,
            files: contractFiles,
          },
        ],
        [
          "packages.json",
          {
            schemaVersion: "v1",
            releaseVersion: version,
            sourceCommit,
            sourceDirty,
            packages: packageReceipts,
          },
        ],
        [
          "targets.json",
          {
            schemaVersion: "v1",
            releaseVersion: version,
            sourceCommit,
            sourceDirty,
            skillSourceSha,
            targets: targetReceipts,
            skillsCandidate: {
              version,
              archive: `skills/${skillsFilename}`,
              sha256: yield* hashFile(skillsOutput),
              skills: [...SKILLS].sort(),
              files: yield* fileProofs(skillsStage),
            },
          },
        ],
        [
          "evals.json",
          {
            schemaVersion: "v1",
            sourceDirty,
            ...(yield* buildEvalReceipt(source, version, sourceCommit)),
          },
        ],
      ];
      yield* Effect.forEach(receipts, ([name, receipt]) =>
        fs
          .writeFileString(path.join(dist, "receipts", name), stableJson(receipt))
          .pipe(Effect.mapError((cause) => fail(`cannot write ${name}`, cause))),
      );
    }),
  );

if (import.meta.main) {
  const cli = Effect.gen(function* () {
    if (process.argv.slice(2).length !== 0) {
      return yield* fail("pack-artifacts accepts no arguments");
    }
    const path = yield* Path.Path;
    const root = process.cwd();
    yield* buildArtifacts({ root, dist: path.join(root, "dist") });
  });
  const main = Layer.build(BunServices.layer).pipe(
    Effect.flatMap((context) => cli.pipe(Effect.provide(context))),
    Effect.scoped,
  );
  BunRuntime.runMain(main);
}
