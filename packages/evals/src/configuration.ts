import { fileURLToPath } from "node:url";

import { ASK_GINA_SKILL_DEFINITIONS } from "@askgina/contracts";
import { Data, Effect, FileSystem, Function, Path, Schema } from "effect";

import { canonicalJsonSha256, sha256Hex } from "./canonical-json";
import type { LiveEvalRequestedRouting } from "./profile-identity";
import { LiveEvalRequestedRoutingSchema } from "./profile-identity";
import { SanitizedEvalRunReportSchema, type SanitizedEvalRunReport } from "./report";

const SHA256 = /^[a-f0-9]{64}$/u;
const MAX_STRING_LENGTH = 128;
const MAX_VERSION_LENGTH = 64;
const MAX_PACKAGE_ROOT_DEPTH = 12;
const MAX_INVENTORY_DIRECTORY_ENTRIES = 64;
const MAX_INVENTORY_FILE_BYTES = 8 * 1024 * 1024;
const SOURCE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.ts$/u;
const EXECUTABLE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.js$/u;
const BoundedString = Schema.NonEmptyString.check(Schema.isMaxLength(MAX_STRING_LENGTH));
const BoundedVersion = Schema.NonEmptyString.check(Schema.isMaxLength(MAX_VERSION_LENGTH));
const Sha256 = Schema.String.check(Schema.isPattern(SHA256));
const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0));
const UnknownObservationSchema = Schema.Struct({ availability: Schema.Literal("unknown") });
const RuntimePackageSchema = Schema.Struct({
  name: Schema.Literals(["ai", "@openrouter/ai-sdk-provider", "@ai-sdk/mcp"]),
  version: BoundedVersion,
  metadataSha256: Sha256,
  sourceSha256: Sha256,
  sourceScope: Schema.Literal("entrypoint"),
});
const utf8 = new TextDecoder("utf-8", { fatal: true });

const PACKAGE_INVENTORY_DIRECTORIES = [
  { relative: "src", segments: ["src"], kind: "source" },
  { relative: "src/bin", segments: ["src", "bin"], kind: "source" },
  { relative: "dist", segments: ["dist"], kind: "executable" },
  { relative: "dist/bin", segments: ["dist", "bin"], kind: "executable" },
] as const;

type InventoryFile = { readonly path: string; readonly sha256: string };
type PackageInventory = {
  readonly name: string;
  readonly files: readonly InventoryFile[];
};

export const LiveEvalConfigurationEvidenceSchema = Schema.Struct({
  schemaVersion: Schema.Literal("configuration-v1"),
  configurationSha256: Sha256,
  sourceReportSha256: Sha256,
  candidate: BoundedString,
  model: BoundedString,
  target: BoundedString,
  reasoning: Schema.NullOr(BoundedString),
  suiteId: BoundedString,
  suiteVersion: PositiveInt,
  fixtureVersion: PositiveInt,
  catalogSha: Sha256,
  settings: Schema.Struct({
    cleanChat: Schema.Literal(true),
    accountClass: BoundedString,
    repetitions: PositiveInt,
  }),
  identity: Schema.Struct({
    evaluatorSha256: Sha256,
    skillsSha256: Sha256,
    toolchainSha256: Sha256,
    runSettingsSha256: Sha256,
  }),
  requested: Schema.Struct({
    routing: LiveEvalRequestedRoutingSchema,
    reasoning: Schema.NullOr(Schema.Struct({ effort: BoundedString })),
    generationSteps: PositiveInt,
    injections: Schema.Struct({
      usageInclude: Schema.Literal(true),
      maxRetries: Schema.Literal(0),
    }),
    omissions: Schema.Struct({
      temperature: Schema.Literal("omitted"),
      top_p: Schema.Literal("omitted"),
      outputTokenLimit: Schema.Literal("omitted"),
      serviceTier: Schema.Literal("omitted"),
    }),
  }),
  runtime: Schema.Struct({
    bun: Schema.Struct({ version: BoundedVersion, executableSha256: Sha256 }),
    lockSha256: Sha256,
    packages: Schema.Tuple([RuntimePackageSchema, RuntimePackageSchema, RuntimePackageSchema]),
  }),
  budgets: Schema.Struct({
    generationSteps: PositiveInt,
    taskDeadlineMs: PositiveInt,
    evaluatorRecoveryDispatches: Schema.Literal(0),
    taskToolCalls: Schema.NullOr(PositiveInt),
  }),
  authentication: Schema.Struct({ class: Schema.Literal("openrouter-api-key") }),
  observed: Schema.Struct({
    model: UnknownObservationSchema,
    endpoint: UnknownObservationSchema,
    reasoning: UnknownObservationSchema,
    effectiveSettings: UnknownObservationSchema,
  }),
});

