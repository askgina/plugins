#!/usr/bin/env bun

import { fileURLToPath } from "node:url";

import { ASK_GINA_SKILL_DEFINITIONS, READ_SCOPE } from "@askgina/contracts";
import { Data, Effect, Exit, FileSystem, Function, Path, PlatformError, Schema } from "effect";

import {
  HOST_TARGETS,
  hostsOf,
  loadPluginSource,
  skillIdsOf,
  type HostTarget,
  type PluginSource,
} from "./plugin-manifests";

/** Every host a package can publish for. A package publishes the subset `targetsForPackage` returns. */
export const TARGET_NAMES = HOST_TARGETS;
export type TargetName = HostTarget;
/** Skill ids of the read-only `ask-gina` listing, as defined by the public contract. */
export const SKILL_NAMES = ASK_GINA_SKILL_DEFINITIONS.map((skill) => skill.name);

const OPENAI_METADATA_PATH = ["agents", "openai.yaml"] as const;
const OPENAI_SOURCE_ENTRIES = [".codex-plugin", ".mcp.json", "assets"] as const;
const CURSOR_BASE_ENTRIES = [".cursor-plugin", "mcp.json", "assets", "README.md"] as const;
/** Cursor extras a package may ship beside its manifest. They are copied when present. */
const CURSOR_OPTIONAL_ENTRIES = ["rules", "commands"] as const;
const DEVIN_SOURCE_ENTRIES = [".devin-plugin", ".mcp.json", "assets/icon.svg"] as const;
const here = fileURLToPath(new URL(".", import.meta.url));

type SyncEnvironment = FileSystem.FileSystem | Path.Path;

export interface GeneratedPluginTarget {
  readonly target: TargetName;
  readonly path: string;
  readonly cleanup: Effect.Effect<void, PluginSkillSyncError, FileSystem.FileSystem>;
}

export interface GeneratedPluginTargets {
  readonly path: string;
  /** Hosts the package publishes for, in `TARGET_NAMES` order. */
  readonly hosts: readonly TargetName[];
  /** Generated tree per published host. Hosts the package does not publish are absent. */
  readonly targets: Readonly<Partial<Record<TargetName, string>>>;
  readonly cleanup: Effect.Effect<void, PluginSkillSyncError, FileSystem.FileSystem>;
}

export interface SyncPluginSkillsOptions {
  /** Package directory to generate from. Defaults to `plugins/ask-gina`. */
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

/**
 * True when the listing's only scope is `tools:read`. A read-only listing carries invariants a
 * write-capable listing does not: it declares exactly the contract skills, ships the Cursor
 * read-only rule and ships one Cursor command per skill.
 */
export const isReadOnlyListing = (source: PluginSource): boolean =>
  source.mcp.scopes.length === 1 && source.mcp.scopes[0] === READ_SCOPE;

const withFileSystemError = <A>(
  path: string,
  reason: string,
  effect: Effect.Effect<A, PlatformError.PlatformError>,
): Effect.Effect<A, PluginSkillSyncError> =>
  effect.pipe(Effect.mapError((cause) => pluginSkillSyncError(path, reason, cause)));

interface PackageContext {
  readonly packageRoot: string;
  readonly source: PluginSource;
  readonly hosts: readonly TargetName[];
}

const loadSource = (
  packageRoot: string,
): Effect.Effect<PluginSource, PluginSkillSyncError, SyncEnvironment> =>
  Effect.gen(function* () {
    const paths = yield* Path.Path;
    return yield* loadPluginSource(packageRoot).pipe(
      Effect.mapError((cause) =>
        pluginSkillSyncError(
          paths.join(packageRoot, "plugin.yaml"),
          "plugin.yaml is unreadable",
          cause,
        ),
      ),
    );
  });

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

/** A required source file: not a symbolic link, a regular file, and valid JSON when it is `.json`. */
const assertRegularSourceFile = (
  candidate: string,
  label: "OpenAI" | "Cursor",
): Effect.Effect<void, PluginSkillSyncError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const symbolicLink = yield* fs
      .readLink(candidate)
      .pipe(Effect.match({ onFailure: () => false, onSuccess: () => true }));
    if (symbolicLink) {
      return yield* pluginSkillSyncError(
        candidate,
        "plugin source must not contain symbolic links",
      );
    }
    const info = yield* withFileSystemError(candidate, "cannot be inspected", fs.stat(candidate));
    if (info.type !== "File") {
      return yield* pluginSkillSyncError(candidate, `required ${label} source file is not a file`);
    }
    if (candidate.endsWith(".json")) {
      const source = yield* withFileSystemError(
        candidate,
        "cannot be read",
        fs.readFileString(candidate),
      );
      yield* parseJson(candidate, source);
    }
  });

