#!/usr/bin/env bun

import { fileURLToPath } from "node:url";

import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import {
  ASK_GINA_SKILL_DEFINITIONS,
  EXECUTE_SCOPE,
  PRODUCTION_MCP_URL,
  RELEASE_VERSION,
  isGinaReadToolName,
  isGinaRenderToolName,
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
  hostsOf,
  loadMarketplaceSource,
  loadPluginSource,
  loadPluginSources,
  skillIdsOf,
  type PluginSource,
} from "./plugin-manifests";
import {
  TARGET_NAMES,
  createGeneratedPluginTarget,
  isReadOnlyListing,
  type PluginSkillSyncError,
  type TargetName,
} from "./sync-plugin-skills";

export { TARGET_NAMES, type TargetName };

const here = fileURLToPath(new URL(".", import.meta.url));

type ConformanceEnvironment = FileSystem.FileSystem | Path.Path;

export interface TargetConformanceCheck {
  readonly id: string;
  readonly target: TargetName | "repository";
  readonly title: string;
  readonly passed: boolean;
  readonly detail?: string;
}

export interface TargetSummary {
  readonly target: TargetName;
  /** Name of the plugin package the target was generated from. */
  readonly package: string;
  readonly passed: boolean;
  readonly checks: readonly TargetConformanceCheck[];
}

export interface RepositorySummary {
  readonly target: "repository";
  readonly passed: boolean;
  readonly checks: readonly TargetConformanceCheck[];
}
export interface TargetConformanceReport {
  /** Target summaries keyed by host for `ask-gina` and by `<package>:<host>` for every other package. */
  readonly targets: Readonly<Record<string, TargetSummary>>;
  readonly repository?: RepositorySummary;
  readonly totalChecks: number;
  readonly totalPassed: number;
  readonly totalFailed: number;
  readonly allPassed: boolean;
}

