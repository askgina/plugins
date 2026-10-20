#!/usr/bin/env bun

import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Console, Data, Effect, FileSystem, Layer, Path, Schema } from "effect";
import { parse } from "yaml";

export const SKILL_INDEX_PATH = "skills/index.json";
export const PENDING_RELOCATION_PATH = "tools/skill-index-pending-relocation.yaml";

const IGNORED_DIRECTORIES = new Set([".git", ".agents", "node_modules", "dist"]);
const MCP_ENDPOINT = /^https:\/\/[^/]+\/ai\/([a-z0-9-]+)\/mcp$/u;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u;

export interface SkillIndexEntry {
  readonly id: string;
  readonly package: string;
  /** Repo-relative skill directory. */
  readonly path: string;
  readonly description: string;
  readonly mcpEndpoint: string;
  readonly mcpUrl: string;
  readonly mcpServed: boolean;
  /** Repo-relative files inside the skill directory, sorted. */
  readonly files: readonly string[];
}

export interface SkillIndex {
  readonly version: 1;
  readonly skills: readonly SkillIndexEntry[];
}

/** Every problem found, so one run reports all of them. */
export class SkillIndexError extends Data.TaggedError("SkillIndexError")<{
  readonly problems: readonly string[];
}> {
  override get message(): string {
    return this.problems.join("\n");
  }
}

const PluginDeclaration = Schema.Struct({
  name: Schema.String,
  mcp: Schema.Struct({ url: Schema.String }),
  skills: Schema.Array(Schema.Struct({ id: Schema.String, mcpServed: Schema.Boolean })),
});

const PendingRelocation = Schema.Struct({ paths: Schema.Array(Schema.String) });

const problem = (message: string): SkillIndexError => new SkillIndexError({ problems: [message] });

const parseYaml = (path: string, source: string): Effect.Effect<unknown, SkillIndexError> =>
  Effect.try({
    try: () => parse(source) as unknown,
    catch: () => problem(`${path} contains invalid YAML`),
  });

const exists = (target: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs
      .exists(target)
      .pipe(Effect.mapError(() => problem(`${target} cannot be inspected`)));
  });

const readText = (root: string, relative: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return yield* fs
      .readFileString(path.join(root, relative))
      .pipe(Effect.mapError(() => problem(`${relative} cannot be read`)));
  });

const listFiles = (root: string, relative: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const visit = (directory: string): Effect.Effect<readonly string[], SkillIndexError> =>
      Effect.gen(function* () {
        const names = yield* fs
          .readDirectory(path.join(root, directory))
          .pipe(Effect.mapError(() => problem(`${directory} cannot be listed`)));
        const nested = yield* Effect.forEach([...names].sort(), (name) =>
          Effect.gen(function* () {
            const entry = `${directory}/${name}`;
            const info = yield* fs
              .stat(path.join(root, entry))
              .pipe(Effect.mapError(() => problem(`${entry} cannot be inspected`)));
            if (info.type === "Directory") return yield* visit(entry);
            return info.type === "File" ? [entry] : [];
          }),
        );
        return nested.flat();
      });
    return yield* visit(relative);
  });

/** Repo-relative paths of every SKILL.md outside ignored directories. */
const findSkillDocuments = (root: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const visit = (directory: string): Effect.Effect<readonly string[], SkillIndexError> =>
      Effect.gen(function* () {
        const names = yield* fs
          .readDirectory(path.join(root, directory))
          .pipe(Effect.mapError(() => problem(`${directory || "."} cannot be listed`)));
        const nested = yield* Effect.forEach([...names].sort(), (name) =>
          Effect.gen(function* () {
            if (IGNORED_DIRECTORIES.has(name)) return [];
            const entry = directory === "" ? name : `${directory}/${name}`;
            const info = yield* fs
              .stat(path.join(root, entry))
              .pipe(Effect.mapError(() => problem(`${entry} cannot be inspected`)));
            if (info.type === "Directory") return yield* visit(entry);
            return info.type === "File" && name === "SKILL.md" ? [entry] : [];
          }),
        );
        return nested.flat();
      });
    return yield* visit("");
  });

const loadPendingRelocation = (root: string) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    if (!(yield* exists(path.join(root, PENDING_RELOCATION_PATH)))) return [] as string[];
    const source = yield* parseYaml(
      PENDING_RELOCATION_PATH,
      yield* readText(root, PENDING_RELOCATION_PATH),
    );
    const decoded = yield* Schema.decodeUnknownEffect(PendingRelocation)(source).pipe(
      Effect.mapError(() => problem(`${PENDING_RELOCATION_PATH} must contain a paths list`)),
    );
    return [...decoded.paths];
  });

const parseFrontmatter = (relative: string, content: string) =>
  Effect.gen(function* () {
    const frontmatter = FRONTMATTER.exec(content)?.[1];
    if (frontmatter === undefined) return yield* problem(`${relative} must start with frontmatter`);
    const value = yield* parseYaml(relative, frontmatter);
    if (typeof value !== "object" || value === null) {
      return yield* problem(`${relative} frontmatter must be a mapping`);
    }
    const name: unknown = "name" in value ? value.name : undefined;
    const description: unknown = "description" in value ? value.description : undefined;
    return {
      name: typeof name === "string" ? name : "",
      description: typeof description === "string" ? description.trim() : "",
    };
  });

/**
 * Builds the skill index for the repository at `root`.
 * Fails with every problem found: bad declarations, name mismatches, missing skill
 * directories, and any SKILL.md that no plugin package declares.
 */
