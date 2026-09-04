#!/usr/bin/env bun

import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import { ChildProcess } from "effect/unstable/process";
import {
  Config,
  Crypto,
  Data,
  Effect,
  FileSystem,
  Layer,
  Function,
  Path,
  Schema,
  Stream,
} from "effect";

import {
  runHermeticEvalReplay,
  sanitizeEvalAggregate,
  sanitizeEvalReplay,
} from "../packages/evals/src/index";
import { copyCheckedRegularFile, extractCheckedTarGz } from "./archive-security";
import {
  CURSOR_LISTING_VERSION,
  OPENAI_LISTING_VERSION,
  checkGeneratedTargetConformance,
} from "./check-target-conformance";
import { buildArtifacts } from "./pack-artifacts";

const HOSTS = ["openai", "cursor", "claude", "copilot", "gemini", "devin"] as const;
const SKILLS = [
  "research-hyperliquid",
  "research-prediction-markets",
  "research-spot-tokens",
  "review-gina-account",
];
export const OPENAI_ASSETS = [
  "gold-up-or-down-daily.png",
  "hyperliquid-chart.png",
  "icon.svg",
  "nba-champion-podium.png",
  "perpetual-positions.png",
  "premier-league-prediction-markets.png",
] as const;
const PACKAGES = [
  { slug: "contracts", name: "@askgina/contracts", directory: "packages/contracts", internal: [] },
  {
    slug: "sdk",
    name: "@askgina/sdk",
    directory: "packages/sdk",
    internal: ["@askgina/contracts"],
  },
  { slug: "cli", name: "@askgina/cli", directory: "packages/cli", internal: ["@askgina/sdk"] },
  {
    slug: "plugin-core",
    name: "@askgina/plugin-core",
    directory: "plugins/ask-gina",
    internal: ["@askgina/contracts"],
  },
  {
    slug: "evals",
    name: "@askgina/evals",
    directory: "packages/evals",
    internal: ["@askgina/contracts", "@askgina/plugin-core", "@askgina/sdk"],
  },
];
const TARGET_MANIFESTS: Readonly<Record<string, string>> = {
  openai: ".codex-plugin/plugin.json",
  cursor: ".cursor-plugin/plugin.json",
  claude: ".claude-plugin/plugin.json",
  copilot: "plugin.json",
  gemini: "gemini-extension.json",
  devin: ".devin-plugin/plugin.json",
};
const SHA_256 = /^[a-f0-9]{64}$/u;
const GIT_COMMIT = /^[a-f0-9]{40}$/u;
const NODE_24_VERSION = /^v24\.\d+\.\d+$/u;
const SEMVER =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const MAX_GIT_PORCELAIN_BYTES = 64 * 1024;
const RAW_EVAL_FIELDS =
  /"(?:prompts?|toolCalls?|tool_calls|payloads?|models?|accounts?|addresses?|final_answer|report)"\s*:/iu;
const NODE_24_SMOKE = String.raw`
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect, Schema } from "effect";
import {
  GINA_READ_TOOL_CATALOG,
  GinaReadToolCatalogSchema,
  PRODUCTION_MCP_URL,
} from "@askgina/contracts";
import { createClient, listCatalogToolNames } from "@askgina/sdk";

const packageRoot = (name) => dirname(dirname(fileURLToPath(import.meta.resolve(name))));
for (const name of ["@askgina/contracts", "@askgina/sdk"]) {
  const root = packageRoot(name);
  assert.equal(existsSync(join(root, "src")), false, name + " installed raw source");
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.deepEqual(Object.keys(manifest.exports["."]).sort(), ["import", "types"]);
  assert.equal(manifest.type, "module");
  assert.equal(manifest.engines.node, ">=24");
}

const catalog = await Effect.runPromise(
  Schema.decodeUnknownEffect(GinaReadToolCatalogSchema)(GINA_READ_TOOL_CATALOG),
);
assert.equal(catalog.length, 30);
const listed = GINA_READ_TOOL_CATALOG.map(({ name }) => ({ name }));
const client = createClient({
  accessToken: "offline-token",
  transport: {
    listTools: () => Effect.succeed(listed),
    callTool: () => Effect.succeed({}),
  },
});
assert.equal(client.url, PRODUCTION_MCP_URL);
assert.deepEqual(
  (await Effect.runPromise(client.listTools())).map(({ name }) => name),
  listCatalogToolNames(),
);

let contacted = false;
const unauthenticated = createClient({
  accessToken: "   ",
  transport: {
    listTools: () => Effect.sync(() => { contacted = true; return []; }),
    callTool: () => Effect.sync(() => { contacted = true; return {}; }),
  },
});
const authenticationError = await Effect.runPromise(
  unauthenticated.listTools().pipe(
    Effect.match({ onFailure: (error) => error, onSuccess: () => undefined }),
  ),
);
assert.equal(authenticationError?._tag, "AskGinaAuthError");
assert.equal(contacted, false);

let stack = "";
try {
  createClient({ accessToken: "offline-token", url: "https://example.invalid" });
} catch (error) {
  stack = String(error?.stack ?? error);
}
assert.match(stack, /node_modules\/@askgina\/sdk\/src\/client\.ts:\d+:\d+/u);
`;

type PackageDefinition = (typeof PACKAGES)[number];
type FileProof = Readonly<{ readonly path: string; readonly sha256: string }>;