export type LiveEvalConfigurationEvidence = typeof LiveEvalConfigurationEvidenceSchema.Type;
type RuntimePackage = typeof RuntimePackageSchema.Type;

export interface LiveEvalConfigurationCaptureType {
  readonly evaluatorSha256: string;
  readonly skillsSha256: string;
  readonly toolchainSha256: string;
  readonly runtime: LiveEvalConfigurationEvidence["runtime"];
}

export class LiveEvalConfigurationCaptureError extends Data.TaggedError(
  "LiveEvalConfigurationCaptureError",
)<{
  readonly reason:
    | "invalid-input"
    | "metadata-unavailable"
    | "source-unavailable"
    | "output-conflict"
    | "output-exists"
    | "write-failed";
}> {}

const packageMetadataSchema = Schema.fromJsonString(
  Schema.Struct({ name: BoundedString, version: BoundedVersion }),
);

const sourceUnavailable = new LiveEvalConfigurationCaptureError({ reason: "source-unavailable" });
const metadataUnavailable = new LiveEvalConfigurationCaptureError({
  reason: "metadata-unavailable",
});

const isWithin = (path: Path.Path, parent: string, child: string): boolean => {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

const isSymlink = (fs: FileSystem.FileSystem, target: string): Effect.Effect<boolean> =>
  fs.readLink(target).pipe(Effect.match({ onFailure: () => false, onSuccess: () => true }));

const admitBunRuntime = (): Effect.Effect<
  { readonly version: string; readonly executable: string },
  LiveEvalConfigurationCaptureError
> =>
  Effect.gen(function* () {
    if (typeof Bun === "undefined") {
      return yield* new LiveEvalConfigurationCaptureError({ reason: "invalid-input" });
    }
    const version = Bun.version;
    const executable = process.execPath;
    if (version.length === 0 || version.length > MAX_VERSION_LENGTH || executable.length === 0) {
      return yield* new LiveEvalConfigurationCaptureError({ reason: "invalid-input" });
    }
    return { version, executable };
  });

const findPackageRoot = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  entrypoint: string,
  expectedName: string,
): Effect.Effect<string, LiveEvalConfigurationCaptureError> =>
  Effect.gen(function* () {
    let directory = path.dirname(entrypoint);
    for (let depth = 0; depth < MAX_PACKAGE_ROOT_DEPTH; depth += 1) {
      const metadataPath = path.join(directory, "package.json");
      if (yield* fs.exists(metadataPath).pipe(Effect.mapError(() => metadataUnavailable))) {
        const metadata = yield* fs.readFileString(metadataPath).pipe(
          Effect.flatMap(Schema.decodeEffect(packageMetadataSchema)),
          Effect.mapError(() => metadataUnavailable),
        );
        if (metadata.name === expectedName) return directory;
      }
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
    return yield* metadataUnavailable;
  });

const realRegularFile = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  root: string,
  candidate: string,
): Effect.Effect<string, LiveEvalConfigurationCaptureError> =>
  Effect.gen(function* () {
    if ((yield* isSymlink(fs, candidate)) || !isWithin(path, root, candidate)) {
      return yield* sourceUnavailable;
    }
    const info = yield* fs.stat(candidate).pipe(Effect.mapError(() => sourceUnavailable));
    if (
      info.type !== "File" ||
      Number(info.size) <= 0 ||
      Number(info.size) > MAX_INVENTORY_FILE_BYTES
    ) {
      return yield* sourceUnavailable;
    }
    const realPath = yield* fs.realPath(candidate).pipe(Effect.mapError(() => sourceUnavailable));
    if ((yield* isSymlink(fs, realPath)) || !isWithin(path, root, realPath)) {
      return yield* sourceUnavailable;
    }
    const realInfo = yield* fs.stat(realPath).pipe(Effect.mapError(() => sourceUnavailable));
    if (realInfo.type !== "File") return yield* sourceUnavailable;
    return realPath;
  });

