import { fileURLToPath } from "node:url";

import {
  ASK_GINA_SKILL_DEFINITIONS,
  PRODUCTION_MCP_URL,
  READ_SCOPE,
  type AskGinaSkillDefinition,
  type SkillName,
} from "@askgina/contracts";
import { Data, Effect, FileSystem, Path } from "effect";
import { parse } from "yaml";
import * as z from "zod";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));

const pluginManifestSchema = z
  .object({
    name: z.literal("ask-gina"),
    version: z.string().min(1),
    description: z.string().min(1),
    mcp: z
      .object({
        url: z.literal(PRODUCTION_MCP_URL),
        scopes: z.tuple([z.literal(READ_SCOPE)]),
      })
      .strict(),
  })
  .strict();

const skillFrontmatterSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
});

export type AskGinaPluginManifest = Readonly<{
  name: "ask-gina";
  version: string;
  description: string;
  mcp: Readonly<{
    url: typeof PRODUCTION_MCP_URL;
    scopes: readonly [typeof READ_SCOPE];
  }>;
}>;

export type CanonicalSkillDocument = Readonly<{
  definition: AskGinaSkillDefinition;
  path: string;
  content: string;
}>;

export type AskGinaPluginSource = Readonly<{
  manifest: AskGinaPluginManifest;
  skills: readonly CanonicalSkillDocument[];
}>;

export class PluginSourceLoadError extends Data.TaggedError("PluginSourceLoadError")<{
  readonly path: string;
  readonly reason: string;
  readonly cause?: unknown;
}> {}

const pluginSourceLoadError = (
  path: string,
  reason: string,
  cause?: unknown,
): PluginSourceLoadError =>
  new PluginSourceLoadError(cause === undefined ? { path, reason } : { path, reason, cause });

const isWithin = (paths: Path.Path, root: string, candidate: string): boolean => {
  const pathFromRoot = paths.relative(root, candidate);
  return (
    pathFromRoot !== "" &&
    pathFromRoot !== ".." &&
    !pathFromRoot.startsWith(`..${paths.sep}`) &&
    !paths.isAbsolute(pathFromRoot)
  );
};

const canonicalSkillNames = ASK_GINA_SKILL_DEFINITIONS.map(({ name }) => name);

const resolvePackageRoot = (
  fs: FileSystem.FileSystem,
): Effect.Effect<string, PluginSourceLoadError> =>
  fs
    .realPath(packageRoot)
    .pipe(
      Effect.mapError((cause) =>
        pluginSourceLoadError(packageRoot, "is missing or unreadable", cause),
      ),
    );

const assertExactSkillDirectories = (
  root: string,
): Effect.Effect<void, PluginSourceLoadError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;
    const skillsDirectory = paths.resolve(root, "skills");
    const entries = yield* fs
      .readDirectory(skillsDirectory)
      .pipe(
        Effect.mapError((cause) => pluginSourceLoadError(skillsDirectory, "cannot be read", cause)),
      );
    const actualNames = (yield* Effect.forEach(
      entries,
      (entry) => {
        const candidate = paths.resolve(skillsDirectory, entry);
        return fs.stat(candidate).pipe(
          Effect.map((info) => (info.type === "Directory" ? entry : undefined)),
          Effect.mapError((cause) =>
            pluginSourceLoadError(candidate, "cannot be inspected", cause),
          ),
        );
      },
      { concurrency: "unbounded" },
    ))
      .filter((name): name is string => name !== undefined)
      .sort();
    const expectedNames = [...canonicalSkillNames].sort();

    if (
      actualNames.length !== expectedNames.length ||
      actualNames.some((name, index) => name !== expectedNames[index])
    ) {
      return yield* pluginSourceLoadError(
        skillsDirectory,
        `expected exactly ${expectedNames.join(", ")}; found ${actualNames.join(", ") || "no skill directories"}`,
      );
    }
  });

