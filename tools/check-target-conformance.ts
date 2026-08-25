#!/usr/bin/env bun

import { fileURLToPath } from "node:url";

import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import {
  ASK_GINA_SKILL_DEFINITIONS,
  EXECUTION_HANDOFF_ORIGIN,
  EXECUTION_HANDOFF_PATHNAME,
  PRODUCTION_MCP_URL,
  RELEASE_VERSION,
  buildExecutionHandoffUrl,
  isGinaReadToolName,
  listCatalogToolNames,
} from "@askgina/contracts";
import {
  Data,
  Effect,
  FileSystem,
  Function,
  Layer,
  Option,
  Path,
  PlatformError,
  Schema,
} from "effect";

import {
  TARGET_NAMES,
  createGeneratedPluginTarget,
  type PluginSkillSyncError,
  type TargetName,
} from "./sync-plugin-skills.js";

export { TARGET_NAMES, type TargetName };

const here = fileURLToPath(new URL(".", import.meta.url));

type ConformanceEnvironment = FileSystem.FileSystem | Path.Path;

export interface TargetConformanceCheck {
  readonly id: string;
  readonly target: TargetName;
  readonly title: string;
  readonly passed: boolean;
  readonly detail?: string;
}

export interface TargetSummary {
  readonly target: TargetName;
  readonly passed: boolean;
  readonly checks: readonly TargetConformanceCheck[];
}

export interface TargetConformanceReport {
  readonly targets: Partial<Record<TargetName, TargetSummary>>;
  readonly totalChecks: number;
  readonly totalPassed: number;
  readonly totalFailed: number;
  readonly allPassed: boolean;
}

export interface TargetConformanceOptions {
  readonly packageRoot?: string;
}

export class TargetConformanceError extends Data.TaggedError("TargetConformanceError")<{
  readonly path: string;
  readonly reason: string;
  readonly cause?: unknown;
}> {}

export class TargetArgumentError extends Data.TaggedError("TargetArgumentError")<{
  readonly argument: string;
}> {}

const targetConformanceError = (
  path: string,
  reason: string,
  cause?: unknown,
): TargetConformanceError =>
  new TargetConformanceError(cause === undefined ? { path, reason } : { path, reason, cause });

const nested = (value: unknown, ...keys: readonly string[]): unknown => {
  let current = value;
  for (const key of keys) {
    if (
      typeof current !== "object" ||
      current === null ||
      Array.isArray(current) ||
      !(key in current)
    ) {
      return undefined;
    }
    current = Reflect.get(current, key);
  }
  return current;
};

const withFileSystemError = <A>(
  candidate: string,
  reason: string,
  effect: Effect.Effect<A, PlatformError.PlatformError>,
): Effect.Effect<A, TargetConformanceError> =>
  effect.pipe(Effect.mapError((cause) => targetConformanceError(candidate, reason, cause)));

const readJson = (
  fs: FileSystem.FileSystem,
  candidate: string,
): Effect.Effect<unknown, TargetConformanceError> =>
  withFileSystemError(candidate, "cannot be read", fs.readFileString(candidate)).pipe(
    Effect.flatMap((source) =>
      Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(source).pipe(
        Effect.mapError((cause) =>
          targetConformanceError(candidate, "contains invalid JSON", cause),
        ),
      ),
    ),
  );

const sameSortedStrings = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const hasExactKeys = (value: unknown, expected: readonly string[]): boolean => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return sameSortedStrings(actual, wanted);
};

const advertisedToolIdentifiers = (markdown: string): readonly string[] =>
  Array.from(
    markdown.matchAll(/`((?:gina|spot|perps|predictions)\.[A-Za-z][A-Za-z0-9]*)`/g),
    ([, identifier]) => identifier,
  ).sort();

const handoffUrls = (markdown: string): readonly URL[] =>
  Array.from(
    markdown.matchAll(/https:\/\/askgina\.ai\/new\?[^\s)\]}>'"`]+/g),
    ([value]) => new URL(value),
  );

const targetManifestPath: Readonly<Record<TargetName, string>> = {
  openai: ".codex-plugin/plugin.json",
  cursor: ".cursor-plugin/plugin.json",
  claude: ".claude-plugin/plugin.json",
  copilot: "plugin.json",
  gemini: "gemini-extension.json",
};

const targetMcpPath: Readonly<Partial<Record<TargetName, string>>> = {
  openai: ".mcp.json",
  cursor: "mcp.json",
  claude: ".mcp.json",
  copilot: "mcp.json",
};