export class ArtifactVerificationError extends Data.TaggedError("ArtifactVerificationError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const stableJson = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const fail = (message: string, cause?: unknown) =>
  new ArtifactVerificationError(cause === undefined ? { message } : { message, cause });
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
const parseJsonc = (text: string): unknown => Bun.JSONC.parse(text);

const readJsonc = (file: string) =>
  readText(file).pipe(
    Effect.flatMap((text) =>
      Effect.try({
        try: () => parseJsonc(text),
        catch: (cause) => fail(`cannot parse ${file}`, cause),
      }),
    ),
  );

const requiredObject = (value: unknown, label: string) =>
  isObject(value) ? Effect.succeed(value) : Effect.fail(fail(`${label} must be an object`));
const requiredArray = (value: unknown, label: string) =>
  Array.isArray(value) ? Effect.succeed(value) : Effect.fail(fail(`${label} must be an array`));
const requiredString = (value: unknown, label: string) =>
  typeof value === "string" && value.length > 0
    ? Effect.succeed(value)
    : Effect.fail(fail(`${label} must be a non-empty string`));
const requiredStringRecord = (value: unknown, label: string) =>
  Effect.gen(function* () {
    const object = yield* requiredObject(value, label);
    const result: Record<string, string> = {};
    for (const [key, entry] of Object.entries(object)) {
      if (typeof entry !== "string" || entry.length === 0) {
        return yield* fail(`${label}.${key} must be a non-empty string`);
      }
      result[key] = entry;
    }
    return result;
  });
const verifySourceDirty = (value: unknown, expected: boolean, label: string) =>
  typeof value === "boolean" && value === expected
    ? Effect.void
    : Effect.fail(fail(`${label} does not match the current source state`));

const exactKeys = (value: Record<string, unknown>, keys: readonly string[], label: string) => {
  const actual = Object.keys(value).sort().join("\n");
  const expected = [...keys].sort().join("\n");
  return actual === expected ? Effect.void : Effect.fail(fail(`${label} has unexpected fields`));
};

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

const commandOutput = (
  command: string,
  args: readonly string[],
  cwd: string,
  env?: Record<string, string | undefined>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const child = yield* ChildProcess.make(command, args, {
        cwd,
        env: env ?? (command === "git" ? childEnvironment() : undefined),
        extendEnv: false,
        stdin: "ignore",
        stderr: "ignore",
      }).pipe(Effect.mapError((cause) => fail(`cannot start ${command}`, cause)));
      const output = yield* child.stdout.pipe(
        Stream.decodeText(),
        Stream.runCollect,
        Effect.mapError((cause) => fail(`cannot read ${command} output`, cause)),
      );
      const exitCode = yield* child.exitCode.pipe(
        Effect.mapError((cause) => fail(`cannot wait for ${command}`, cause)),
      );
      return exitCode === 0 ? output.join("") : yield* fail(`${command} exited with ${exitCode}`);
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
        env: command === "git" ? childEnvironment() : undefined,
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

const runCommand = (
  command: string,
  args: readonly string[],
  cwd: string,
  env?: Record<string, string | undefined>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const child = yield* ChildProcess.make(command, args, {
        cwd,
        env,
        extendEnv: false,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      }).pipe(Effect.mapError((cause) => fail(`cannot start ${command}`, cause)));
      const exitCode = yield* child.exitCode.pipe(
        Effect.mapError((cause) => fail(`cannot wait for ${command}`, cause)),
      );
      if (exitCode !== 0) return yield* fail(`${command} exited with ${exitCode}`);
    }),
  );
export const runNodeEsmSmoke = (
  options: Readonly<{
    readonly node: string;
    readonly cwd: string;
    readonly source: string;
    readonly env?: Record<string, string | undefined>;
  }>,
) =>
  runCommand(
    options.node,
    ["--enable-source-maps", "--input-type=module", "--eval", options.source],
    options.cwd,
    options.env,
  ).pipe(Effect.mapError((cause) => fail("Node ESM smoke failed", cause)));

export const verifyNoInstalledLibrarySources = (project: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    for (const name of ["contracts", "sdk"]) {
      if (yield* fs.exists(path.join(project, "node_modules", "@askgina", name, "src"))) {
        return yield* fail(`@askgina/${name} installed raw source`);
      }
    }
  });

export const verifyNode24Consumer = (
  options: Readonly<{
    readonly node: string;
    readonly project: string;
    readonly env?: Record<string, string | undefined>;
  }>,
) =>
  Effect.gen(function* () {
    const version = (yield* commandOutput(
      options.node,
      ["--version"],
      options.project,
      options.env,
    )).trim();
    if (!NODE_24_VERSION.test(version)) {
      return yield* fail(`Node 24 is required for package verification; found ${version}`);
    }
    yield* verifyNoInstalledLibrarySources(options.project);
    yield* runNodeEsmSmoke({
      node: options.node,
      cwd: options.project,
      source: NODE_24_SMOKE,
      env: options.env,
    });
  });

const filesBelow = (directory: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const visit = (
      current: string,
      prefix: string,
    ): Effect.Effect<string[], ArtifactVerificationError> =>
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
              return yield* fail(`archive contains a symbolic link: ${relative}`);
            }
            const info = yield* fs
              .stat(absolute)
              .pipe(Effect.mapError((cause) => fail(`cannot inspect ${absolute}`, cause)));
            if (info.type === "Directory") return yield* visit(absolute, relative);
            if (info.type === "File") return [relative];
            return yield* fail(`archive contains unsupported content: ${relative}`);
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