/** Cursor extras (`rules`, `commands`) the package ships, in `CURSOR_OPTIONAL_ENTRIES` order. */
const presentCursorExtras = (
  packageRoot: string,
): Effect.Effect<readonly string[], PluginSkillSyncError, SyncEnvironment> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;
    const present = yield* Effect.forEach(CURSOR_OPTIONAL_ENTRIES, (entry) => {
      const candidate = paths.join(packageRoot, entry);
      return withFileSystemError(candidate, "cannot be inspected", fs.exists(candidate)).pipe(
        Effect.map((exists) => (exists ? [entry] : [])),
      );
    });
    return present.flat();
  });

const assertSourceIsPortable = (
  packageRoot: string,
  source: PluginSource,
): Effect.Effect<void, PluginSkillSyncError, SyncEnvironment> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;
    const skillIds = skillIdsOf(source);
    const hosts = hostsOf(source);
    const readOnly = isReadOnlyListing(source);

    // A read-only listing publishes exactly the contract skills; a write-capable one declares its own.
    if (readOnly) {
      const contract = [...SKILL_NAMES].sort();
      if (skillIds.length !== contract.length || skillIds.some((id, i) => id !== contract[i])) {
        return yield* pluginSkillSyncError(
          paths.join(packageRoot, "plugin.yaml"),
          `Canonical skill set mismatch: plugin.yaml declares [${skillIds.join(", ")}], the contract defines [${contract.join(", ")}]`,
        );
      }
    }

    const canonicalSkills = paths.join(packageRoot, "skills");
    yield* assertDirectoryNames(canonicalSkills, skillIds);
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

    const legacyDevinOverlay = paths.join(packageRoot, "targets", "devin");
    const legacyDevinOverlayExists = yield* withFileSystemError(
      legacyDevinOverlay,
      "cannot be inspected",
      fs.exists(legacyDevinOverlay),
    );
    if (legacyDevinOverlayExists) {
      return yield* pluginSkillSyncError(
        legacyDevinOverlay,
        "legacy Devin target overlay must not exist",
      );
    }

    const openAiFiles = [
      paths.join(packageRoot, ".codex-plugin", "plugin.json"),
      paths.join(packageRoot, ".mcp.json"),
      paths.join(packageRoot, "assets", "icon.svg"),
    ] as const;
    yield* Effect.forEach(openAiFiles, (candidate) => assertRegularSourceFile(candidate, "OpenAI"));
    yield* assertNoSymbolicLinks(paths.join(packageRoot, ".codex-plugin"));
    yield* assertNoSymbolicLinks(paths.join(packageRoot, "assets"));

    const cursorFiles = [
      paths.join(packageRoot, ".cursor-plugin", "plugin.json"),
      paths.join(packageRoot, "mcp.json"),
      paths.join(packageRoot, "README.md"),
      ...(readOnly
        ? [
            paths.join(packageRoot, "rules", "gina-read-only.mdc"),
            ...skillIds.map((id) => paths.join(packageRoot, "commands", `${id}.md`)),
          ]
        : []),
    ];
    yield* Effect.forEach(cursorFiles, (candidate) => assertRegularSourceFile(candidate, "Cursor"));
    yield* assertNoSymbolicLinks(paths.join(packageRoot, ".cursor-plugin"));
    yield* Effect.forEach(yield* presentCursorExtras(packageRoot), (entry) =>
      assertNoSymbolicLinks(paths.join(packageRoot, entry)),
    );

    if (hosts.includes("devin")) {
      const devinManifest = paths.join(packageRoot, ".devin-plugin", "plugin.json");
      const devinManifestInfo = yield* withFileSystemError(
        devinManifest,
        "cannot be inspected",
        fs.stat(devinManifest),
      );
      if (devinManifestInfo.type !== "File") {
        return yield* pluginSkillSyncError(devinManifest, "required Devin manifest is not a file");
      }
      yield* withFileSystemError(
        devinManifest,
        "cannot be read",
        fs.readFileString(devinManifest),
      ).pipe(Effect.flatMap((manifestSource) => parseJson(devinManifest, manifestSource)));
      yield* assertNoSymbolicLinks(paths.join(packageRoot, ".devin-plugin"));
    }

    yield* Effect.forEach(
      hosts.filter((target) => target !== "openai" && target !== "cursor" && target !== "devin"),
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
      skillIds,
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

const copyRootSourceSurfaces = (
  packageRoot: string,
  destination: string,
  entries: readonly string[],
): Effect.Effect<void, PluginSkillSyncError, SyncEnvironment> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;
    yield* Effect.forEach(entries, (entry) => {
      const source = paths.join(packageRoot, entry);
      return withFileSystemError(
        source,
        "cannot be copied",
        fs.copy(source, paths.join(destination, entry), { overwrite: false }),
      );
    });
  });

/**
 * Copies every canonical skill directory except its host metadata directory, so a skill that ships
 * a README or scripts keeps them on every host. Only the OpenAI tree receives `agents/openai.yaml`.
 */