const foreignArtifacts: Readonly<Record<TargetName, readonly string[]>> = {
  openai: [
    ".app.json",
    ".agent-plugin",
    ".claude-plugin",
    ".cursor-plugin",
    "plugin.json",
    "mcp.json",
    "gemini-extension.json",
  ],
  cursor: [
    ".app.json",
    ".claude-plugin",
    ".codex-plugin",
    "plugin.json",
    ".mcp.json",
    "gemini-extension.json",
  ],
  claude: [
    ".app.json",
    ".cursor-plugin",
    ".codex-plugin",
    "plugin.json",
    "mcp.json",
    "gemini-extension.json",
  ],
  copilot: [
    ".app.json",
    ".claude-plugin",
    ".cursor-plugin",
    ".codex-plugin",
    ".mcp.json",
    "gemini-extension.json",
  ],
  gemini: [
    ".app.json",
    ".claude-plugin",
    ".cursor-plugin",
    ".codex-plugin",
    "plugin.json",
    "mcp.json",
    ".mcp.json",
  ],
};

const validateManifest = (target: TargetName, manifest: unknown): boolean => {
  if (nested(manifest, "name") !== "ask-gina" || nested(manifest, "version") !== RELEASE_VERSION) {
    return false;
  }

  if (target === "openai") {
    return (
      hasExactKeys(manifest, [
        "name",
        "version",
        "description",
        "author",
        "homepage",
        "repository",
        "license",
        "keywords",
        "skills",
        "mcpServers",
        "interface",
      ]) &&
      hasExactKeys(nested(manifest, "author"), ["name", "url"]) &&
      nested(manifest, "repository") === "https://github.com/askgina/plugins" &&
      nested(manifest, "skills") === "./skills/" &&
      nested(manifest, "mcpServers") === "./.mcp.json" &&
      nested(manifest, "interface", "composerIcon") === "./assets/icon.svg" &&
      nested(manifest, "interface", "logo") === "./assets/icon.svg"
    );
  }

  if (target === "copilot") {
    return (
      hasExactKeys(manifest, ["$schema", "name", "version", "description", "author"]) &&
      hasExactKeys(nested(manifest, "author"), ["name"]) &&
      nested(manifest, "$schema") === "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json"
    );
  }

  if (target === "gemini") {
    return (
      hasExactKeys(manifest, ["name", "version", "description", "mcpServers"]) &&
      hasExactKeys(nested(manifest, "mcpServers"), ["gina"]) &&
      hasExactKeys(nested(manifest, "mcpServers", "gina"), ["httpUrl"])
    );
  }

  return (
    hasExactKeys(manifest, ["name", "version", "description", "author"]) &&
    hasExactKeys(nested(manifest, "author"), ["name"])
  );
};

const validateMcp = (target: TargetName, manifest: unknown): boolean => {
  const serverName = target === "openai" ? "ask-gina" : "gina";
  const server = nested(manifest, "mcpServers", serverName);
  const rootKeys =
    target === "copilot"
      ? ["$schema", "mcpServers"]
      : target === "gemini"
        ? ["name", "version", "description", "mcpServers"]
        : ["mcpServers"];
  const serverKeys =
    target === "cursor" || target === "gemini"
      ? [target === "gemini" ? "httpUrl" : "url"]
      : ["type", "url"];
  if (
    !hasExactKeys(manifest, rootKeys) ||
    !hasExactKeys(nested(manifest, "mcpServers"), [serverName]) ||
    !hasExactKeys(server, serverKeys)
  ) {
    return false;
  }

  if (target === "gemini") return nested(server, "httpUrl") === PRODUCTION_MCP_URL;
  if (nested(server, "url") !== PRODUCTION_MCP_URL) return false;
  if (target === "cursor") return true;
  if (
    target === "copilot" &&
    nested(manifest, "$schema") !== "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json"
  ) {
    return false;
  }
  return nested(server, "type") === (target === "openai" ? "http" : "streamable-http");
};

const defaultPackageRootFor = (paths: Path.Path): string =>
  paths.resolve(here, "..", "plugins", "ask-gina");

type GeneratedTargetConformanceEffect = Effect.Effect<
  TargetSummary,
  TargetConformanceError,
  ConformanceEnvironment
>;

