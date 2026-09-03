#!/usr/bin/env bun

import { fileURLToPath } from "node:url";

import { ASK_GINA_SKILL_DEFINITIONS } from "@askgina/contracts";
import { Data, Effect, Exit, FileSystem, Function, Path, PlatformError, Schema } from "effect";

export const TARGET_NAMES = ["openai", "cursor", "claude", "copilot", "gemini"] as const;
export type TargetName = (typeof TARGET_NAMES)[number];
export const SKILL_NAMES = ASK_GINA_SKILL_DEFINITIONS.map((skill) => skill.name);

const OPENAI_METADATA_PATH = ["agents", "openai.yaml"] as const;
const OPENAI_SOURCE_ENTRIES = [".codex-plugin", ".mcp.json", "assets"] as const;
const CURSOR_SOURCE_ENTRIES = [
  ".cursor-plugin",
  "mcp.json",
  "assets",
  "README.md",
  "rules",
  "commands",
] as const;
const here = fileURLToPath(new URL(".", import.meta.url));

type SyncEnvironment = FileSystem.FileSystem | Path.Path;

export interface GeneratedPluginTarget {
  readonly target: TargetName;
  readonly path: string;
  readonly cleanup: Effect.Effect<void, PluginSkillSyncError, FileSystem.FileSystem>;
}

export interface GeneratedPluginTargets {
  readonly path: string;
  readonly targets: Readonly<Record<TargetName, string>>;
  readonly cleanup: Effect.Effect<void, PluginSkillSyncError, FileSystem.FileSystem>;
}

export interface SyncPluginSkillsOptions {
  readonly packageRoot?: string;
}

export class PluginSkillSyncError extends Data.TaggedError("PluginSkillSyncError")<{
  readonly path: string;
  readonly reason: string;
  readonly cause?: unknown;
}> {}

const pluginSkillSyncError = (
  path: string,
  reason: string,
  cause?: unknown,
): PluginSkillSyncError =>
  new PluginSkillSyncError(cause === undefined ? { path, reason } : { path, reason, cause });

const packageRootFor = (paths: Path.Path, packageRoot?: string): string =>
  paths.resolve(packageRoot ?? paths.join(here, "..", "plugins", "ask-gina"));

const withFileSystemError = <A>(
  path: string,
  reason: string,
  effect: Effect.Effect<A, PlatformError.PlatformError>,
): Effect.Effect<A, PluginSkillSyncError> =>
  effect.pipe(Effect.mapError((cause) => pluginSkillSyncError(path, reason, cause)));

const assertDirectoryNames = (
  directory: string,
  expected: readonly string[],
): Effect.Effect<void, PluginSkillSyncError, SyncEnvironment> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;
    const entries = yield* withFileSystemError(
      directory,
      "cannot be read",
      fs.readDirectory(directory),
    );
    const actual = [...entries].sort();
    const wanted = [...expected].sort();
    const missing = wanted.filter((name) => !actual.includes(name));
    const extra = actual.filter((name) => !wanted.includes(name));
    const nonDirectories = yield* Effect.forEach(
      wanted.filter((name) => actual.includes(name)),
      (name) => {
        const candidate = paths.join(directory, name);
        return withFileSystemError(candidate, "cannot be inspected", fs.stat(candidate)).pipe(
          Effect.map((info) => (info.type === "Directory" ? undefined : name)),
        );
      },
      { concurrency: "unbounded" },
    );
    const nonDirectoryNames = nonDirectories.filter((name): name is string => name !== undefined);

    if (missing.length > 0 || extra.length > 0 || nonDirectoryNames.length > 0) {
      return yield* pluginSkillSyncError(
        directory,
        `Canonical skill set mismatch: missing [${missing.join(", ")}], extra [${extra.join(", ")}], non-directories [${nonDirectoryNames.join(", ")}]`,
      );
    }
  });

const parseJson = (path: string, source: string): Effect.Effect<void, PluginSkillSyncError> =>
  Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(source).pipe(
    Effect.mapError((cause) => pluginSkillSyncError(path, "contains invalid JSON", cause)),
    Effect.asVoid,
  );