export interface TargetConformanceOptions {
  /**
   * Package directory to check. Defaults to `plugins/ask-gina`, except for `runTargetConformanceChecks`
   * and `checkRepositoryConformance`, which check every package under `<repositoryRoot>/plugins`.
   */
  readonly packageRoot?: string;
  readonly repositoryRoot?: string;
  readonly checkRepository?: boolean;
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

const isWithin = (paths: Path.Path, parent: string, child: string): boolean => {
  const relative = paths.relative(parent, child);
  return !relative.startsWith(`..${paths.sep}`) && relative !== ".." && !paths.isAbsolute(relative);
};

const findSymbolicLinks = (
  fs: FileSystem.FileSystem,
  paths: Path.Path,
  directory: string,
): Effect.Effect<readonly string[], PlatformError.PlatformError> =>
  Effect.gen(function* () {
    const exists = yield* fs.exists(directory);
    if (!exists) return [];
    const entries = yield* fs.readDirectory(directory);
    const nested = yield* Effect.forEach(
      entries,
      (entry) =>
        Effect.gen(function* () {
          const entryPath = paths.join(directory, entry);
          const isLink = yield* fs
            .readLink(entryPath)
            .pipe(Effect.match({ onFailure: () => false, onSuccess: () => true }));
          if (isLink) return [entryPath];
          const info = yield* fs.stat(entryPath);
          if (info.type === "Directory" && entry !== "node_modules" && entry !== ".git") {
            return yield* findSymbolicLinks(fs, paths, entryPath);
          }
          return [];
        }),
      { concurrency: "unbounded" },
    );
    return nested.flat();
  });
const advertisedToolIdentifiers = (markdown: string): readonly string[] =>
  Array.from(
    markdown.matchAll(/`((?:gina|spot|perps|predictions)\.[A-Za-z][A-Za-z0-9]*)`/g),
    ([, identifier]) => identifier,
  ).sort();

const productionSupportUrl = "https://askgina.ai/support";

/** The package whose check ids, report keys and titles stay unprefixed. Every other package is prefixed with its name. */
const DEFAULT_PACKAGE_NAME = "ask-gina";

const idPrefixOf = (packageName: string): string =>
  packageName === DEFAULT_PACKAGE_NAME ? "" : `${packageName}:`;

/** Exact OpenAI display metadata of the read-only contract skills. */
const openAiSkillInterfaces = {
  "review-gina-account": {
    display_name: "Review Gina Account",
    short_description: "Review Ask Gina portfolio balances, linked wallets, and automations.",
  },
  "research-spot-tokens": {
    display_name: "Research Spot Tokens",
    short_description: "Research live token prices, historical charts, and swap history.",
  },
  "research-prediction-markets": {
    display_name: "Research Prediction Markets",
    short_description: "Research live Polymarket events, outcome books, and market positions.",
  },
  "research-hyperliquid": {
    display_name: "Research Hyperliquid",
    short_description: "Research live Hyperliquid markets, account activity, and positions.",
  },
} as const satisfies Readonly<
  Record<
    (typeof ASK_GINA_SKILL_DEFINITIONS)[number]["name"],
    Readonly<{
      display_name: string;
      short_description: string;
    }>
  >
>;
const contractSkillInterfaces: Readonly<
  Record<string, Readonly<{ display_name: string; short_description: string }>>
> = openAiSkillInterfaces;
/** Display metadata shape required of a skill outside the read-only contract. */
const genericOpenAiInterface =
  /^interface:\n {2}display_name: "[^"\n]+"\n {2}short_description: "[^"\n]+"\ndependencies:\n/u;

const targetManifestPath: Readonly<Record<TargetName, string>> = {
  openai: ".codex-plugin/plugin.json",
  cursor: ".cursor-plugin/plugin.json",
  claude: ".claude-plugin/plugin.json",
  copilot: "plugin.json",
  gemini: "gemini-extension.json",
  devin: ".devin-plugin/plugin.json",
};

const targetMcpPath: Readonly<Partial<Record<TargetName, string>>> = {
  openai: ".mcp.json",
  cursor: "mcp.json",
  claude: ".mcp.json",
  copilot: "mcp.json",
  devin: ".mcp.json",
};

const foreignArtifacts: Readonly<Record<TargetName, readonly string[]>> = {
  openai: [
    ".app.json",
    ".agent-plugin",
    ".claude-plugin",
    ".cursor-plugin",
    ".devin-plugin",
    "plugin.json",
    "mcp.json",
    "gemini-extension.json",
    "rules",
    "commands",
  ],
  cursor: [
    ".app.json",
    ".claude-plugin",
    ".codex-plugin",
    ".devin-plugin",
    "plugin.json",
    ".mcp.json",
    "gemini-extension.json",
  ],
  claude: [
    ".app.json",
    ".cursor-plugin",
    ".codex-plugin",
    ".devin-plugin",
    "plugin.json",
    "mcp.json",
    "gemini-extension.json",
    "rules",
    "commands",
  ],
  copilot: [
    ".app.json",
    ".claude-plugin",
    ".cursor-plugin",
    ".codex-plugin",
    ".devin-plugin",
    ".mcp.json",
    "gemini-extension.json",
    "rules",
    "commands",
  ],
  gemini: [
    ".app.json",
    ".claude-plugin",
    ".cursor-plugin",
    ".codex-plugin",
    ".devin-plugin",
    "plugin.json",
    "mcp.json",
    ".mcp.json",
    "rules",
    "commands",
  ],
  devin: [
    ".app.json",
    ".agent-plugin",
    ".claude-plugin",
    ".codex-plugin",
    ".cursor-plugin",
    "plugin.json",
    "mcp.json",
    "gemini-extension.json",
    "rules",
    "commands",
  ],
};

/** A plugin package under test: its directory and the plugin.yaml that is the source of truth for it. */
interface ResolvedPackage {
  readonly packageRoot: string;
  readonly source: PluginSource;
}

const loadPackage = (
  packageRoot: string,
): Effect.Effect<ResolvedPackage, TargetConformanceError, ConformanceEnvironment> =>
  loadPluginSource(packageRoot).pipe(
    Effect.map((source) => ({ packageRoot, source })),
    Effect.mapError((cause) =>
      targetConformanceError(packageRoot, "plugin.yaml is unreadable", cause),
    ),
  );

/** Every package under `<repositoryRoot>/plugins`, in directory order. */
const loadRepositoryPackages = (
  repositoryRoot: string,
): Effect.Effect<readonly ResolvedPackage[], TargetConformanceError, ConformanceEnvironment> =>
  Effect.gen(function* () {
    const paths = yield* Path.Path;
    const plugins = yield* loadPluginSources(repositoryRoot).pipe(
      Effect.mapError((cause) =>
        targetConformanceError(repositoryRoot, "plugins are unreadable", cause),
      ),
    );
    return plugins.map(({ directory, source }) => ({
      packageRoot: paths.join(repositoryRoot, "plugins", directory),
      source,
    }));
  });

/** The MCP URL a package's manifests must bind. The read-only listing is pinned to the public contract. */
const expectedMcpUrl = (source: PluginSource): string =>
  isReadOnlyListing(source) ? PRODUCTION_MCP_URL : source.mcp.url;

const validateManifest = (target: TargetName, manifest: unknown, source: PluginSource): boolean => {
  const { listing } = source;
  const expectedVersion =
    target === "cursor" || target === "openai" ? listing.version : RELEASE_VERSION;
  if (nested(manifest, "name") !== source.name || nested(manifest, "version") !== expectedVersion) {
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
      nested(manifest, "interface", "composerIcon") === `./${listing.icon}` &&
      nested(manifest, "interface", "logo") === `./${listing.icon}` &&
      nested(manifest, "interface", "supportURL") === productionSupportUrl
    );
  }

  if (target === "cursor") {
    return (
      hasExactKeys(manifest, [
        "name",
        "displayName",
        "version",
        "description",
        "author",
        "homepage",
        "repository",
        "license",
        "keywords",
        "logo",
      ]) &&
      hasExactKeys(nested(manifest, "author"), ["name"]) &&
      nested(manifest, "displayName") === listing.displayName &&
      nested(manifest, "homepage") === "https://askgina.ai" &&
      nested(manifest, "repository") === "https://github.com/askgina/plugins" &&
      nested(manifest, "license") === "Apache-2.0" &&
      nested(manifest, "logo") === listing.icon
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
      hasExactKeys(nested(manifest, "mcpServers"), [listing.mcpServerName]) &&
      hasExactKeys(nested(manifest, "mcpServers", listing.mcpServerName), ["httpUrl"])
    );
  }

  if (target === "devin") {
    return (
      hasExactKeys(manifest, [
        "name",
        "displayName",
        "version",
        "description",
        "author",
        "homepage",
        "repository",
        "license",
        "logo",
        "keywords",
        "skills",
        "mcpServers",
      ]) &&
      hasExactKeys(nested(manifest, "author"), ["name"]) &&
      nested(manifest, "displayName") === listing.displayName &&
      nested(manifest, "homepage") === "https://askgina.ai" &&
      nested(manifest, "repository") === "https://github.com/askgina/plugins" &&
      nested(manifest, "license") === "Apache-2.0" &&
      nested(manifest, "logo") === listing.icon &&
      nested(manifest, "skills") === "skills" &&
      nested(manifest, "mcpServers") === ".mcp.json"
    );
  }

  return (
    hasExactKeys(manifest, ["name", "version", "description", "author"]) &&
    hasExactKeys(nested(manifest, "author"), ["name"])
  );
};