export const checkGeneratedTargetConformance: {
  (
    generatedTargetRoot: string,
    options?: TargetConformanceOptions,
  ): (target: TargetName) => GeneratedTargetConformanceEffect;
  (
    target: TargetName,
    generatedTargetRoot: string,
    options?: TargetConformanceOptions,
  ): GeneratedTargetConformanceEffect;
} = Function.dual(
  (args) =>
    typeof args[0] === "string" &&
    TARGET_NAMES.some((candidate) => candidate === args[0]) &&
    typeof args[1] === "string",
  (
    target: TargetName,
    generatedTargetRoot: string,
    options: TargetConformanceOptions = {},
  ): GeneratedTargetConformanceEffect =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const paths = yield* Path.Path;
      const packageRoot = paths.resolve(options.packageRoot ?? defaultPackageRootFor(paths));
      const checks: TargetConformanceCheck[] = [];
      const addCheck = (id: string, title: string, passed: boolean, detail?: string): void => {
        checks.push({ id, target, title, passed, detail });
      };

      const manifestPath = paths.join(generatedTargetRoot, targetManifestPath[target]);
      const manifestExists = yield* withFileSystemError(
        manifestPath,
        "cannot be inspected",
        fs.exists(manifestPath),
      );
      addCheck(`${target}.manifest.exists`, `${target} host manifest exists`, manifestExists);
      if (manifestExists) {
        const manifest = yield* readJson(fs, manifestPath);
        addCheck(
          `${target}.manifest.contract`,
          `${target} host manifest conforms to the public plugin contract`,
          validateManifest(target, manifest),
        );
        if (target === "gemini") {
          addCheck(
            "gemini.mcp.contract",
            "Gemini manifest binds the production Gina MCP endpoint",
            validateMcp(target, manifest),
          );
        }
      }

      const mcpRelativePath = targetMcpPath[target];
      if (mcpRelativePath !== undefined) {
        const mcpPath = paths.join(generatedTargetRoot, mcpRelativePath);
        const mcpExists = yield* withFileSystemError(
          mcpPath,
          "cannot be inspected",
          fs.exists(mcpPath),
        );
        addCheck(`${target}.mcp.exists`, `${target} MCP overlay exists`, mcpExists);
        if (mcpExists) {
          const mcp = yield* readJson(fs, mcpPath);
          addCheck(
            `${target}.mcp.contract`,
            `${target} MCP overlay binds the production Gina MCP endpoint`,
            validateMcp(target, mcp),
          );
        }
      }

      if (target === "openai") {
        const iconPath = paths.join(generatedTargetRoot, "assets", "icon.svg");
        addCheck(
          "openai.assets.icon_exists",
          "OpenAI icon asset exists",
          yield* withFileSystemError(iconPath, "cannot be inspected", fs.exists(iconPath)),
        );
      }

      const foreignResults = yield* Effect.forEach(
        foreignArtifacts[target],
        (entry) => {
          const candidate = paths.join(generatedTargetRoot, entry);
          return withFileSystemError(candidate, "cannot be inspected", fs.exists(candidate));
        },
        { concurrency: "unbounded" },
      );
      addCheck(
        `${target}.isolation.no_foreign_artifacts`,
        `${target} target excludes foreign host artifacts`,
        foreignResults.every((present) => !present),
      );

      const generatedSkillsRoot = paths.join(generatedTargetRoot, "skills");
      const expectedSkillNames = ASK_GINA_SKILL_DEFINITIONS.map((skill) => skill.name).sort();
      const generatedSkillsExist = yield* withFileSystemError(
        generatedSkillsRoot,
        "cannot be inspected",
        fs.exists(generatedSkillsRoot),
      );
      const actualSkillNames = generatedSkillsExist
        ? (yield* Effect.forEach(
            yield* withFileSystemError(
              generatedSkillsRoot,
              "cannot be read",
              fs.readDirectory(generatedSkillsRoot),
            ),
            (entry) => {
              const candidate = paths.join(generatedSkillsRoot, entry);
              return withFileSystemError(candidate, "cannot be inspected", fs.stat(candidate)).pipe(
                Effect.map((info) => (info.type === "Directory" ? entry : undefined)),
              );
            },
            { concurrency: "unbounded" },
          ))
            .filter((entry): entry is string => entry !== undefined)
            .sort()
        : [];
      addCheck(
        `${target}.skills.directory_set`,
        `${target} contains exactly the four canonical skills`,
        sameSortedStrings(actualSkillNames, expectedSkillNames),
      );

      const catalogNames = listCatalogToolNames();
      addCheck(
        `${target}.skills.contract_catalog`,
        `${target} skill definitions use only public catalog tools`,
        ASK_GINA_SKILL_DEFINITIONS.every((skill) =>
          skill.tools.every((tool) => catalogNames.includes(tool) && isGinaReadToolName(tool)),
        ),
      );

      for (const skill of ASK_GINA_SKILL_DEFINITIONS) {
        const generatedSkillRoot = paths.join(generatedSkillsRoot, skill.name);
        const generatedSkillPath = paths.join(generatedSkillRoot, "SKILL.md");
        const canonicalSkillPath = paths.join(packageRoot, "skills", skill.name, "SKILL.md");
        const skillExists = yield* withFileSystemError(
          generatedSkillPath,
          "cannot be inspected",
          fs.exists(generatedSkillPath),
        );
        addCheck(
          `${target}.skill.${skill.name}.exists`,
          `${target}: ${skill.name}/SKILL.md exists`,
          skillExists,
        );

        if (skillExists) {
          const [content, canonical] = yield* Effect.all(
            [
              withFileSystemError(
                generatedSkillPath,
                "cannot be read",
                fs.readFileString(generatedSkillPath),
              ),
              withFileSystemError(
                canonicalSkillPath,
                "cannot be read",
                fs.readFileString(canonicalSkillPath),
              ),
            ],
            { concurrency: "unbounded" },
          );
          addCheck(
            `${target}.skill.${skill.name}.canonical_parity`,
            `${target}: ${skill.name} matches canonical source exactly`,
            content === canonical,
          );
          const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)?.[1];
          addCheck(
            `${target}.skill.${skill.name}.frontmatter`,
            `${target}: ${skill.name} declares canonical name and description frontmatter`,
            frontmatter !== undefined &&
              new RegExp(`^name:\\s*${skill.name}\\s*$`, "m").test(frontmatter) &&
              /^description:\s*\S.+$/m.test(frontmatter),
          );
          addCheck(
            `${target}.skill.${skill.name}.read_only_boundary`,
            `${target}: ${skill.name} excludes bash and sibling MCP routes`,
            !content.toLowerCase().includes("bash") &&
              !content.includes("/ai/perps/mcp") &&
              !content.includes("/ai/predictions/mcp"),
          );

          const actualTools = advertisedToolIdentifiers(content);
          const expectedTools = [...skill.tools].sort();
          addCheck(
            `${target}.skill.${skill.name}.tool_advertisements`,
            `${target}: ${skill.name} advertises exactly its owned read tools`,
            sameSortedStrings(actualTools, expectedTools),
          );

          const canonicalHandoff = buildExecutionHandoffUrl(
            skill.handoffAgent,
            skill.handoffExamplePrompt,
          );
          const urls = handoffUrls(content);
          addCheck(
            `${target}.skill.${skill.name}.execution_handoff`,
            `${target}: ${skill.name} has the canonical execution handoff`,
            content.includes(canonicalHandoff) &&
              urls.length > 0 &&
              urls.every(
                (url) =>
                  url.origin === EXECUTION_HANDOFF_ORIGIN &&
                  url.pathname === EXECUTION_HANDOFF_PATHNAME,
              ),
          );

          const metadataPath = paths.join(generatedSkillRoot, "agents", "openai.yaml");
          const metadataExists = yield* withFileSystemError(
            metadataPath,
            "cannot be inspected",
            fs.exists(metadataPath),
          );
          if (target === "openai") {
            const canonicalMetadataPath = paths.join(
              packageRoot,
              "skills",
              skill.name,
              "agents",
              "openai.yaml",
            );
            const metadata = metadataExists
              ? yield* withFileSystemError(
                  metadataPath,
                  "cannot be read",
                  fs.readFileString(metadataPath),
                )
              : "";
            const canonicalMetadata = metadataExists
              ? yield* withFileSystemError(
                  canonicalMetadataPath,
                  "cannot be read",
                  fs.readFileString(canonicalMetadataPath),
                )
              : "";
            const metadataMatches =
              metadataExists &&
              metadata === canonicalMetadata &&
              metadata.includes('type: "mcp"') &&
              metadata.includes('value: "ask-gina"') &&
              metadata.includes('transport: "streamable_http"') &&
              metadata.includes(`url: "${PRODUCTION_MCP_URL}"`);
            addCheck(
              `${target}.skill.${skill.name}.openai_metadata`,
              `${target}: ${skill.name} retains canonical OpenAI metadata`,
              metadataMatches,
            );
          } else {
            addCheck(
              `${target}.skill.${skill.name}.no_openai_metadata`,
              `${target}: ${skill.name} excludes OpenAI metadata`,
              !metadataExists,
            );
          }
        }
      }

      return { target, passed: checks.every((check) => check.passed), checks };
    }),
);