const parseProofs = (value: unknown, label: string) =>
  Effect.gen(function* () {
    const entries = yield* requiredArray(value, label);
    return yield* Effect.forEach(entries, (entry, index) =>
      Effect.gen(function* () {
        const proof = yield* requiredObject(entry, `${label}[${index}]`);
        yield* exactKeys(proof, ["path", "sha256"], `${label}[${index}]`);
        const file = yield* requiredString(proof.path, `${label}[${index}].path`);
        const sha256 = yield* requiredString(proof.sha256, `${label}[${index}].sha256`);
        if (file.startsWith("/") || file.split(/[\\/]/u).includes("..") || !SHA_256.test(sha256)) {
          return yield* fail(`${label}[${index}] is unsafe`);
        }
        return { path: file, sha256 } satisfies FileProof;
      }),
    );
  });

const verifyProofs = (
  expected: readonly FileProof[],
  actual: readonly FileProof[],
  label: string,
) =>
  stableJson(expected) === stableJson(actual)
    ? Effect.void
    : Effect.fail(fail(`${label} file list or hash is mutated`));
const exactDirectory = (directory: string, expected: readonly string[], label: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const actual = yield* fs
      .readDirectory(directory)
      .pipe(Effect.mapError((cause) => fail(`cannot list ${label}`, cause)));
    if (actual.sort().join("\n") !== [...expected].sort().join("\n")) {
      return yield* fail(`${label} has missing or extra entries`);
    }
  });

export const verifyOpenAiArchivePayload = (directory: string) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    yield* exactDirectory(
      directory,
      [".codex-plugin", ".mcp.json", "assets", "skills"],
      "OpenAI archive root",
    );
    yield* exactDirectory(
      path.join(directory, ".codex-plugin"),
      ["plugin.json"],
      "OpenAI manifest directory",
    );
    yield* exactDirectory(path.join(directory, "assets"), OPENAI_ASSETS, "OpenAI assets directory");
    yield* exactDirectory(path.join(directory, "skills"), SKILLS, "OpenAI skills directory");
    yield* Effect.forEach(SKILLS, (skill) =>
      Effect.all(
        [
          exactDirectory(
            path.join(directory, "skills", skill),
            ["SKILL.md", "agents"],
            `OpenAI ${skill} skill directory`,
          ),
          exactDirectory(
            path.join(directory, "skills", skill, "agents"),
            ["openai.yaml"],
            `OpenAI ${skill} agents directory`,
          ),
        ],
        { concurrency: "unbounded" },
      ),
    );
    const expected = [
      ".codex-plugin/plugin.json",
      ".mcp.json",
      ...OPENAI_ASSETS.map((asset) => `assets/${asset}`),
      ...SKILLS.flatMap((skill) => [
        `skills/${skill}/SKILL.md`,
        `skills/${skill}/agents/openai.yaml`,
      ]),
    ].sort();
    const actual = [...(yield* filesBelow(directory))].sort();
    if (stableJson(actual) !== stableJson(expected)) {
      return yield* fail("OpenAI archive payload is not the exact lean host payload");
    }
  });
const compareBytes = (actual: string, expected: string, label: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const actualBytes = yield* fs
      .readFile(actual)
      .pipe(Effect.mapError((cause) => fail(`cannot read ${actual}`, cause)));
    const expectedBytes = yield* fs
      .readFile(expected)
      .pipe(Effect.mapError((cause) => fail(`cannot read ${expected}`, cause)));
    if (
      actualBytes.length !== expectedBytes.length ||
      actualBytes.some((byte, index) => byte !== expectedBytes[index])
    ) {
      return yield* fail(`${label} differs from the canonical regenerated artifact`);
    }
  });

export const snapshotArtifactInputs: {
  (
    destinationRoot: string,
    relativePaths: readonly string[],
  ): (
    sourceRoot: string,
  ) => Effect.Effect<undefined, ArtifactVerificationError, FileSystem.FileSystem | Path.Path>;
  (
    sourceRoot: string,
    destinationRoot: string,
    relativePaths: readonly string[],
  ): Effect.Effect<undefined, ArtifactVerificationError, FileSystem.FileSystem | Path.Path>;
} = Function.dual(
  3,
  (sourceRoot: string, destinationRoot: string, relativePaths: readonly string[]) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const sourceRootLink = yield* fs
        .readLink(sourceRoot)
        .pipe(Effect.match({ onFailure: () => false, onSuccess: () => true }));
      if (sourceRootLink) return yield* fail("artifact source root must not be a symbolic link");
      const sourceRootInfo = yield* fs
        .stat(sourceRoot)
        .pipe(Effect.mapError((cause) => fail("cannot inspect artifact source root", cause)));
      if (sourceRootInfo.type !== "Directory") {
        return yield* fail("artifact source root must be a directory");
      }
      yield* Effect.forEach(relativePaths, (relative) =>
        Effect.gen(function* () {
          if (
            relative.includes("\\") ||
            path.isAbsolute(relative) ||
            path.normalize(relative) !== relative ||
            relative
              .split("/")
              .some((segment) => segment.length === 0 || segment === "." || segment === "..")
          ) {
            return yield* fail(`artifact input path is unsafe: ${relative}`);
          }
          let sourceParent = sourceRoot;
          for (const segment of relative.split("/").slice(0, -1)) {
            sourceParent = path.join(sourceParent, segment);
            const parentLink = yield* fs
              .readLink(sourceParent)
              .pipe(Effect.match({ onFailure: () => false, onSuccess: () => true }));
            if (parentLink) {
              return yield* fail(`artifact input parent must not be a symbolic link: ${relative}`);
            }
            const parentInfo = yield* fs
              .stat(sourceParent)
              .pipe(
                Effect.mapError((cause) =>
                  fail(`cannot inspect artifact input parent for ${relative}`, cause),
                ),
              );
            if (parentInfo.type !== "Directory") {
              return yield* fail(`artifact input parent must be a directory: ${relative}`);
            }
          }
          const destination = path.join(destinationRoot, relative);
          yield* fs
            .makeDirectory(path.dirname(destination), { recursive: true })
            .pipe(
              Effect.mapError((cause) =>
                fail(`cannot create snapshot directory for ${relative}`, cause),
              ),
            );
          yield* copyCheckedRegularFile(path.join(sourceRoot, relative), destination).pipe(
            Effect.mapError((cause) => fail(`cannot snapshot ${relative}`, cause)),
          );
        }),
      );
    }),
);