const validateMcp = (target: TargetName, manifest: unknown, source: PluginSource): boolean => {
  const serverName =
    target === "openai" || target === "devin" ? source.name : source.listing.mcpServerName;
  const url = expectedMcpUrl(source);
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

  if (target === "gemini") return nested(server, "httpUrl") === url;
  if (nested(server, "url") !== url) return false;
  if (target === "cursor") return true;
  if (
    target === "copilot" &&
    nested(manifest, "$schema") !== "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json"
  ) {
    return false;
  }
  return (
    nested(server, "type") ===
    (target === "openai" || target === "claude" || target === "devin" ? "http" : "streamable-http")
  );
};

const defaultPackageRootFor = (paths: Path.Path): string =>
  paths.resolve(here, "..", "plugins", "ask-gina");
const defaultRepositoryRootFor = (paths: Path.Path): string => paths.resolve(here, "..");
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
      const { packageRoot, source } = yield* loadPackage(
        paths.resolve(options.packageRoot ?? defaultPackageRootFor(paths)),
      );
      // Read-only invariants (contract skills, Cursor rule and commands, read-only skill boundary)
      // apply only to a listing whose single scope is tools:read.
      const readOnly = isReadOnlyListing(source);
      const skillIds = skillIdsOf(source);
      const url = expectedMcpUrl(source);
      const prefix = idPrefixOf(source.name);
      const titlePrefix = prefix === "" ? "" : `${source.name}: `;
      const checks: TargetConformanceCheck[] = [];
      const addCheck = (id: string, title: string, passed: boolean, detail?: string): void => {
        checks.push({
          id: `${prefix}${id}`,
          target,
          title: `${titlePrefix}${title}`,
          passed,
          detail,
        });
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
          validateManifest(target, manifest, source),
        );
        if (target === "gemini") {
          addCheck(
            "gemini.mcp.contract",
            "Gemini manifest binds the production Gina MCP endpoint",
            validateMcp(target, manifest, source),
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
            validateMcp(target, mcp, source),
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

      if (target === "devin") {
        const iconPath = paths.join(generatedTargetRoot, "assets", "icon.svg");
        addCheck(
          "devin.assets.icon_exists",
          "Devin manifest logo asset exists",
          yield* withFileSystemError(iconPath, "cannot be inspected", fs.exists(iconPath)),
        );
      }

      if (target === "cursor") {
        const iconPath = paths.join(generatedTargetRoot, "assets", "icon.svg");
        const readmePath = paths.join(generatedTargetRoot, "README.md");
        addCheck(
          "cursor.assets.icon_exists",
          "Cursor icon asset exists",
          yield* withFileSystemError(iconPath, "cannot be inspected", fs.exists(iconPath)),
        );
        addCheck(
          "cursor.readme.exists",
          "Cursor listing README exists",
          yield* withFileSystemError(readmePath, "cannot be inspected", fs.exists(readmePath)),
        );
        if (readOnly) {
          const rulePath = paths.join(generatedTargetRoot, "rules", "gina-read-only.mdc");
          addCheck(
            "cursor.rules.read_only_exists",
            "Cursor read-only rule exists",
            yield* withFileSystemError(rulePath, "cannot be inspected", fs.exists(rulePath)),
          );
          if (yield* withFileSystemError(rulePath, "cannot be inspected", fs.exists(rulePath))) {
            const rule = yield* withFileSystemError(
              rulePath,
              "cannot be read",
              fs.readFileString(rulePath),
            );
            addCheck(
              "cursor.rules.read_only_always_apply",
              "Cursor read-only rule is always applied",
              /^alwaysApply:\s*true\s*$/m.test(rule),
            );
          }
          const expectedCommands = skillIds.map((skill) => `${skill}.md`).sort();
          const commandsRoot = paths.join(generatedTargetRoot, "commands");
          const commandsExist = yield* withFileSystemError(
            commandsRoot,
            "cannot be inspected",
            fs.exists(commandsRoot),
          );
          const actualCommands = commandsExist
            ? (yield* withFileSystemError(
                commandsRoot,
                "cannot be read",
                fs.readDirectory(commandsRoot),
              )).sort()
            : [];
          addCheck(
            "cursor.commands.directory_set",
            "Cursor commands match the four canonical skills",
            sameSortedStrings(actualCommands, expectedCommands),
          );
        }
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
      const expectedSkillNames = [...skillIds].sort();
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
        `${target} contains exactly ${readOnly ? "the four canonical" : "the declared"} skills`,
        sameSortedStrings(actualSkillNames, expectedSkillNames),
      );

      if (readOnly) {
        addCheck(
          `${target}.skills.contract_catalog`,
          `${target} skill definitions use only public catalog or renderer tools`,
          ASK_GINA_SKILL_DEFINITIONS.every((skill) =>
            skill.tools.every((tool) => isGinaReadToolName(tool) || isGinaRenderToolName(tool)),
          ),
        );
      }

      let skillsHandoffFree = true;
      for (const skillName of skillIds) {
        const generatedSkillRoot = paths.join(generatedSkillsRoot, skillName);
        const generatedSkillPath = paths.join(generatedSkillRoot, "SKILL.md");
        const canonicalSkillPath = paths.join(packageRoot, "skills", skillName, "SKILL.md");
        const skillExists = yield* withFileSystemError(
          generatedSkillPath,
          "cannot be inspected",
          fs.exists(generatedSkillPath),
        );
        addCheck(
          `${target}.skill.${skillName}.exists`,
          `${target}: ${skillName}/SKILL.md exists`,
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
            `${target}.skill.${skillName}.canonical_parity`,
            `${target}: ${skillName} matches canonical source exactly`,
            content === canonical,
          );
          const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)?.[1];
          addCheck(
            `${target}.skill.${skillName}.frontmatter`,
            `${target}: ${skillName} declares canonical name and description frontmatter`,
            frontmatter !== undefined &&
              new RegExp(`^name:\\s*${skillName}\\s*$`, "m").test(frontmatter) &&
              /^description:\s*\S.+$/m.test(frontmatter),
          );
          if (readOnly) {
            addCheck(
              `${target}.skill.${skillName}.read_only_boundary`,
              `${target}: ${skillName} excludes bash and sibling MCP routes`,
              !content.toLowerCase().includes("bash") &&
                !content.includes("/ai/perps/mcp") &&
                !content.includes("/ai/predictions/mcp"),
            );

            const contractSkill = ASK_GINA_SKILL_DEFINITIONS.find(
              (definition) => definition.name === skillName,
            );
            const actualTools = advertisedToolIdentifiers(content);
            addCheck(
              `${target}.skill.${skillName}.tool_advertisements`,
              `${target}: ${skillName} advertises exactly its owned tools`,
              contractSkill !== undefined &&
                sameSortedStrings(actualTools, [...contractSkill.tools].sort()),
            );
          }
          if (content.includes("https://askgina.ai/new")) {
            skillsHandoffFree = false;
          }

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
              skillName,
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
            // Read-only listings pin the exact display strings; other listings pin their shape.
            const expectedInterface = Object.hasOwn(contractSkillInterfaces, skillName)
              ? contractSkillInterfaces[skillName]
              : undefined;
            const interfaceMatches = readOnly
              ? expectedInterface !== undefined &&
                metadata.startsWith(
                  `interface:\n  display_name: "${expectedInterface.display_name}"\n  short_description: "${expectedInterface.short_description}"\ndependencies:\n`,
                )
              : genericOpenAiInterface.test(metadata);
            const metadataMatches =
              metadataExists &&
              metadata === canonicalMetadata &&
              interfaceMatches &&
              metadata.includes('type: "mcp"') &&
              metadata.includes(`value: "${source.name}"`) &&
              metadata.includes('transport: "streamable_http"') &&
              metadata.includes(`url: "${url}"`);
            addCheck(
              `${target}.skill.${skillName}.openai_metadata`,
              `${target}: ${skillName} retains canonical OpenAI metadata`,
              metadataMatches,
            );
          } else {
            addCheck(
              `${target}.skill.${skillName}.no_openai_metadata`,
              `${target}: ${skillName} excludes OpenAI metadata`,
              !metadataExists,
            );
          }
        }
      }

      addCheck(
        `${target}.skills.execution_handoff_free`,
        `${target} skills omit execution handoff URLs`,
        skillsHandoffFree,
      );

      return {
        target,
        package: source.name,
        passed: checks.every((check) => check.passed),
        checks,
      };
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