type TargetConformanceEffect = Effect.Effect<
  TargetSummary,
  TargetConformanceError | PluginSkillSyncError,
  ConformanceEnvironment
>;

export const checkTargetConformance: {
  (options?: TargetConformanceOptions): (target: TargetName) => TargetConformanceEffect;
  (target: TargetName, options?: TargetConformanceOptions): TargetConformanceEffect;
} = Function.dual(
  (args) => typeof args[0] === "string" && TARGET_NAMES.some((candidate) => candidate === args[0]),
  (target: TargetName, options: TargetConformanceOptions = {}): TargetConformanceEffect =>
    Effect.acquireUseRelease(
      createGeneratedPluginTarget(target, options),
      (generated) => checkGeneratedTargetConformance(target, generated.path, options),
      (generated) => generated.cleanup.pipe(Effect.orDie),
    ),
);

export const runTargetConformanceChecks = (
  options: TargetConformanceOptions & { readonly target?: TargetName } = {},
): Effect.Effect<
  TargetConformanceReport,
  TargetConformanceError | PluginSkillSyncError,
  ConformanceEnvironment
> =>
  Effect.gen(function* () {
    const targetsToRun = options.target === undefined ? TARGET_NAMES : [options.target];
    const summaries = yield* Effect.forEach(
      targetsToRun,
      (target) => checkTargetConformance(target, options),
      { concurrency: "unbounded" },
    );
    const targets: Partial<Record<TargetName, TargetSummary>> = {};
    for (const summary of summaries) targets[summary.target] = summary;
    const checks = summaries.flatMap((summary) => summary.checks);
    const totalPassed = checks.filter((check) => check.passed).length;
    const totalFailed = checks.length - totalPassed;
    return {
      targets,
      totalChecks: checks.length,
      totalPassed,
      totalFailed,
      allPassed: totalFailed === 0,
    };
  });