const inventoryDirectory = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  packageRoot: string,
  relative: string,
  segments: readonly string[],
  kind: "source" | "executable",
): Effect.Effect<readonly InventoryFile[], LiveEvalConfigurationCaptureError> =>
  Effect.gen(function* () {
    const directory = path.join(packageRoot, ...segments);
    if (!(yield* fs.exists(directory).pipe(Effect.mapError(() => sourceUnavailable)))) {
      return [];
    }
    if (yield* isSymlink(fs, directory)) return yield* sourceUnavailable;
    const realDirectory = yield* fs
      .realPath(directory)
      .pipe(Effect.mapError(() => sourceUnavailable));
    if (!isWithin(path, packageRoot, realDirectory)) return yield* sourceUnavailable;
    const directoryInfo = yield* fs
      .stat(realDirectory)
      .pipe(Effect.mapError(() => sourceUnavailable));
    if (directoryInfo.type !== "Directory") return yield* sourceUnavailable;
    const names = yield* fs
      .readDirectory(realDirectory)
      .pipe(Effect.mapError(() => sourceUnavailable));
    if (names.length > MAX_INVENTORY_DIRECTORY_ENTRIES) return yield* sourceUnavailable;
    const pattern = kind === "source" ? SOURCE_FILE_NAME : EXECUTABLE_FILE_NAME;
    const selected = names
      .filter((name) => pattern.test(name))
      .sort((left, right) => left.localeCompare(right));
    return yield* Effect.forEach(
      selected,
      (name) =>
        Effect.gen(function* () {
          const candidate = path.join(realDirectory, name);
          const realFile = yield* realRegularFile(fs, path, realDirectory, candidate);
          if (!isWithin(path, packageRoot, realFile)) return yield* sourceUnavailable;
          const bytes = yield* fs.readFile(realFile).pipe(Effect.mapError(() => sourceUnavailable));
          if (bytes.byteLength === 0 || bytes.byteLength > MAX_INVENTORY_FILE_BYTES) {
            return yield* sourceUnavailable;
          }
          return { path: `${relative}/${name}`, sha256: sha256Hex(bytes) };
        }),
      { concurrency: "unbounded" },
    );
  });

// Bounded one-level src/dist listing only. No recursion, maps, d.ts, cwd, or home paths.
// Missing src is omitted (published dist-only trees). Missing dist/*.js fails closed.
const capturePackageInventory = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  packageRoot: string,
  name: string,
): Effect.Effect<PackageInventory, LiveEvalConfigurationCaptureError> =>
  Effect.gen(function* () {
    if (yield* isSymlink(fs, packageRoot)) return yield* sourceUnavailable;
    const realRoot = yield* fs.realPath(packageRoot).pipe(Effect.mapError(() => sourceUnavailable));
    const files = (yield* Effect.forEach(
      PACKAGE_INVENTORY_DIRECTORIES,
      (directory) =>
        inventoryDirectory(
          fs,
          path,
          realRoot,
          directory.relative,
          directory.segments,
          directory.kind,
        ),
      { concurrency: "unbounded" },
    ))
      .flat()
      .sort((left, right) => left.path.localeCompare(right.path));
    if (!files.some((file) => file.path.startsWith("dist/") && file.path.endsWith(".js"))) {
      return yield* sourceUnavailable;
    }
    return { name, files };
  });