type AddCheck = (id: string, title: string, passed: boolean, detail?: string) => void;
type PathRequirement = readonly [
  candidate: string,
  id: string,
  title: string,
  expectedType: "File" | "Directory",
];

/** Records one existence-and-type check per requirement. */
const checkRequiredPaths = (
  requirements: readonly PathRequirement[],
  addCheck: AddCheck,
): Effect.Effect<void, TargetConformanceError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    for (const [candidate, id, title, expectedType] of requirements) {
      const exists = yield* withFileSystemError(
        candidate,
        "cannot be inspected",
        fs.exists(candidate),
      );
      const actualType = exists
        ? (yield* withFileSystemError(candidate, "cannot be inspected", fs.stat(candidate))).type
        : undefined;
      addCheck(
        id,
        title,
        exists && actualType === expectedType,
        exists && actualType !== expectedType
          ? `expected ${expectedType}, found ${actualType ?? "unknown"}`
          : undefined,
      );
    }
  });

/**
 * Why a marketplace entry's `path` is not an acceptable source for `./plugins/<name>`, or
 * `undefined` when it is a canonical, existing, contained, link-free directory.
 */
const marketplaceSourceProblem = (options: {
  readonly sourceValue: unknown;
  readonly name: string;
  readonly repositoryRoot: string;
  readonly canonicalRepositoryRoot: string;
}): Effect.Effect<string | undefined, TargetConformanceError, ConformanceEnvironment> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;
    const { sourceValue, name, repositoryRoot, canonicalRepositoryRoot } = options;
    if (typeof sourceValue !== "string") return "plugin source path must be a string";
    const segments = sourceValue.split(/[\\/]/u);
    const normalized = paths.normalize(sourceValue);
    const resolvedSource = paths.resolve(repositoryRoot, sourceValue);
    if (
      paths.isAbsolute(sourceValue) ||
      segments.some((segment) => segment === "..") ||
      normalized !== paths.normalize(`plugins/${name}`) ||
      !isWithin(paths, repositoryRoot, resolvedSource)
    ) {
      return `plugin source path escapes or is not canonical: ${sourceValue}`;
    }
    const exists = yield* withFileSystemError(
      resolvedSource,
      "cannot be inspected",
      fs.exists(resolvedSource),
    );
    if (!exists) return `declared plugin source is missing: ${sourceValue}`;
    const sourceIsLink = yield* fs
      .readLink(resolvedSource)
      .pipe(Effect.match({ onFailure: () => false, onSuccess: () => true }));
    if (sourceIsLink) return `declared plugin source is a symbolic link: ${sourceValue}`;
    const realSource = yield* withFileSystemError(
      resolvedSource,
      "cannot be resolved",
      fs.realPath(resolvedSource),
    );
    return isWithin(paths, canonicalRepositoryRoot, realSource)
      ? undefined
      : `declared plugin source escapes: ${sourceValue}`;
  });