const extract = (archive: string, destination: string) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    yield* extractCheckedTarGz(archive, destination).pipe(
      Effect.mapError((cause) => fail(`${path.basename(archive)} failed secure extraction`, cause)),
    );
  });

const verifyContract = (
  root: string,
  dist: string,
  version: string,
  sourceCommit: string,
  sourceDirty: boolean,
) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const receipt = yield* readJson(path.join(dist, "receipts/contract.json")).pipe(
      Effect.flatMap((value) => requiredObject(value, "contract receipt")),
    );
    yield* exactKeys(
      receipt,
      ["schemaVersion", "releaseVersion", "sourceCommit", "sourceDirty", "catalogSha", "files"],
      "contract receipt",
    );
    if (
      receipt.schemaVersion !== "v1" ||
      receipt.releaseVersion !== version ||
      receipt.sourceCommit !== sourceCommit
    ) {
      return yield* fail("contract receipt identity is stale");
    }
    yield* verifySourceDirty(receipt.sourceDirty, sourceDirty, "contract receipt sourceDirty");
    const source = yield* readText(path.join(root, "packages/contracts/src/index.ts"));
    const catalogSha = source.match(/export const catalogSha = "([a-f0-9]{64})"/u)?.[1];
    if (receipt.catalogSha !== catalogSha) return yield* fail("contract catalog SHA is stale");
    const proofs = yield* parseProofs(receipt.files, "contract receipt files");
    yield* verifyProofs(
      proofs,
      yield* fileProofs(path.join(root, "packages/contracts/dist"), "packages/contracts/dist"),
      "contract receipt",
    );
    return receipt;
  });

const expectedDependencies = (source: Record<string, unknown>, field: string, version: string) => {
  const value = source[field];
  if (!isObject(value)) return {};
  return Object.fromEntries(
    Object.entries(value).map(([name, range]) => [
      name,
      typeof range === "string" && range.startsWith("workspace:") ? version : range,
    ]),
  );
};
const proveExternalGraph = (rootLockFile: string, isolatedLockFile: string, label: string) =>
  Effect.gen(function* () {
    const rootLock = yield* readJsonc(rootLockFile).pipe(
      Effect.flatMap((value) => requiredObject(value, "root bun.lock")),
    );
    const isolatedLock = yield* readJsonc(isolatedLockFile).pipe(
      Effect.flatMap((value) => requiredObject(value, `${label} bun.lock`)),
    );
    const rootPackages = yield* requiredObject(rootLock.packages, "root bun.lock packages");
    const isolatedPackages = yield* requiredObject(
      isolatedLock.packages,
      `${label} bun.lock packages`,
    );
    for (const [name, resolution] of Object.entries(isolatedPackages)) {
      if (name.startsWith("@askgina/")) continue;
      if (stableJson(rootPackages[name]) !== stableJson(resolution)) {
        return yield* fail(`${label} external dependency ${name} is not proven by root bun.lock`);
      }
    }
  });
const lockfileVersionOverrides = (file: string, label: string) =>
  Effect.gen(function* () {
    const lock = yield* readJsonc(file).pipe(
      Effect.flatMap((value) => requiredObject(value, label)),
    );
    const packages = yield* requiredObject(lock.packages, `${label} packages`);
    const overrides: Record<string, string> = {};
    for (const [name, resolution] of Object.entries(packages)) {
      if (name.startsWith("@askgina/")) continue;
      if (!Array.isArray(resolution) || typeof resolution[0] !== "string") {
        return yield* fail(`${label} package ${name} has an invalid resolution`);
      }
      const prefix = `${name}@`;
      if (!resolution[0].startsWith(prefix)) {
        continue;
      }
      const version = resolution[0].slice(prefix.length);
      if (SEMVER.test(version)) overrides[name] = version;
    }
    return overrides;
  });