const copyCanonicalSkills = (
  context: PackageContext,
  target: TargetName,
  destination: string,
): Effect.Effect<void, PluginSkillSyncError, SyncEnvironment> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;
    const [metadataDirectory] = OPENAI_METADATA_PATH;
    yield* Effect.forEach(skillIdsOf(context.source), (skill) =>
      Effect.gen(function* () {
        const canonicalDirectory = paths.join(context.packageRoot, "skills", skill);
        const generatedDirectory = paths.join(destination, "skills", skill);
        yield* withFileSystemError(
          generatedDirectory,
          "cannot be created",
          fs.makeDirectory(generatedDirectory, { recursive: true }),
        );
        const entries = yield* withFileSystemError(
          canonicalDirectory,
          "cannot be read",
          fs.readDirectory(canonicalDirectory),
        );
        yield* Effect.forEach(
          entries.filter((entry) => entry !== metadataDirectory),
          (entry) => {
            const entrySource = paths.join(canonicalDirectory, entry);
            return withFileSystemError(
              entrySource,
              "cannot be copied",
              fs.copy(entrySource, paths.join(generatedDirectory, entry), { overwrite: false }),
            );
          },
        );

        if (target === "openai") {
          const metadataSource = paths.join(canonicalDirectory, ...OPENAI_METADATA_PATH);
          const generatedMetadataDirectory = paths.join(generatedDirectory, "agents");
          yield* withFileSystemError(
            generatedMetadataDirectory,
            "cannot be created",
            fs.makeDirectory(generatedMetadataDirectory, { recursive: true }),
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
  context: PackageContext,
): Effect.Effect<void, PluginSkillSyncError, SyncEnvironment> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;
    const { packageRoot } = context;

    yield* withFileSystemError(
      destination,
      "cannot be created",
      fs.makeDirectory(destination, { recursive: true }),
    );

    if (target === "openai") {
      yield* copyRootSourceSurfaces(packageRoot, destination, OPENAI_SOURCE_ENTRIES);
    } else if (target === "cursor") {
      yield* copyRootSourceSurfaces(packageRoot, destination, [
        ...CURSOR_BASE_ENTRIES,
        ...(yield* presentCursorExtras(packageRoot)),
      ]);
    } else if (target === "devin") {
      yield* copyRootSourceSurfaces(packageRoot, destination, DEVIN_SOURCE_ENTRIES);
    } else {
      yield* copyTargetOverlay(paths.join(packageRoot, "targets", target), destination);
    }
    yield* copyCanonicalSkills(context, target, destination);
  });

/** Loads the package's plugin.yaml and proves its source tree is portable before anything is generated. */
const preparePackage = (
  options: SyncPluginSkillsOptions,
): Effect.Effect<PackageContext, PluginSkillSyncError, SyncEnvironment> =>
  Effect.gen(function* () {
    const paths = yield* Path.Path;
    const packageRoot = packageRootFor(paths, options.packageRoot);
    const source = yield* loadSource(packageRoot);
    yield* assertSourceIsPortable(packageRoot, source);
    return { packageRoot, source, hosts: hostsOf(source) };
  });

/** Hosts the package publishes for, from its plugin.yaml. Defaults to `plugins/ask-gina`. */
export const targetsForPackage = (
  options: SyncPluginSkillsOptions = {},
): Effect.Effect<readonly TargetName[], PluginSkillSyncError, SyncEnvironment> =>
  Effect.gen(function* () {
    const paths = yield* Path.Path;
    return hostsOf(yield* loadSource(packageRootFor(paths, options.packageRoot)));
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
      const context = yield* preparePackage(options);
      if (!context.hosts.includes(target)) {
        return yield* pluginSkillSyncError(
          context.packageRoot,
          `${context.source.name} does not publish the ${target} target`,
        );
      }
      const prefix = `${context.source.name}-${target}-`;
      const root = yield* withFileSystemError(
        prefix,
        "cannot create temporary target directory",
        fs.makeTempDirectory({ prefix }),
      );
      const cleanup = cleanupDirectory(root);

      yield* materializeTarget(target, root, context).pipe(
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
    const context = yield* preparePackage(options);
    const prefix = `${context.source.name}-targets-`;
    const root = yield* withFileSystemError(
      prefix,
      "cannot create temporary target directory",
      fs.makeTempDirectory({ prefix }),
    );
    const cleanup = cleanupDirectory(root);
    const targets: Partial<Record<TargetName, string>> = {};

    yield* Effect.forEach(context.hosts, (target) => {
      const targetPath = paths.join(root, target);
      return materializeTarget(target, targetPath, context).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            targets[target] = targetPath;
          }),
        ),
      );
    }).pipe(
      Effect.onExit((exit) => (Exit.isSuccess(exit) ? Effect.void : cleanup.pipe(Effect.orDie))),
    );

    return { path: root, hosts: context.hosts, targets, cleanup };
  });

export const syncPluginSkills = createGeneratedPluginTargets;