/** True when `entries` has exactly one entry per expected package, in order, and each one matches. */
const entriesMatchPackages = (
  entries: unknown,
  packages: readonly PluginSource[],
  matches: (entry: unknown, source: PluginSource) => boolean,
): boolean =>
  Array.isArray(entries) &&
  entries.length === packages.length &&
  packages.every((source, index) => matches(entries[index], source));

/** Per-package source checks: root manifests, overlays, legacy trees, symlinks and MCP binding. */
const checkPackageSource = (
  pkg: ResolvedPackage,
  addCheck: AddCheck,
): Effect.Effect<void, TargetConformanceError, ConformanceEnvironment> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;
    const { packageRoot, source } = pkg;
    const readOnly = isReadOnlyListing(source);
    const hosts = hostsOf(source);
    const expectedSkillNames = [...skillIdsOf(source)].sort();

    const openAiManifestPath = paths.join(packageRoot, ".codex-plugin", "plugin.json");
    const openAiMcpPath = paths.join(packageRoot, ".mcp.json");
    const openAiIconPath = paths.join(packageRoot, "assets", "icon.svg");
    const canonicalSkillsRoot = paths.join(packageRoot, "skills");
    yield* checkRequiredPaths(
      [
        [
          openAiManifestPath,
          "repository.root_openai.manifest_exists",
          "Root OpenAI manifest exists as a regular file",
          "File",
        ],
        [
          openAiMcpPath,
          "repository.root_openai.mcp_exists",
          "Root OpenAI MCP configuration exists as a regular file",
          "File",
        ],
        [
          openAiIconPath,
          "repository.root_openai.icon_exists",
          "Root OpenAI icon exists as a regular file",
          "File",
        ],
        [
          canonicalSkillsRoot,
          "repository.root_openai.skills_exists",
          "Root canonical skills directory exists",
          "Directory",
        ],
      ],
      addCheck,
    );

    if (
      yield* withFileSystemError(
        openAiManifestPath,
        "cannot be inspected",
        fs.exists(openAiManifestPath),
      )
    ) {
      const manifest = yield* readJson(fs, openAiManifestPath);
      addCheck(
        "repository.root_openai.manifest_contract",
        "Root OpenAI manifest has exact contract and release version",
        validateManifest("openai", manifest, source),
      );
    }
    if (
      yield* withFileSystemError(openAiMcpPath, "cannot be inspected", fs.exists(openAiMcpPath))
    ) {
      const mcp = yield* readJson(fs, openAiMcpPath);
      addCheck(
        "repository.root_openai.mcp_contract",
        "Root OpenAI MCP configuration binds the production endpoint",
        validateMcp("openai", mcp, source),
      );
    }

    const skillsExist = yield* withFileSystemError(
      canonicalSkillsRoot,
      "cannot be inspected",
      fs.exists(canonicalSkillsRoot),
    );
    let actualSkillNames: readonly string[] = [];
    let skillFilesComplete = false;
    if (skillsExist) {
      actualSkillNames = (yield* withFileSystemError(
        canonicalSkillsRoot,
        "cannot be read",
        fs.readDirectory(canonicalSkillsRoot),
      )).sort();
      const declaredFiles = yield* Effect.forEach(
        expectedSkillNames,
        (skill) =>
          Effect.all(
            [
              withFileSystemError(
                paths.join(canonicalSkillsRoot, skill, "SKILL.md"),
                "cannot be inspected",
                fs.exists(paths.join(canonicalSkillsRoot, skill, "SKILL.md")),
              ),
              withFileSystemError(
                paths.join(canonicalSkillsRoot, skill, "agents", "openai.yaml"),
                "cannot be inspected",
                fs.exists(paths.join(canonicalSkillsRoot, skill, "agents", "openai.yaml")),
              ),
            ],
            { concurrency: "unbounded" },
          ),
        { concurrency: "unbounded" },
      );
      skillFilesComplete = declaredFiles.every(([skill, metadata]) => skill && metadata);
    }
    addCheck(
      "repository.root_openai.skills_contract",
      "Root OpenAI source contains exact canonical skills and declared files",
      sameSortedStrings(actualSkillNames, expectedSkillNames) && skillFilesComplete,
    );

    let repositoryHandoffFree = true;
    if (skillsExist) {
      for (const skill of expectedSkillNames) {
        const skillPath = paths.join(canonicalSkillsRoot, skill, "SKILL.md");
        const skillMarkdownExists = yield* withFileSystemError(
          skillPath,
          "cannot be inspected",
          fs.exists(skillPath),
        );
        if (!skillMarkdownExists) continue;
        const content = yield* withFileSystemError(
          skillPath,
          "cannot be read",
          fs.readFileString(skillPath),
        );
        if (content.includes("https://askgina.ai/new")) {
          repositoryHandoffFree = false;
        }
      }
    }
    addCheck(
      "repository.skills.execution_handoff_free",
      "Canonical skills omit execution handoff URLs",
      repositoryHandoffFree,
    );

    const legacyOpenAiOverlay = paths.join(packageRoot, "targets", "openai");
    const legacyOpenAiExists = yield* withFileSystemError(
      legacyOpenAiOverlay,
      "cannot be inspected",
      fs.exists(legacyOpenAiOverlay),
    );
    addCheck(
      "repository.legacy_openai.absent",
      "Legacy targets/openai overlay is absent",
      !legacyOpenAiExists,
      legacyOpenAiExists ? "legacy OpenAI overlay must be removed" : undefined,
    );

    const legacyCursorOverlay = paths.join(packageRoot, "targets", "cursor");
    const legacyCursorExists = yield* withFileSystemError(
      legacyCursorOverlay,
      "cannot be inspected",
      fs.exists(legacyCursorOverlay),
    );
    addCheck(
      "repository.legacy_cursor.absent",
      "Legacy targets/cursor overlay is absent",
      !legacyCursorExists,
      legacyCursorExists ? "legacy Cursor overlay must be removed" : undefined,
    );

    const legacyDevinOverlay = paths.join(packageRoot, "targets", "devin");
    const legacyDevinExists = yield* withFileSystemError(
      legacyDevinOverlay,
      "cannot be inspected",
      fs.exists(legacyDevinOverlay),
    );
    addCheck(
      "repository.legacy_devin.absent",
      "Legacy targets/devin overlay is absent",
      !legacyDevinExists,
      legacyDevinExists ? "legacy Devin overlay must be removed" : undefined,
    );

    const cursorManifestPath = paths.join(packageRoot, ".cursor-plugin", "plugin.json");
    const cursorMcpPath = paths.join(packageRoot, "mcp.json");
    const cursorReadmePath = paths.join(packageRoot, "README.md");
    yield* checkRequiredPaths(
      [
        [
          cursorManifestPath,
          "repository.root_cursor.manifest_exists",
          "Root Cursor manifest exists as a regular file",
          "File",
        ],
        [
          cursorMcpPath,
          "repository.root_cursor.mcp_exists",
          "Root Cursor MCP configuration exists as a regular file",
          "File",
        ],
        [
          cursorReadmePath,
          "repository.root_cursor.readme_exists",
          "Root Cursor listing README exists as a regular file",
          "File",
        ],
        ...(readOnly
          ? ([
              [
                paths.join(packageRoot, "rules", "gina-read-only.mdc"),
                "repository.root_cursor.rule_exists",
                "Root Cursor read-only rule exists as a regular file",
                "File",
              ],
              [
                paths.join(packageRoot, "commands"),
                "repository.root_cursor.commands_exists",
                "Root Cursor commands directory exists",
                "Directory",
              ],
            ] as const satisfies readonly PathRequirement[])
          : []),
      ],
      addCheck,
    );
    if (
      yield* withFileSystemError(
        cursorManifestPath,
        "cannot be inspected",
        fs.exists(cursorManifestPath),
      )
    ) {
      const manifest = yield* readJson(fs, cursorManifestPath);
      addCheck(
        "repository.root_cursor.manifest_contract",
        "Root Cursor manifest has exact contract and release version",
        validateManifest("cursor", manifest, source),
      );
    }
    if (
      yield* withFileSystemError(cursorMcpPath, "cannot be inspected", fs.exists(cursorMcpPath))
    ) {
      const mcp = yield* readJson(fs, cursorMcpPath);
      addCheck(
        "repository.root_cursor.mcp_contract",
        "Root Cursor MCP configuration binds the production endpoint",
        validateMcp("cursor", mcp, source),
      );
    }

    if (hosts.includes("devin")) {
      const devinManifestPath = paths.join(packageRoot, ".devin-plugin", "plugin.json");
      const devinManifestExists = yield* withFileSystemError(
        devinManifestPath,
        "cannot be inspected",
        fs.exists(devinManifestPath),
      );
      const devinManifestType = devinManifestExists
        ? (yield* withFileSystemError(
            devinManifestPath,
            "cannot be inspected",
            fs.stat(devinManifestPath),
          )).type
        : undefined;
      addCheck(
        "repository.devin.plugin_manifest_exists",
        "Canonical Devin plugin manifest exists as a regular file",
        devinManifestExists && devinManifestType === "File",
      );
      if (devinManifestExists) {
        const manifest = yield* readJson(fs, devinManifestPath);
        addCheck(
          "repository.devin.plugin_manifest_contract",
          "Canonical Devin plugin manifest has the exact source and release contract",
          validateManifest("devin", manifest, source),
        );
      }
      if (
        yield* withFileSystemError(openAiMcpPath, "cannot be inspected", fs.exists(openAiMcpPath))
      ) {
        const mcp = yield* readJson(fs, openAiMcpPath);
        addCheck(
          "repository.devin.plugin_mcp_contract",
          "Canonical Devin plugin MCP configuration binds the production endpoint",
          validateMcp("devin", mcp, source),
        );
      }
    }

    const symlinks = yield* findSymbolicLinks(fs, paths, packageRoot).pipe(
      Effect.mapError((cause) =>
        targetConformanceError(packageRoot, "cannot inspect plugin source links", cause),
      ),
    );
    addCheck(
      "repository.source.no_symlinks",
      "Plugin source contains no symbolic links",
      symlinks.length === 0,
      symlinks.length === 0 ? undefined : `symbolic links: ${symlinks.join(", ")}`,
    );

    const claudeManifestPath = paths.join(
      packageRoot,
      "targets",
      "claude",
      ".claude-plugin",
      "plugin.json",
    );
    const claudeMcpPath = paths.join(packageRoot, "targets", "claude", ".mcp.json");
    const [claudeManifestExists, claudeMcpExists] = yield* Effect.all(
      [
        withFileSystemError(
          claudeManifestPath,
          "cannot be inspected",
          fs.exists(claudeManifestPath),
        ),
        withFileSystemError(claudeMcpPath, "cannot be inspected", fs.exists(claudeMcpPath)),
      ],
      { concurrency: "unbounded" },
    );
    addCheck(
      "repository.claude.overlay_exists",
      "Claude overlay manifest and MCP configuration exist",
      claudeManifestExists && claudeMcpExists,
    );
    if (claudeManifestExists && claudeMcpExists) {
      const [claudeManifest, claudeMcp] = yield* Effect.all(
        [readJson(fs, claudeManifestPath), readJson(fs, claudeMcpPath)],
        { concurrency: "unbounded" },
      );
      addCheck(
        "repository.claude.overlay_contract",
        "Claude overlay has the release version and production MCP contract",
        validateManifest("claude", claudeManifest, source) &&
          validateMcp("claude", claudeMcp, source),
      );
    }

    if (!readOnly) {
      // A write-capable listing binds an askgina.ai MCP route and declares exactly the execute scope.
      addCheck(
        "repository.plugin.mcp_contract",
        `plugin.yaml binds an askgina.ai MCP route with only the ${EXECUTE_SCOPE} scope`,
        /^https:\/\/askgina\.ai\/ai\/[a-z0-9-]+\/mcp$/u.test(source.mcp.url) &&
          source.mcp.scopes.length === 1 &&
          source.mcp.scopes[0] === EXECUTE_SCOPE,
      );
    }
  });