const assertNoSymbolicLinks = (
  directory: string,
): Effect.Effect<void, PluginSkillSyncError, SyncEnvironment> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;
    const entries = yield* withFileSystemError(
      directory,
      "cannot be read",
      fs.readDirectory(directory),
    );

    yield* Effect.forEach(
      entries,
      (entry) =>
        Effect.gen(function* () {
          const entryPath = paths.join(directory, entry);
          const symbolicLink = yield* fs
            .readLink(entryPath)
            .pipe(Effect.match({ onFailure: () => false, onSuccess: () => true }));
          if (symbolicLink) {
            return yield* pluginSkillSyncError(
              entryPath,
              "plugin source must not contain symbolic links",
            );
          }

          const info = yield* withFileSystemError(
            entryPath,
            "cannot be inspected",
            fs.stat(entryPath),
          );
          if (info.type === "Directory") return yield* assertNoSymbolicLinks(entryPath);
          if (entry.endsWith(".json")) {
            const source = yield* withFileSystemError(
              entryPath,
              "cannot be read",
              fs.readFileString(entryPath),
            );
            yield* parseJson(entryPath, source);
          }
        }),
      { concurrency: "unbounded" },
    );
  });

const assertSourceIsPortable = (
  packageRoot: string,
): Effect.Effect<void, PluginSkillSyncError, SyncEnvironment> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;
    const canonicalSkills = paths.join(packageRoot, "skills");
    yield* assertDirectoryNames(canonicalSkills, SKILL_NAMES);
    yield* assertNoSymbolicLinks(canonicalSkills);

    const legacyOpenAiOverlay = paths.join(packageRoot, "targets", "openai");
    const legacyOpenAiOverlayExists = yield* withFileSystemError(
      legacyOpenAiOverlay,
      "cannot be inspected",
      fs.exists(legacyOpenAiOverlay),
    );
    if (legacyOpenAiOverlayExists) {
      return yield* pluginSkillSyncError(
        legacyOpenAiOverlay,
        "legacy OpenAI target overlay must not exist",
      );
    }

    const legacyCursorOverlay = paths.join(packageRoot, "targets", "cursor");
    const legacyCursorOverlayExists = yield* withFileSystemError(
      legacyCursorOverlay,
      "cannot be inspected",
      fs.exists(legacyCursorOverlay),
    );
    if (legacyCursorOverlayExists) {
      return yield* pluginSkillSyncError(
        legacyCursorOverlay,
        "legacy Cursor target overlay must not exist",
      );
    }

    const openAiFiles = [
      paths.join(packageRoot, ".codex-plugin", "plugin.json"),
      paths.join(packageRoot, ".mcp.json"),
      paths.join(packageRoot, "assets", "icon.svg"),
    ] as const;
    yield* Effect.forEach(openAiFiles, (candidate) =>
      Effect.gen(function* () {
        const symbolicLink = yield* fs
          .readLink(candidate)
          .pipe(Effect.match({ onFailure: () => false, onSuccess: () => true }));
        if (symbolicLink) {
          return yield* pluginSkillSyncError(
            candidate,
            "plugin source must not contain symbolic links",
          );
        }
        const info = yield* withFileSystemError(
          candidate,
          "cannot be inspected",
          fs.stat(candidate),
        );
        if (info.type !== "File") {
          return yield* pluginSkillSyncError(
            candidate,
            "required OpenAI source file is not a file",
          );
        }
        if (candidate.endsWith(".json")) {
          const source = yield* withFileSystemError(
            candidate,
            "cannot be read",
            fs.readFileString(candidate),
          );
          yield* parseJson(candidate, source);
        }
      }),
    );
    yield* assertNoSymbolicLinks(paths.join(packageRoot, ".codex-plugin"));
    yield* assertNoSymbolicLinks(paths.join(packageRoot, "assets"));

    const cursorFiles = [
      paths.join(packageRoot, ".cursor-plugin", "plugin.json"),
      paths.join(packageRoot, "mcp.json"),
      paths.join(packageRoot, "README.md"),
      paths.join(packageRoot, "rules", "gina-read-only.mdc"),
      paths.join(packageRoot, "commands", "review-gina-account.md"),
      paths.join(packageRoot, "commands", "research-spot-tokens.md"),
      paths.join(packageRoot, "commands", "research-hyperliquid.md"),
      paths.join(packageRoot, "commands", "research-prediction-markets.md"),
    ] as const;
    yield* Effect.forEach(cursorFiles, (candidate) =>
      Effect.gen(function* () {
        const symbolicLink = yield* fs
          .readLink(candidate)
          .pipe(Effect.match({ onFailure: () => false, onSuccess: () => true }));
        if (symbolicLink) {
          return yield* pluginSkillSyncError(
            candidate,
            "plugin source must not contain symbolic links",
          );
        }
        const info = yield* withFileSystemError(
          candidate,
          "cannot be inspected",
          fs.stat(candidate),
        );
        if (info.type !== "File") {
          return yield* pluginSkillSyncError(
            candidate,
            "required Cursor source file is not a file",
          );
        }
        if (candidate.endsWith(".json")) {
          const source = yield* withFileSystemError(
            candidate,
            "cannot be read",
            fs.readFileString(candidate),
          );
          yield* parseJson(candidate, source);
        }
      }),
    );
    yield* assertNoSymbolicLinks(paths.join(packageRoot, ".cursor-plugin"));
    yield* assertNoSymbolicLinks(paths.join(packageRoot, "rules"));
    yield* assertNoSymbolicLinks(paths.join(packageRoot, "commands"));
    yield* Effect.forEach(
      TARGET_NAMES.filter((target) => target !== "openai" && target !== "cursor"),
      (target) =>
        Effect.gen(function* () {
          const overlay = paths.join(packageRoot, "targets", target);
          const exists = yield* withFileSystemError(
            overlay,
            "cannot be inspected",
            fs.exists(overlay),
          );
          if (!exists) {
            return yield* pluginSkillSyncError(overlay, "missing target overlay");
          }
          const info = yield* withFileSystemError(overlay, "cannot be inspected", fs.stat(overlay));
          if (info.type !== "Directory") {
            return yield* pluginSkillSyncError(overlay, "target overlay is not a directory");
          }
          yield* assertNoSymbolicLinks(overlay);
        }),
      { concurrency: "unbounded" },
    );

    yield* Effect.forEach(
      TARGET_NAMES,
      (target) => {
        const generatedSourcePath = paths.join(packageRoot, "targets", target, "skills");
        return withFileSystemError(
          generatedSourcePath,
          "cannot be inspected",
          fs.exists(generatedSourcePath),
        ).pipe(
          Effect.flatMap((exists) =>
            exists
              ? Effect.fail(
                  pluginSkillSyncError(
                    generatedSourcePath,
                    "generated skills must not be committed in plugin source",
                  ),
                )
              : Effect.void,
          ),
        );
      },
      { concurrency: "unbounded" },
    );

    yield* Effect.forEach(
      SKILL_NAMES,
      (skill) => {
        const skillDirectory = paths.join(canonicalSkills, skill);
        const skillFile = paths.join(skillDirectory, "SKILL.md");
        const openAiMetadata = paths.join(skillDirectory, ...OPENAI_METADATA_PATH);
        return Effect.all([
          withFileSystemError(skillFile, "cannot be inspected", fs.exists(skillFile)),
          withFileSystemError(openAiMetadata, "cannot be inspected", fs.exists(openAiMetadata)),
        ]).pipe(
          Effect.flatMap(([skillFileExists, metadataExists]) => {
            if (!skillFileExists) {
              return Effect.fail(pluginSkillSyncError(skillFile, "missing canonical skill file"));
            }
            return metadataExists
              ? Effect.void
              : Effect.fail(pluginSkillSyncError(openAiMetadata, "missing OpenAI skill metadata"));
          }),
        );
      },
      { concurrency: "unbounded" },
    );
  });