export const buildSkillIndex = (root: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const problems: string[] = [];
    const skills: SkillIndexEntry[] = [];
    const declaredDocuments = new Set<string>();

    const pluginsRoot = path.join(root, "plugins");
    const packageNames = (yield* exists(pluginsRoot))
      ? [
          ...(yield* fs
            .readDirectory(pluginsRoot)
            .pipe(Effect.mapError(() => problem("plugins cannot be listed")))),
        ].sort()
      : [];

    for (const packageName of packageNames) {
      const manifestPath = `plugins/${packageName}/plugin.yaml`;
      if (!(yield* exists(path.join(root, manifestPath)))) continue;
      const declaration = yield* parseYaml(manifestPath, yield* readText(root, manifestPath)).pipe(
        Effect.flatMap((source) =>
          Schema.decodeUnknownEffect(PluginDeclaration)(source).pipe(
            Effect.mapError(() =>
              problem(`${manifestPath} must declare name, mcp.url and a skills list`),
            ),
          ),
        ),
        Effect.catchTag("SkillIndexError", (error) =>
          Effect.sync(() => {
            problems.push(...error.problems);
            return undefined;
          }),
        ),
      );
      if (declaration === undefined) continue;

      if (declaration.name !== packageName) {
        problems.push(`${manifestPath} declares name ${declaration.name}; expected ${packageName}`);
      }
      const endpoint = MCP_ENDPOINT.exec(declaration.mcp.url)?.[1];
      if (endpoint === undefined) {
        problems.push(`${manifestPath} mcp.url must end with /ai/<endpoint>/mcp`);
        continue;
      }

      const seen = new Set<string>();
      for (const { id, mcpServed } of declaration.skills) {
        if (seen.has(id)) {
          problems.push(`${manifestPath} lists skill ${id} more than once`);
          continue;
        }
        seen.add(id);
        const directory = `plugins/${packageName}/skills/${id}`;
        const document = `${directory}/SKILL.md`;
        if (!(yield* exists(path.join(root, document)))) {
          problems.push(`${manifestPath} lists ${id} but ${document} does not exist`);
          continue;
        }
        declaredDocuments.add(document);
        const frontmatter = yield* parseFrontmatter(document, yield* readText(root, document)).pipe(
          Effect.catchTag("SkillIndexError", (error) =>
            Effect.sync(() => {
              problems.push(...error.problems);
              return undefined;
            }),
          ),
        );
        if (frontmatter === undefined) continue;
        if (frontmatter.name !== id) {
          problems.push(
            `${document} declares name ${frontmatter.name || "(none)"}; expected ${id}`,
          );
        }
        if (frontmatter.description === "") {
          problems.push(`${document} must have a description in its frontmatter`);
        }
        skills.push({
          id,
          package: packageName,
          path: directory,
          description: frontmatter.description,
          mcpEndpoint: endpoint,
          mcpUrl: declaration.mcp.url,
          mcpServed,
          files: [...(yield* listFiles(root, directory))].sort(),
        });
      }
    }

    const found = yield* findSkillDocuments(root);
    const foundSet = new Set(found);
    const pending = yield* loadPendingRelocation(root);
    for (const entry of pending) {
      if (!foundSet.has(entry)) {
        problems.push(`${PENDING_RELOCATION_PATH} lists ${entry}, which does not exist; remove it`);
      } else if (declaredDocuments.has(entry)) {
        problems.push(`${PENDING_RELOCATION_PATH} lists ${entry}, which is declared; remove it`);
      }
    }
    const allowed = new Set(pending);
    for (const document of found) {
      if (declaredDocuments.has(document) || allowed.has(document)) continue;
      problems.push(
        `${document} is not declared by any plugin. Move its directory to plugins/<package>/skills/<id>/ and list <id> under skills: in plugins/<package>/plugin.yaml.`,
      );
    }

    if (problems.length > 0) return yield* new SkillIndexError({ problems });
    const ordered = [...skills].sort(
      (a, b) =>
        (a.package < b.package ? -1 : a.package > b.package ? 1 : 0) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    return { version: 1, skills: ordered } satisfies SkillIndex;
  });

export const renderSkillIndex = (index: SkillIndex): string =>
  `${JSON.stringify(index, null, 2)}\n`;

/** Writes skills/index.json, or with `check` fails when the committed file differs. */
export const runSkillIndex = (options: { readonly root: string; readonly check: boolean }) =>
  Effect.gen(function* () {
    const { root } = options;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const rendered = renderSkillIndex(yield* buildSkillIndex(root));
    const target = path.join(root, SKILL_INDEX_PATH);
    if (options.check) {
      const current = (yield* exists(target))
        ? yield* fs.readFileString(target).pipe(Effect.mapError(() => problem("cannot read index")))
        : undefined;
      if (current !== rendered) {
        return yield* problem(`${SKILL_INDEX_PATH} is out of date; run bun run skills:index`);
      }
      return yield* Console.log(`${SKILL_INDEX_PATH} is up to date`);
    }
    yield* fs
      .makeDirectory(path.dirname(target), { recursive: true })
      .pipe(Effect.mapError(() => problem("cannot create skills directory")));
    yield* fs
      .writeFileString(target, rendered)
      .pipe(Effect.mapError(() => problem(`cannot write ${SKILL_INDEX_PATH}`)));
    return yield* Console.log(`Wrote ${SKILL_INDEX_PATH}`);
  });

if (import.meta.main) {
  const main = Layer.build(BunServices.layer).pipe(
    Effect.flatMap((context) =>
      runSkillIndex({ root: process.cwd(), check: process.argv.includes("--check") }).pipe(
        Effect.provide(context),
      ),
    ),
    Effect.scoped,
  );
  BunRuntime.runMain(main);
}