const cliArguments = (
  args: readonly string[],
): Effect.Effect<
  { readonly json: boolean; readonly target: Option.Option<TargetName> },
  TargetArgumentError
> => {
  let target = Option.none<TargetName>();
  let json = false;

  for (const argument of args) {
    if (argument === "--json") {
      if (json) return Effect.fail(new TargetArgumentError({ argument }));
      json = true;
      continue;
    }

    if (argument.startsWith("--target=")) {
      if (Option.isSome(target)) return Effect.fail(new TargetArgumentError({ argument }));
      const raw = argument.slice("--target=".length);
      const candidate = TARGET_NAMES.find((name) => name === raw);
      if (candidate === undefined) return Effect.fail(new TargetArgumentError({ argument: raw }));
      target = Option.some(candidate);
      continue;
    }

    return Effect.fail(new TargetArgumentError({ argument }));
  }

  return Effect.succeed({ json, target });
};

const printHumanReport = (report: TargetConformanceReport): void => {
  for (const target of TARGET_NAMES) {
    const summary = report.targets[target];
    if (summary === undefined) continue;
    process.stdout.write(`\n${target.toUpperCase()}: ${summary.passed ? "PASS" : "FAIL"}\n`);
    for (const check of summary.checks) {
      process.stdout.write(`  ${check.passed ? "PASS" : "FAIL"} ${check.title}\n`);
    }
  }
  process.stdout.write(
    `\n${report.totalPassed}/${report.totalChecks} checks passed; ${report.allPassed ? "all targets conform" : "conformance failed"}.\n`,
  );
};

const encodeReportJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown, { space: 2 }));

if (import.meta.main) {
  BunRuntime.runMain(
    Effect.scoped(
      Effect.gen(function* () {
        const context = yield* Layer.build(BunServices.layer);
        return yield* Effect.gen(function* () {
          const arguments_ = yield* cliArguments(process.argv.slice(2));
          const target = Option.getOrUndefined(arguments_.target);
          const report = yield* runTargetConformanceChecks({ target });
          if (arguments_.json) {
            const encoded = yield* encodeReportJson(report);
            process.stdout.write(`${encoded}\n`);
          } else {
            printHumanReport(report);
          }
          if (!report.allPassed) process.exitCode = 1;
        }).pipe(Effect.provide(context));
      }),
    ),
  );
}