const copyTargetOverlay = (
  source: string,
  destination: string,
): Effect.Effect<void, PluginSkillSyncError, SyncEnvironment> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;
    yield* assertNoSymbolicLinks(source);
    const entries = yield* withFileSystemError(source, "cannot be read", fs.readDirectory(source));
    yield* Effect.forEach(
      entries,
      (entry) => {
        const entryPath = paths.join(source, entry);
        if (entry === "skills") {
          return Effect.fail(
            pluginSkillSyncError(entryPath, "source target overlay must not contain skills"),
          );
        }
        return withFileSystemError(
          entryPath,
          "cannot be copied",
          fs.copy(entryPath, paths.join(destination, entry), { overwrite: false }),
        );
      },
      { concurrency: "unbounded" },
    );
  });

const copyOpenAiSourceSurfaces = (
  packageRoot: string,
  destination: string,
): Effect.Effect<void, PluginSkillSyncError, SyncEnvironment> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;
    yield* Effect.forEach(OPENAI_SOURCE_ENTRIES, (entry) => {
      const source = paths.join(packageRoot, entry);
      return withFileSystemError(
        source,
        "cannot be copied",
        fs.copy(source, paths.join(destination, entry), { overwrite: false }),
      );
    });
  });

const copyCursorSourceSurfaces = (
  packageRoot: string,
  destination: string,
): Effect.Effect<void, PluginSkillSyncError, SyncEnvironment> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;
    yield* Effect.forEach(CURSOR_SOURCE_ENTRIES, (entry) => {
      const source = paths.join(packageRoot, entry);
      return withFileSystemError(
        source,
        "cannot be copied",
        fs.copy(source, paths.join(destination, entry), { overwrite: false }),
      );
    });
  });