const cleanInstall = (
  definition: PackageDefinition,
  version: string,
  root: string,
  dist: string,
  temporary: string,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const closure = new Set<string>();
    const visit = (name: string): void => {
      const item = PACKAGES.find((candidate) => candidate.name === name);
      if (item === undefined || closure.has(name)) return;
      closure.add(name);
      for (const dependency of item.internal) visit(dependency);
    };
    visit(definition.name);
    const project = path.join(temporary, `install-${definition.slug}`);
    yield* fs
      .makeDirectory(project, { recursive: true })
      .pipe(
        Effect.mapError((cause) =>
          fail(`cannot create clean install for ${definition.name}`, cause),
        ),
      );
    const dependencies = Object.fromEntries(
      [...closure].sort().map((name) => {
        const item = PACKAGES.find((candidate) => candidate.name === name);
        return item === undefined
          ? [name, "invalid"]
          : [name, `file:${path.join(dist, "packages", `askgina-${item.slug}-${version}.tgz`)}`];
      }),
    );
    const rootManifest = yield* readJson(path.join(root, "package.json")).pipe(
      Effect.flatMap((value) => requiredObject(value, "root package metadata")),
    );
    const rootOverrides = yield* requiredStringRecord(
      rootManifest.overrides ?? {},
      "root package overrides",
    );
    const rootLockOverrides = yield* lockfileVersionOverrides(
      path.join(root, "bun.lock"),
      "root bun.lock",
    );
    const overrides = {
      ...rootLockOverrides,
      ...rootOverrides,
      ...Object.fromEntries(
        PACKAGES.filter((item) => item.name !== definition.name).map((item) => [
          item.name,
          `file:${path.join(dist, "packages", `askgina-${item.slug}-${version}.tgz`)}`,
        ]),
      ),
    };
    yield* fs
      .writeFileString(
        path.join(project, "package.json"),
        stableJson({
          name: "artifact-verification",
          private: true,
          dependencies,
          overrides,
        }),
      )
      .pipe(Effect.mapError((cause) => fail(`cannot write clean install manifest`, cause)));
    const home = path.join(project, ".home");
    yield* fs
      .makeDirectory(home, { recursive: true })
      .pipe(Effect.mapError((cause) => fail("cannot create clean install home", cause)));
    const originalHome = yield* Config.string("HOME");
    const packageCache = yield* Config.string("BUN_INSTALL_CACHE_DIR").pipe(
      Config.withDefault(path.join(originalHome, ".bun/install/cache")),
    );
    if (!(yield* fs.exists(packageCache))) {
      return yield* fail("offline Bun package cache is unavailable");
    }
    const env = {
      PATH: yield* Config.string("PATH").pipe(Config.withDefault("/usr/bin:/bin")),
      HOME: home,
      BUN_INSTALL_CACHE_DIR: packageCache,
      NPM_CONFIG_USERCONFIG: path.join(project, "empty-npmrc"),
    };
    yield* runCommand(
      "bun",
      ["install", "--lockfile-only", "--offline", "--ignore-scripts"],
      project,
      env,
    ).pipe(
      Effect.mapError((cause) => fail(`${definition.name} lock graph resolution failed`, cause)),
    );
    yield* proveExternalGraph(
      path.join(root, "bun.lock"),
      path.join(project, "bun.lock"),
      definition.name,
    );
    yield* runCommand(
      "bun",
      ["install", "--frozen-lockfile", "--offline", "--ignore-scripts"],
      project,
      env,
    ).pipe(
      Effect.mapError((cause) =>
        fail(`${definition.name} failed a frozen offline temporary install`, cause),
      ),
    );
    yield* runCommand("bun", ["-e", `await import("${definition.name}")`], project, env).pipe(
      Effect.mapError((cause) => fail(`${definition.name} failed a clean import`, cause)),
    );
    if (definition.name === "@askgina/evals") {
      yield* runCommand(
        "bun",
        [
          "-e",
          'import * as api from "@askgina/evals"; if (typeof api.runResponsesApiPluginEvalTrial !== "function" || typeof api.runCodexCliPluginEvalTrial !== "function") throw new Error("missing live eval adapters")',
        ],
        project,
        env,
      ).pipe(Effect.mapError((cause) => fail("@askgina/evals omitted live adapters", cause)));
      const evalPackageRoot = path.join(project, "node_modules", "@askgina", "evals");
      if (yield* fs.exists(path.join(evalPackageRoot, "src"))) {
        return yield* fail("@askgina/evals installed raw source");
      }
      const evalSourceRoot = path.join(root, "packages/evals/src");
      yield* runCommand(
        "bun",
        [
          path.join(evalPackageRoot, "dist/bin/replay.js"),
          "--suite",
          path.join(evalSourceRoot, "fixtures/model-smoke.yaml"),
          "--observations",
          path.join(evalSourceRoot, "fixtures/synthetic-observations.yaml"),
        ],
        project,
        env,
      ).pipe(Effect.mapError((cause) => fail("@askgina/evals replay entrypoint failed", cause)));
    }
    if (definition.name === "@askgina/cli") {
      const bin = path.join(project, "node_modules/.bin/ask-gina");
      yield* runCommand("bun", [bin, "--help"], project, env).pipe(
        Effect.mapError((cause) => fail("ask-gina --help failed", cause)),
      );
      yield* runCommand("bun", [bin, "--version"], project, env).pipe(
        Effect.mapError((cause) => fail("ask-gina --version failed", cause)),
      );
    }
  });