const readCanonicalFile = (
  root: string,
  ...segments: readonly string[]
): Effect.Effect<
  Readonly<{ path: string; content: string }>,
  PluginSourceLoadError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;
    const candidate = paths.resolve(root, ...segments);
    if (!isWithin(paths, root, candidate)) {
      return yield* pluginSourceLoadError(candidate, "resolves outside the package root");
    }

    const realPath = yield* fs
      .realPath(candidate)
      .pipe(
        Effect.mapError((cause) =>
          pluginSourceLoadError(candidate, "is missing or unreadable", cause),
        ),
      );

    if (!isWithin(paths, root, realPath)) {
      return yield* pluginSourceLoadError(candidate, "resolves outside the package root");
    }

    const content = yield* fs
      .readFileString(realPath)
      .pipe(Effect.mapError((cause) => pluginSourceLoadError(candidate, "cannot be read", cause)));
    return { path: realPath, content };
  });

const parseYaml = (path: string, source: string): Effect.Effect<unknown, PluginSourceLoadError> =>
  Effect.try({
    try: () => parse(source),
    catch: (cause) => pluginSourceLoadError(path, "contains invalid YAML", cause),
  });

const parseSkillFrontmatter = (
  path: string,
  content: string,
): Effect.Effect<z.infer<typeof skillFrontmatterSchema>, PluginSourceLoadError> => {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)?.[1];
  if (frontmatter === undefined) {
    return Effect.fail(pluginSourceLoadError(path, "must start with YAML frontmatter"));
  }

  return parseYaml(path, frontmatter).pipe(
    Effect.flatMap((source) => {
      const parsed = skillFrontmatterSchema.safeParse(source);
      return parsed.success
        ? Effect.succeed(parsed.data)
        : Effect.fail(
            pluginSourceLoadError(path, `has invalid skill frontmatter: ${parsed.error.message}`),
          );
    }),
  );
};

const validateSkillDocument = (
  document: Readonly<{ path: string; content: string }>,
  definition: AskGinaSkillDefinition,
): Effect.Effect<CanonicalSkillDocument, PluginSourceLoadError> =>
  parseSkillFrontmatter(document.path, document.content).pipe(
    Effect.flatMap((frontmatter) => {
      if (frontmatter.name !== definition.name) {
        return Effect.fail(
          pluginSourceLoadError(
            document.path,
            `declares ${frontmatter.name}; expected ${definition.name}`,
          ),
        );
      }

      for (const toolName of definition.tools) {
        if (!document.content.includes(`\`${toolName}\``)) {
          return Effect.fail(
            pluginSourceLoadError(document.path, `does not document required tool ${toolName}`),
          );
        }
      }

      return Effect.succeed({ definition, path: document.path, content: document.content });
    }),
  );

/** Reads and validates only the package-local plugin.yaml source. */
export const loadPluginManifest: Effect.Effect<
  AskGinaPluginManifest,
  PluginSourceLoadError,
  FileSystem.FileSystem | Path.Path
> = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* resolvePackageRoot(fs);
  const manifest = yield* readCanonicalFile(root, "plugin.yaml");
  const source = yield* parseYaml(manifest.path, manifest.content);
  const parsed = pluginManifestSchema.safeParse(source);

  return yield* parsed.success
    ? Effect.succeed(parsed.data)
    : pluginSourceLoadError(manifest.path, `has invalid plugin manifest: ${parsed.error.message}`);
});

/** Reads and validates exactly the four package-local canonical SKILL.md sources. */
export const loadCanonicalSkillDocuments: Effect.Effect<
  readonly CanonicalSkillDocument[],
  PluginSourceLoadError,
  FileSystem.FileSystem | Path.Path
> = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* resolvePackageRoot(fs);
  yield* assertExactSkillDirectories(root);

  return yield* Effect.forEach(
    ASK_GINA_SKILL_DEFINITIONS,
    (definition) =>
      readCanonicalFile(root, "skills", definition.name, "SKILL.md").pipe(
        Effect.flatMap((document) => validateSkillDocument(document, definition)),
      ),
    { concurrency: "unbounded" },
  );
});

/** Reads the complete canonical plugin source without consulting generated target overlays. */
export const loadAskGinaPluginSource: Effect.Effect<
  AskGinaPluginSource,
  PluginSourceLoadError,
  FileSystem.FileSystem | Path.Path
> = Effect.all([loadPluginManifest, loadCanonicalSkillDocuments], {
  concurrency: "unbounded",
}).pipe(Effect.map(([manifest, skills]) => ({ manifest, skills })));

export const canonicalSkillPath = (name: SkillName): string =>
  fileURLToPath(new URL(`../skills/${name}/SKILL.md`, import.meta.url));