const captureWorkspacePackage = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  name: string,
): Effect.Effect<PackageInventory, LiveEvalConfigurationCaptureError> =>
  Effect.gen(function* () {
    const resolved = yield* Effect.try({
      try: () => fileURLToPath(import.meta.resolve(name)),
      catch: () => sourceUnavailable,
    });
    const root = yield* findPackageRoot(fs, path, resolved, name);
    return yield* capturePackageInventory(fs, path, root, name);
  });

const findLockBytes = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  startDirectory: string,
): Effect.Effect<Uint8Array, LiveEvalConfigurationCaptureError> =>
  Effect.gen(function* () {
    let directory = startDirectory;
    for (let depth = 0; depth < MAX_PACKAGE_ROOT_DEPTH; depth += 1) {
      const candidate = path.join(directory, "bun.lock");
      if (yield* fs.exists(candidate).pipe(Effect.mapError(() => sourceUnavailable))) {
        const realFile = yield* realRegularFile(fs, path, directory, candidate);
        return yield* fs.readFile(realFile).pipe(Effect.mapError(() => sourceUnavailable));
      }
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
    return yield* sourceUnavailable;
  });

const capturePackage = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  name: RuntimePackage["name"],
): Effect.Effect<RuntimePackage, LiveEvalConfigurationCaptureError> =>
  Effect.gen(function* () {
    const resolved = yield* Effect.try({
      try: () => fileURLToPath(import.meta.resolve(name)),
      catch: () => sourceUnavailable,
    });
    const root = yield* findPackageRoot(fs, path, resolved, name);
    const metadataBytes = yield* fs
      .readFile(path.join(root, "package.json"))
      .pipe(Effect.mapError(() => metadataUnavailable));
    const metadataText = yield* Effect.try({
      try: () => utf8.decode(metadataBytes),
      catch: () => metadataUnavailable,
    });
    const metadata = yield* Schema.decodeEffect(packageMetadataSchema)(metadataText).pipe(
      Effect.mapError(() => metadataUnavailable),
    );
    if (metadata.name !== name) {
      return yield* metadataUnavailable;
    }
    const sourceBytes = yield* fs.readFile(resolved).pipe(Effect.mapError(() => sourceUnavailable));
    return {
      name,
      version: metadata.version,
      metadataSha256: sha256Hex(metadataBytes),
      sourceSha256: sha256Hex(sourceBytes),
      sourceScope: "entrypoint" as const,
    };
  });

export const captureOpenRouterConfiguration = (options: {
  readonly evaluatorEntrypointUrl: string;
}): Effect.Effect<
  LiveEvalConfigurationCaptureType,
  LiveEvalConfigurationCaptureError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const bun = yield* admitBunRuntime();
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const evaluatorPath = yield* Effect.try({
      try: () => fileURLToPath(options.evaluatorEntrypointUrl),
      catch: () => new LiveEvalConfigurationCaptureError({ reason: "invalid-input" }),
    });
    const evalsRoot = yield* findPackageRoot(fs, path, evaluatorPath, "@askgina/evals");
    const evaluatorInventory = yield* capturePackageInventory(
      fs,
      path,
      evalsRoot,
      "@askgina/evals",
    );
    const executableBytes = yield* fs
      .readFile(bun.executable)
      .pipe(Effect.mapError(() => sourceUnavailable));
    const lockBytes = yield* findLockBytes(fs, path, evalsRoot);
    const packages = yield* Effect.all(
      [
        capturePackage(fs, path, "ai"),
        capturePackage(fs, path, "@openrouter/ai-sdk-provider"),
        capturePackage(fs, path, "@ai-sdk/mcp"),
      ],
      { concurrency: "unbounded" },
    );
    const pluginEntrypoint = yield* Effect.try({
      try: () => fileURLToPath(import.meta.resolve("@askgina/plugin-core")),
      catch: () => sourceUnavailable,
    });
    const pluginRoot = yield* findPackageRoot(fs, path, pluginEntrypoint, "@askgina/plugin-core");
    const graphInventories = yield* Effect.all(
      [
        Effect.succeed(evaluatorInventory),
        captureWorkspacePackage(fs, path, "@askgina/contracts"),
        captureWorkspacePackage(fs, path, "@askgina/sdk"),
        capturePackageInventory(fs, path, pluginRoot, "@askgina/plugin-core"),
      ],
      { concurrency: "unbounded" },
    );
    const skillRecords = yield* Effect.forEach(
      [...ASK_GINA_SKILL_DEFINITIONS].sort((left, right) => left.name.localeCompare(right.name)),
      (skill) =>
        fs.readFile(path.join(pluginRoot, "skills", skill.name, "SKILL.md")).pipe(
          Effect.map((bytes) => ({ name: skill.name, sha256: sha256Hex(bytes) })),
          Effect.mapError(() => sourceUnavailable),
        ),
      { concurrency: "unbounded" },
    );
    const runtime = {
      bun: { version: bun.version, executableSha256: sha256Hex(executableBytes) },
      lockSha256: sha256Hex(lockBytes),
      packages,
    } satisfies LiveEvalConfigurationEvidence["runtime"];
    return {
      evaluatorSha256: canonicalJsonSha256({ packages: graphInventories }),
      skillsSha256: canonicalJsonSha256(skillRecords),
      toolchainSha256: canonicalJsonSha256(runtime),
      runtime,
    };
  });