const verifyPackages = (
  root: string,
  dist: string,
  version: string,
  sourceDirty: boolean,
  temporary: string,
) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const fs = yield* FileSystem.FileSystem;
    yield* exactDirectory(
      path.join(dist, "packages"),
      PACKAGES.map((item) => `askgina-${item.slug}-${version}.tgz`),
      "package artifacts",
    );
    const receipt = yield* readJson(path.join(dist, "receipts/packages.json")).pipe(
      Effect.flatMap((value) => requiredObject(value, "packages receipt")),
    );
    yield* exactKeys(
      receipt,
      ["schemaVersion", "releaseVersion", "sourceCommit", "sourceDirty", "packages"],
      "packages receipt",
    );
    const entries = yield* requiredArray(receipt.packages, "packages receipt packages");
    yield* verifySourceDirty(receipt.sourceDirty, sourceDirty, "packages receipt sourceDirty");
    if (receipt.schemaVersion !== "v1" || receipt.releaseVersion !== version) {
      return yield* fail("packages receipt release version is stale");
    }
    if (entries.length !== PACKAGES.length)
      return yield* fail("packages receipt has the wrong package count");
    yield* Effect.forEach(PACKAGES, (definition) =>
      Effect.gen(function* () {
        const entryValue = entries.find((item) => isObject(item) && item.name === definition.name);
        const entry = yield* requiredObject(entryValue, `${definition.name} receipt`);
        yield* exactKeys(
          entry,
          ["name", "version", "archive", "sha256", "files"],
          `${definition.name} receipt`,
        );
        const relativeArchive = `packages/askgina-${definition.slug}-${version}.tgz`;
        const archive = path.join(dist, relativeArchive);
        if (
          entry.version !== version ||
          entry.archive !== relativeArchive ||
          entry.sha256 !== (yield* hashFile(archive))
        ) {
          return yield* fail(`${definition.name} receipt is stale`);
        }
        const stage = path.join(temporary, `extract-${definition.slug}`);
        yield* extract(archive, stage);
        yield* verifyProofs(
          yield* parseProofs(entry.files, `${definition.name} receipt files`),
          yield* fileProofs(path.join(stage, "package"), "package"),
          definition.name,
        );
        const packedPath = path.join(stage, "package/package.json");
        const packedText = yield* readText(packedPath);
        const packed = yield* readJson(packedPath).pipe(
          Effect.flatMap((value) => requiredObject(value, `${definition.name} package metadata`)),
        );
        const source = yield* readJson(path.join(root, definition.directory, "package.json")).pipe(
          Effect.flatMap((value) => requiredObject(value, `${definition.name} source metadata`)),
        );
        if (
          packed.name !== definition.name ||
          packed.version !== version ||
          packedText.includes("workspace:")
        ) {
          return yield* fail(`${definition.name} package metadata is invalid`);
        }
        for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
          if (
            stableJson(packed[field] ?? {}) !==
            stableJson(expectedDependencies(source, field, version))
          ) {
            return yield* fail(`${definition.name} has undeclared or mutated ${field}`);
          }
        }
        const dependencies = isObject(packed.dependencies) ? packed.dependencies : {};
        const internal = Object.keys(dependencies)
          .filter((name) => name.startsWith("@askgina/"))
          .sort();
        if (internal.join("\n") !== [...definition.internal].sort().join("\n")) {
          return yield* fail(`${definition.name} dependency closure is wrong`);
        }
        const allowlist = Array.isArray(source.files)
          ? source.files.filter((item): item is string => typeof item === "string")
          : [];
        for (const file of yield* filesBelow(path.join(stage, "package"))) {
          if (
            file !== "package.json" &&
            !allowlist.some((entry) => file === entry || file.startsWith(`${entry}/`))
          ) {
            return yield* fail(`${definition.name} contains undeclared file ${file}`);
          }
        }
        yield* cleanInstall(definition, version, root, dist, temporary);
        yield* fs
          .exists(archive)
          .pipe(Effect.mapError((cause) => fail(`cannot access ${archive}`, cause)));
      }),
    );
    const nodeProject = path.join(temporary, "install-sdk");
    yield* verifyNode24Consumer({
      node: "node",
      project: nodeProject,
      env: {
        PATH: yield* Config.string("PATH").pipe(Config.withDefault("/usr/bin:/bin")),
        HOME: path.join(nodeProject, ".home"),
        LC_ALL: "C",
        TZ: "UTC",
      },
    });
  });