export const checkRepositoryConformance = (
  options: TargetConformanceOptions = {},
): Effect.Effect<RepositorySummary, TargetConformanceError, ConformanceEnvironment> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;
    const explicitPackageRoot =
      options.packageRoot === undefined ? undefined : paths.resolve(options.packageRoot);
    const repositoryRoot = paths.resolve(
      options.repositoryRoot ??
        (explicitPackageRoot === undefined
          ? defaultRepositoryRootFor(paths)
          : paths.join(explicitPackageRoot, "..", "..")),
    );
    const marketplaceVersion = yield* loadMarketplaceSource(repositoryRoot).pipe(
      Effect.map((source) => source.version),
      Effect.mapError((cause) =>
        targetConformanceError(repositoryRoot, "marketplace.yaml is unreadable", cause),
      ),
    );
    // The marketplaces list every package under plugins/; the package checks cover the requested one.
    const repositoryPackages = yield* loadRepositoryPackages(repositoryRoot);
    const marketplacePlugins = repositoryPackages.map(({ source }) => source);
    const packages =
      explicitPackageRoot === undefined
        ? repositoryPackages
        : [yield* loadPackage(explicitPackageRoot)];
    const canonicalRepositoryRoot = yield* withFileSystemError(
      repositoryRoot,
      "cannot be resolved",
      fs.realPath(repositoryRoot),
    );
    const checks: TargetConformanceCheck[] = [];
    const addCheck: AddCheck = (id, title, passed, detail) => {
      checks.push({ id, target: "repository", title, passed, detail });
    };

    const marketplacePath = paths.join(repositoryRoot, ".agents", "plugins", "marketplace.json");
    const marketplaceExists = yield* withFileSystemError(
      marketplacePath,
      "cannot be inspected",
      fs.exists(marketplacePath),
    );
    addCheck("marketplace.exists", ".agents/plugins/marketplace.json exists", marketplaceExists);
    if (marketplaceExists) {
      const marketplace = yield* readJson(fs, marketplacePath);
      const plugins = nested(marketplace, "plugins");
      const marketplaceContract =
        hasExactKeys(marketplace, ["name", "interface", "plugins"]) &&
        nested(marketplace, "name") === "ask-gina-plugins" &&
        hasExactKeys(nested(marketplace, "interface"), ["displayName"]) &&
        nested(marketplace, "interface", "displayName") === "Ask Gina Plugins" &&
        entriesMatchPackages(
          plugins,
          marketplacePlugins,
          (plugin, source) =>
            hasExactKeys(plugin, ["name", "source", "policy", "category"]) &&
            nested(plugin, "name") === source.name &&
            hasExactKeys(nested(plugin, "source"), ["source", "path"]) &&
            nested(plugin, "source", "source") === "local" &&
            nested(plugin, "source", "path") === `./plugins/${source.name}` &&
            hasExactKeys(nested(plugin, "policy"), ["installation", "authentication"]) &&
            nested(plugin, "policy", "installation") === source.listing.codex.policy.installation &&
            nested(plugin, "policy", "authentication") ===
              source.listing.codex.policy.authentication &&
            nested(plugin, "category") === source.listing.category,
        );
      addCheck(
        "marketplace.schema",
        "Repository marketplace has exact schema and values",
        marketplaceContract,
        marketplaceContract
          ? undefined
          : "marketplace name, interface, plugin, policy, category, or source is malformed",
      );
      const descriptorVersioned =
        nested(marketplace, "version") !== undefined ||
        (Array.isArray(plugins) &&
          plugins.some((plugin) => nested(plugin, "version") !== undefined));
      addCheck(
        "marketplace.no_version",
        "Repository marketplace descriptor is unversioned",
        !descriptorVersioned,
        descriptorVersioned ? "marketplace descriptor must not declare version" : undefined,
      );

      const sourceProblems = yield* Effect.forEach(marketplacePlugins, (source, index) =>
        marketplaceSourceProblem({
          sourceValue: nested(
            Array.isArray(plugins) ? plugins[index] : undefined,
            "source",
            "path",
          ),
          name: source.name,
          repositoryRoot,
          canonicalRepositoryRoot,
        }),
      );
      const sourceDetail = sourceProblems.find((problem) => problem !== undefined);
      addCheck(
        "marketplace.source_containment",
        "Repository marketplace source exists inside the repository without symlink indirection",
        sourceDetail === undefined,
        sourceDetail,
      );
    }

    const cursorMarketplacePath = paths.join(repositoryRoot, ".cursor-plugin", "marketplace.json");
    const cursorMarketplaceExists = yield* withFileSystemError(
      cursorMarketplacePath,
      "cannot be inspected",
      fs.exists(cursorMarketplacePath),
    );
    addCheck(
      "repository.cursor.marketplace_exists",
      "Cursor marketplace descriptor exists",
      cursorMarketplaceExists,
    );
    if (cursorMarketplaceExists) {
      const cursorMarketplace = yield* readJson(fs, cursorMarketplacePath);
      const cursorMarketplaceContract =
        hasExactKeys(cursorMarketplace, ["name", "owner", "metadata", "plugins"]) &&
        nested(cursorMarketplace, "name") === "ask-gina-plugins" &&
        hasExactKeys(nested(cursorMarketplace, "owner"), ["name"]) &&
        nested(cursorMarketplace, "owner", "name") === "Ask Gina" &&
        hasExactKeys(nested(cursorMarketplace, "metadata"), ["description", "version"]) &&
        nested(cursorMarketplace, "metadata", "version") === marketplaceVersion &&
        entriesMatchPackages(
          nested(cursorMarketplace, "plugins"),
          marketplacePlugins,
          (plugin, source) =>
            hasExactKeys(plugin, ["name", "source", "description"]) &&
            nested(plugin, "name") === source.name &&
            nested(plugin, "source") === `./plugins/${source.name}`,
        );
      addCheck(
        "repository.cursor.marketplace_contract",
        "Cursor marketplace points at the plugin root without overlay overrides",
        cursorMarketplaceContract,
      );
    }

    const rootDevinManifestPath = paths.join(repositoryRoot, ".devin-plugin", "plugin.json");
    const rootDevinManifestExists = yield* withFileSystemError(
      rootDevinManifestPath,
      "cannot be inspected",
      fs.exists(rootDevinManifestPath),
    );
    addCheck(
      "repository.devin.root_manifest_absent",
      "Repository root does not install contributor instructions as a Devin plugin",
      !rootDevinManifestExists,
      rootDevinManifestExists
        ? "distribute the plugin directories under plugins/ directly; the repository root contains contributor instructions"
        : undefined,
    );

    const claudeMarketplacePath = paths.join(repositoryRoot, ".claude-plugin", "marketplace.json");
    const claudeMarketplaceExists = yield* withFileSystemError(
      claudeMarketplacePath,
      "cannot be inspected",
      fs.exists(claudeMarketplacePath),
    );
    addCheck(
      "repository.claude.marketplace_exists",
      "Independent Claude marketplace descriptor exists",
      claudeMarketplaceExists,
    );
    if (claudeMarketplaceExists) {
      const claudeMarketplace = yield* readJson(fs, claudeMarketplacePath);
      const claudeContract =
        nested(claudeMarketplace, "name") === "ask-gina-plugins" &&
        entriesMatchPackages(
          nested(claudeMarketplace, "plugins"),
          marketplacePlugins,
          (plugin, source) =>
            nested(plugin, "name") === source.name &&
            nested(plugin, "source") === `./plugins/${source.name}` &&
            nested(plugin, "version") === source.listing.version &&
            nested(plugin, "skills") === "./skills" &&
            nested(plugin, "mcpServers") === "./targets/claude/.mcp.json",
        );
      addCheck(
        "repository.claude.marketplace_contract",
        "Claude marketplace independently references the Claude MCP overlay",
        claudeContract,
      );
    }

    yield* Effect.forEach(packages, (pkg) => {
      const prefix = idPrefixOf(pkg.source.name);
      const titlePrefix = prefix === "" ? "" : `${pkg.source.name}: `;
      return checkPackageSource(pkg, (id, title, passed, detail) =>
        addCheck(`${prefix}${id}`, `${titlePrefix}${title}`, passed, detail),
      );
    });

    return {
      target: "repository",
      passed: checks.every((check) => check.passed),
      checks,
    };
  });