const configurationIdentity = (evidence: LiveEvalConfigurationEvidence) => {
  const {
    configurationSha256: _configurationSha256,
    sourceReportSha256: _reportSha256,
    ...body
  } = evidence;
  return body;
};

const decodeReportContent = Schema.decodeEffect(
  Schema.fromJsonString(SanitizedEvalRunReportSchema),
  {
    errors: "all",
    onExcessProperty: "error",
  },
);

const reportIdentityConflictsEvidence = (
  report: SanitizedEvalRunReport,
  evidence: LiveEvalConfigurationEvidence,
): boolean =>
  report.candidate !== evidence.candidate ||
  report.model !== evidence.model ||
  report.target !== evidence.target ||
  (report.reasoning ?? null) !== evidence.reasoning ||
  report.aggregate.suiteId !== evidence.suiteId ||
  report.aggregate.suiteVersion !== evidence.suiteVersion ||
  report.aggregate.fixtureVersion !== evidence.fixtureVersion ||
  report.aggregate.catalogSha !== evidence.catalogSha ||
  report.cleanChat !== evidence.settings.cleanChat ||
  report.accountClass !== evidence.settings.accountClass ||
  report.repetitions !== evidence.settings.repetitions;

export const makeLiveEvalConfigurationEvidence = (options: {
  readonly report: SanitizedEvalRunReport;
  readonly reportContent: string;
  readonly requestedRouting: LiveEvalRequestedRouting;
  readonly maxSteps: number;
  readonly maxToolCalls?: number;
  readonly timeoutMs: number;
  readonly capture: LiveEvalConfigurationCaptureType;
}): LiveEvalConfigurationEvidence => {
  const reasoning = options.report.reasoning ?? null;
  const runSettings = {
    candidate: options.report.candidate,
    model: options.report.model,
    target: options.report.target,
    reasoning,
    suiteId: options.report.aggregate.suiteId,
    suiteVersion: options.report.aggregate.suiteVersion,
    fixtureVersion: options.report.aggregate.fixtureVersion,
    catalogSha: options.report.aggregate.catalogSha,
    settings: {
      cleanChat: options.report.cleanChat,
      accountClass: options.report.accountClass,
      repetitions: options.report.repetitions,
    },
    requested: {
      routing: options.requestedRouting,
      reasoning: reasoning === null ? null : { effort: reasoning },
      generationSteps: options.maxSteps,
      injections: {
        usageInclude: true as const,
        maxRetries: 0 as const,
      },
      omissions: {
        temperature: "omitted" as const,
        top_p: "omitted" as const,
        outputTokenLimit: "omitted" as const,
        serviceTier: "omitted" as const,
      },
    },
    budgets: {
      generationSteps: options.maxSteps,
      taskDeadlineMs: options.timeoutMs,
      evaluatorRecoveryDispatches: 0 as const,
      taskToolCalls: options.maxToolCalls ?? null,
    },
    authentication: { class: "openrouter-api-key" as const },
  };
  const body = {
    schemaVersion: "configuration-v1" as const,
    ...runSettings,
    identity: {
      evaluatorSha256: options.capture.evaluatorSha256,
      skillsSha256: options.capture.skillsSha256,
      toolchainSha256: options.capture.toolchainSha256,
      runSettingsSha256: canonicalJsonSha256(runSettings),
    },
    runtime: options.capture.runtime,
    observed: {
      model: { availability: "unknown" as const },
      endpoint: { availability: "unknown" as const },
      reasoning: { availability: "unknown" as const },
      effectiveSettings: { availability: "unknown" as const },
    },
  };
  return {
    ...body,
    configurationSha256: canonicalJsonSha256(body),
    sourceReportSha256: sha256Hex(options.reportContent),
  };
};