const verifyTargets = (
  root: string,
  dist: string,
  version: string,
  sourceDirty: boolean,
  temporary: string,
) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    yield* exactDirectory(
      path.join(dist, "targets"),
      HOSTS.map((host) => `ask-gina-${host}-${version}.tgz`),
      "target artifacts",
    );
    yield* exactDirectory(
      path.join(dist, "skills"),
      [`ask-gina-skills-${version}.tgz`],
      "skills artifacts",
    );
    const receipt = yield* readJson(path.join(dist, "receipts/targets.json")).pipe(
      Effect.flatMap((value) => requiredObject(value, "targets receipt")),
    );
    yield* exactKeys(
      receipt,
      [
        "schemaVersion",
        "releaseVersion",
        "sourceCommit",
        "sourceDirty",
        "skillSourceSha",
        "targets",
        "skillsCandidate",
      ],
      "targets receipt",
    );
    const targets = yield* requiredArray(receipt.targets, "targets receipt targets");
    yield* verifySourceDirty(receipt.sourceDirty, sourceDirty, "targets receipt sourceDirty");
    if (receipt.schemaVersion !== "v1" || receipt.releaseVersion !== version) {
      return yield* fail("targets receipt release version is stale");
    }
    if (targets.length !== HOSTS.length)
      return yield* fail("targets receipt has the wrong host count");
    yield* Effect.forEach(HOSTS, (host) =>
      Effect.gen(function* () {
        const entry = yield* requiredObject(
          targets.find((item) => isObject(item) && item.host === host),
          `${host} receipt`,
        );
        yield* exactKeys(
          entry,
          [
            "host",
            "version",
            "archive",
            "sha256",
            "skillSourceSha",
            "skills",
            "files",
            "conformance",
          ],
          `${host} receipt`,
        );
        const relativeArchive = `targets/ask-gina-${host}-${version}.tgz`;
        const archive = path.join(dist, relativeArchive);
        if (
          entry.version !== version ||
          entry.archive !== relativeArchive ||
          entry.sha256 !== (yield* hashFile(archive)) ||
          entry.skillSourceSha !== receipt.skillSourceSha
        ) {
          return yield* fail(`${host} receipt is stale`);
        }
        const stage = path.join(temporary, `target-${host}`);
        yield* extract(archive, stage);
        if (host === "openai") yield* verifyOpenAiArchivePayload(stage);
        yield* verifyProofs(
          yield* parseProofs(entry.files, `${host} receipt files`),
          yield* fileProofs(stage),
          host,
        );
        const manifestPath = TARGET_MANIFESTS[host];
        if (manifestPath === undefined) return yield* fail(`unknown target ${host}`);
        const manifest = yield* readJson(path.join(stage, manifestPath)).pipe(
          Effect.flatMap((value) => requiredObject(value, `${host} manifest`)),
        );
        const manifestVersion =
          host === "cursor"
            ? CURSOR_LISTING_VERSION
            : host === "openai"
              ? OPENAI_LISTING_VERSION
              : version;
        if (manifest.version !== manifestVersion) {
          return yield* fail(`${host} manifest version is wrong`);
        }
        yield* exactDirectory(path.join(stage, "skills"), SKILLS, `${host} skills`);
        const overlays = (yield* filesBelow(stage)).filter((file) =>
          file.endsWith("/agents/openai.yaml"),
        );
        if (host === "openai" ? overlays.length !== SKILLS.length : overlays.length !== 0) {
          return yield* fail(`${host} violates the OpenAI overlay rule`);
        }
        const report = yield* checkGeneratedTargetConformance(host, stage, {
          packageRoot: path.join(root, "plugins/ask-gina"),
        }).pipe(
          Effect.mapError((cause) => fail(`${host} archive conformance check failed`, cause)),
        );
        if (!report.passed) return yield* fail(`${host} archive payload is not conformant`);
        const conformance = yield* requiredObject(entry.conformance, `${host} conformance`);
        if (conformance.passed !== true) return yield* fail(`${host} is not conformant`);
      }),
    );
    const candidate = yield* requiredObject(receipt.skillsCandidate, "skills candidate receipt");
    yield* exactKeys(
      candidate,
      ["version", "archive", "sha256", "skills", "files"],
      "skills candidate receipt",
    );
    const archive = path.join(dist, `skills/ask-gina-skills-${version}.tgz`);
    if (
      candidate.version !== version ||
      candidate.archive !== `skills/ask-gina-skills-${version}.tgz` ||
      candidate.sha256 !== (yield* hashFile(archive))
    ) {
      return yield* fail("skills candidate receipt is stale");
    }
    const stage = path.join(temporary, "skills-candidate");
    yield* extract(archive, stage);
    yield* verifyProofs(
      yield* parseProofs(candidate.files, "skills candidate files"),
      yield* fileProofs(stage),
      "skills candidate",
    );
    yield* exactDirectory(stage, ["LICENSE", "README.md", ...SKILLS], "skills candidate root");
    if (
      (yield* filesBelow(stage)).some(
        (file) =>
          file.includes("/agents/") || file.includes("mcp.json") || file.includes("plugin.json"),
      )
    ) {
      return yield* fail("skills candidate contains host configuration");
    }
  });

const verifyEvals = (
  root: string,
  dist: string,
  version: string,
  sourceCommit: string,
  sourceDirty: boolean,
) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const receipt = yield* readJson(path.join(dist, "receipts/evals.json")).pipe(
      Effect.flatMap((value) => requiredObject(value, "evals receipt")),
    );
    yield* exactKeys(
      receipt,
      ["schemaVersion", "releaseVersion", "sourceCommit", "sourceDirty", "aggregate"],
      "evals receipt",
    );
    if (
      receipt.schemaVersion !== "v1" ||
      receipt.releaseVersion !== version ||
      receipt.sourceCommit !== sourceCommit
    ) {
      return yield* fail("evals receipt identity is stale");
    }
    yield* verifySourceDirty(receipt.sourceDirty, sourceDirty, "evals receipt sourceDirty");
    const aggregate = yield* requiredObject(receipt.aggregate, "eval aggregate");
    if (RAW_EVAL_FIELDS.test(stableJson(receipt)))
      return yield* fail("evals receipt contains forbidden raw fields");
    const result = yield* runHermeticEvalReplay({
      suitePath: path.join(root, "plugins/ask-gina/evals/model/v1/smoke.yaml"),
      observationsPath: path.join(
        root,
        "plugins/ask-gina/evals/model/v1/fixtures/synthetic-observations.yaml",
      ),
    }).pipe(Effect.mapError((cause) => fail("hermetic eval verification failed", cause)));
    const expected = {
      suiteId: result.suiteId,
      suiteVersion: result.suiteVersion,
      fixtureVersion: result.fixtureVersion,
      catalogSha: result.catalogSha,
    };
    const sanitizedAggregate = yield* sanitizeEvalAggregate(aggregate, expected).pipe(
      Effect.mapError((cause) => fail("eval aggregate contract is invalid", cause)),
    );
    if (stableJson(sanitizedAggregate) !== stableJson(aggregate)) {
      return yield* fail("eval aggregate is not canonical");
    }
    const regenerated = yield* sanitizeEvalReplay(result).pipe(
      Effect.mapError((cause) => fail("hermetic eval sanitization failed", cause)),
    );
    if (stableJson(regenerated) !== stableJson(aggregate)) {
      return yield* fail("evals receipt does not match hermetic replay");
    }
  });