export const runTargetConformanceChecks = (
  options: TargetConformanceOptions & { readonly target?: TargetName } = {},
): Effect.Effect<
  TargetConformanceReport,
  TargetConformanceError | PluginSkillSyncError,
  ConformanceEnvironment
> =>
  Effect.gen(function* () {
    const paths = yield* Path.Path;
    // Without a package option every package under plugins/ is checked, each for the hosts it publishes.
    const packages =
      options.packageRoot === undefined
        ? yield* loadRepositoryPackages(
            paths.resolve(options.repositoryRoot ?? defaultRepositoryRootFor(paths)),
          )
        : [yield* loadPackage(paths.resolve(options.packageRoot))];
    const summaries = (yield* Effect.forEach(
      packages,
      (pkg) =>
        Effect.forEach(
          hostsOf(pkg.source).filter(
            (host) => options.target === undefined || host === options.target,
          ),
          (host) => checkTargetConformance(host, { ...options, packageRoot: pkg.packageRoot }),
          { concurrency: "unbounded" },
        ),
      { concurrency: "unbounded" },
    )).flat();
    const targets: Record<string, TargetSummary> = {};
    for (const summary of summaries) {
      targets[`${idPrefixOf(summary.package)}${summary.target}`] = summary;
    }
    const shouldCheckRepository = options.checkRepository ?? options.target === undefined;
    const repository = shouldCheckRepository
      ? yield* checkRepositoryConformance(options)
      : undefined;
    const allSummaries = repository === undefined ? summaries : [...summaries, repository];
    const checks = allSummaries.flatMap((summary) => summary.checks);
    const totalPassed = checks.filter((check) => check.passed).length;
    const totalFailed = checks.length - totalPassed;
    return {
      targets,
      ...(repository === undefined ? {} : { repository }),
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
  for (const [key, summary] of Object.entries(report.targets)) {
    process.stdout.write(`\n${key.toUpperCase()}: ${summary.passed ? "PASS" : "FAIL"}\n`);
    for (const check of summary.checks) {
      process.stdout.write(`  ${check.passed ? "PASS" : "FAIL"} ${check.title}\n`);
    }
  }
  if (report.repository !== undefined) {
    process.stdout.write(`\nREPOSITORY: ${report.repository.passed ? "PASS" : "FAIL"}\n`);
    for (const check of report.repository.checks) {
      process.stdout.write(
        `  ${check.passed ? "PASS" : "FAIL"} ${check.title}${check.detail === undefined ? "" : ` (${check.detail})`}\n`,
      );
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