export const liveEvalConfigurationEvidenceOutputPath = Function.dual<
  (reportPath: string) => (path: Path.Path) => string,
  (path: Path.Path, reportPath: string) => string
>(2, (path, reportPath) => {
  const extension = path.extname(reportPath);
  const base = extension.length === 0 ? reportPath : reportPath.slice(0, -extension.length);
  return `${base}.configuration-v1.json`;
});

const encodeEvidence = Schema.encodeEffect(
  Schema.fromJsonString(LiveEvalConfigurationEvidenceSchema, { space: 2 }),
);

export const writeLiveEvalConfigurationEvidence = (options: {
  readonly outputPath: string;
  readonly reportPath: string;
  readonly reportContent: string;
  readonly evidence: LiveEvalConfigurationEvidence;
}): Effect.Effect<void, LiveEvalConfigurationCaptureError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const output = path.resolve(options.outputPath);
    const report = path.resolve(options.reportPath);
    const evidence = yield* Schema.decodeEffect(LiveEvalConfigurationEvidenceSchema, {
      errors: "all",
      onExcessProperty: "error",
    })(options.evidence).pipe(
      Effect.mapError(() => new LiveEvalConfigurationCaptureError({ reason: "invalid-input" })),
    );
    const decodedReport = yield* decodeReportContent(options.reportContent).pipe(
      Effect.mapError(() => new LiveEvalConfigurationCaptureError({ reason: "invalid-input" })),
    );
    if (
      output === report ||
      evidence.sourceReportSha256 !== sha256Hex(options.reportContent) ||
      evidence.configurationSha256 !== canonicalJsonSha256(configurationIdentity(evidence)) ||
      reportIdentityConflictsEvidence(decodedReport, evidence)
    ) {
      return yield* new LiveEvalConfigurationCaptureError({ reason: "output-conflict" });
    }
    if (
      yield* fs
        .exists(output)
        .pipe(
          Effect.mapError(() => new LiveEvalConfigurationCaptureError({ reason: "write-failed" })),
        )
    ) {
      return yield* new LiveEvalConfigurationCaptureError({ reason: "output-exists" });
    }
    const encoded = yield* encodeEvidence(evidence).pipe(
      Effect.mapError(() => new LiveEvalConfigurationCaptureError({ reason: "invalid-input" })),
    );
    yield* fs
      .makeDirectory(path.dirname(output), { recursive: true })
      .pipe(
        Effect.mapError(() => new LiveEvalConfigurationCaptureError({ reason: "write-failed" })),
      );
    yield* fs
      .writeFileString(output, `${encoded}\n`, { flag: "wx", mode: 0o600 })
      .pipe(
        Effect.mapError(() => new LiveEvalConfigurationCaptureError({ reason: "write-failed" })),
      );
  });