const parseArgs = () => {
  const allowed = new Set(["--packages", "--targets", "--evals"]);
  const selected = new Set<string>();
  for (const argument of process.argv.slice(2)) {
    if (!allowed.has(argument)) return Effect.fail(fail(`unknown argument: ${argument}`));
    if (selected.has(argument)) return Effect.fail(fail(`duplicate argument: ${argument}`));
    selected.add(argument);
  }
  if (selected.size === 0) for (const argument of allowed) selected.add(argument);
  return Effect.succeed(selected);
};

const program = Effect.scoped(
  Effect.gen(function* () {
    const selected = yield* parseArgs();
    const root = process.cwd();
    const path = yield* Path.Path;
    const fs = yield* FileSystem.FileSystem;
    const rootJson = yield* readJson(path.join(root, "package.json"));
    const version = yield* requiredString(
      isObject(rootJson) ? rootJson.version : undefined,
      "root package version",
    );
    if (!SEMVER.test(version)) return yield* fail("root package version must be valid SemVer");
    const dist = path.join(root, "dist");
    const sourceCommit = (yield* commandOutput(
      "git",
      ["rev-parse", "--verify", "HEAD"],
      root,
    )).trim();
    if (!GIT_COMMIT.test(sourceCommit)) return yield* fail("source commit is invalid");
    const sourceDirty = yield* commandHasBoundedOutput(
      "git",
      ["status", "--porcelain=v1", "--untracked-files=all", "--", "."],
      root,
      MAX_GIT_PORCELAIN_BYTES,
    );
    if (sourceDirty) return yield* fail("artifact source tree must be clean");
    const temporary = yield* fs
      .makeTempDirectoryScoped({ prefix: "askgina-verify-" })
      .pipe(Effect.mapError((cause) => fail("cannot create verification directory", cause)));
    const selectedArtifacts = ["receipts/contract.json"];
    if (selected.has("--packages")) {
      selectedArtifacts.push(
        "receipts/packages.json",
        ...PACKAGES.map((item) => `packages/askgina-${item.slug}-${version}.tgz`),
      );
    }
    if (selected.has("--targets")) {
      selectedArtifacts.push(
        "receipts/targets.json",
        ...HOSTS.map((host) => `targets/ask-gina-${host}-${version}.tgz`),
        `skills/ask-gina-skills-${version}.tgz`,
      );
    }
    if (selected.has("--evals")) selectedArtifacts.push("receipts/evals.json");
    if (selected.has("--packages")) {
      yield* exactDirectory(
        path.join(dist, "packages"),
        PACKAGES.map((item) => `askgina-${item.slug}-${version}.tgz`),
        "package artifacts",
      );
    }
    if (selected.has("--targets")) {
      yield* exactDirectory(
        path.join(dist, "targets"),
        HOSTS.map((host) => `ask-gina-${host}-${version}.tgz`),
        "target artifacts",
      );
      yield* exactDirectory(
        path.join(dist, "skills"),
        [`ask-gina-skills-${version}.tgz`],
        "skills artifacts",
      );
    }
    if (selected.size === 3) {
      yield* exactDirectory(
        path.join(dist, "receipts"),
        ["contract.json", "packages.json", "targets.json", "evals.json"],
        "artifact receipts",
      );
    }
    const artifactSnapshot = path.join(temporary, "artifact-inputs");
    yield* snapshotArtifactInputs(dist, artifactSnapshot, selectedArtifacts);
    const regenerated = path.join(temporary, "canonical-dist");
    yield* buildArtifacts({ root, dist: regenerated }).pipe(
      Effect.mapError((cause) => fail("cannot regenerate canonical artifacts", cause)),
    );
    yield* Effect.forEach(selectedArtifacts, (relative) =>
      compareBytes(
        path.join(artifactSnapshot, relative),
        path.join(regenerated, relative),
        relative,
      ),
    );
    yield* verifyContract(root, artifactSnapshot, version, sourceCommit, sourceDirty);
    if (selected.has("--packages")) {
      yield* verifyPackages(root, artifactSnapshot, version, sourceDirty, temporary);
    }
    if (selected.has("--targets")) {
      yield* verifyTargets(root, artifactSnapshot, version, sourceDirty, temporary);
    }
    if (selected.has("--evals")) {
      yield* verifyEvals(root, artifactSnapshot, version, sourceCommit, sourceDirty);
    }
    if (selected.size === 3) {
      yield* exactDirectory(
        path.join(artifactSnapshot, "receipts"),
        ["contract.json", "packages.json", "targets.json", "evals.json"],
        "artifact receipts",
      );
    }
  }),
);

const main = Layer.build(BunServices.layer).pipe(
  Effect.flatMap((context) => program.pipe(Effect.provide(context))),
  Effect.scoped,
);

if (import.meta.main) BunRuntime.runMain(main);