const copyCanonicalSkills = (
  packageRoot: string,
  target: TargetName,
  destination: string,
): Effect.Effect<void, PluginSkillSyncError, SyncEnvironment> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;
    yield* Effect.forEach(SKILL_NAMES, (skill) =>
      Effect.gen(function* () {
        const canonicalDirectory = paths.join(packageRoot, "skills", skill);
        const generatedDirectory = paths.join(destination, "skills", skill);
        const skillSource = paths.join(canonicalDirectory, "SKILL.md");
        const skillDestination = paths.join(generatedDirectory, "SKILL.md");
        yield* withFileSystemError(
          generatedDirectory,
          "cannot be created",
          fs.makeDirectory(generatedDirectory, { recursive: true }),
        );
        yield* withFileSystemError(
          skillSource,
          "cannot be copied",
          fs.copyFile(skillSource, skillDestination),
        );

        if (target === "openai") {
          const metadataSource = paths.join(canonicalDirectory, ...OPENAI_METADATA_PATH);
          const metadataDirectory = paths.join(generatedDirectory, "agents");
          yield* withFileSystemError(
            metadataDirectory,
            "cannot be created",
            fs.makeDirectory(metadataDirectory, { recursive: true }),
          );
          yield* withFileSystemError(
            metadataSource,
            "cannot be copied",
            fs.copyFile(metadataSource, paths.join(generatedDirectory, ...OPENAI_METADATA_PATH)),
          );
        }
      }),
    );
  });

const materializeTarget = (
  target: TargetName,
  destination: string,
  options: SyncPluginSkillsOptions,
): Effect.Effect<void, PluginSkillSyncError, SyncEnvironment> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;
    const packageRoot = packageRootFor(paths, options.packageRoot);
    yield* assertSourceIsPortable(packageRoot);

    yield* withFileSystemError(
      destination,
      "cannot be created",
      fs.makeDirectory(destination, { recursive: true }),
    );

    if (target === "openai") {
      yield* copyOpenAiSourceSurfaces(packageRoot, destination);
    } else if (target === "cursor") {
      yield* copyCursorSourceSurfaces(packageRoot, destination);
    } else {
      yield* copyTargetOverlay(paths.join(packageRoot, "targets", target), destination);
    }
    yield* copyCanonicalSkills(packageRoot, target, destination);
  });

const cleanupDirectory = (
  path: string,
): Effect.Effect<void, PluginSkillSyncError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* withFileSystemError(
      path,
      "cannot be removed",
      fs.remove(path, { recursive: true, force: true }),
    );
  });

type GeneratedPluginTargetEffect = Effect.Effect<
  GeneratedPluginTarget,
  PluginSkillSyncError,
  SyncEnvironment
>;

export const createGeneratedPluginTarget: {
  (options?: SyncPluginSkillsOptions): (target: TargetName) => GeneratedPluginTargetEffect;
  (target: TargetName, options?: SyncPluginSkillsOptions): GeneratedPluginTargetEffect;
} = Function.dual(
  (args) => typeof args[0] === "string" && TARGET_NAMES.some((candidate) => candidate === args[0]),
  (target: TargetName, options: SyncPluginSkillsOptions = {}): GeneratedPluginTargetEffect =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* withFileSystemError(
        `ask-gina-${target}-`,
        "cannot create temporary target directory",
        fs.makeTempDirectory({ prefix: `ask-gina-${target}-` }),
      );
      const cleanup = cleanupDirectory(root);

      yield* materializeTarget(target, root, options).pipe(
        Effect.onExit((exit) => (Exit.isSuccess(exit) ? Effect.void : cleanup.pipe(Effect.orDie))),
      );
      return { target, path: root, cleanup };
    }),
);

export const createGeneratedPluginTargets = (
  options: SyncPluginSkillsOptions = {},
): Effect.Effect<GeneratedPluginTargets, PluginSkillSyncError, SyncEnvironment> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;
    const root = yield* withFileSystemError(
      "ask-gina-targets-",
      "cannot create temporary target directory",
      fs.makeTempDirectory({ prefix: "ask-gina-targets-" }),
    );
    const cleanup = cleanupDirectory(root);
    const targets: Record<TargetName, string> = {
      openai: "",
      cursor: "",
      claude: "",
      copilot: "",
      gemini: "",
    };

    yield* Effect.forEach(TARGET_NAMES, (target) => {
      const targetPath = paths.join(root, target);
      return materializeTarget(target, targetPath, options).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            targets[target] = targetPath;
          }),
        ),
      );
    }).pipe(
      Effect.onExit((exit) => (Exit.isSuccess(exit) ? Effect.void : cleanup.pipe(Effect.orDie))),
    );

    return { path: root, targets, cleanup };
  });

export const syncPluginSkills = createGeneratedPluginTargets;
