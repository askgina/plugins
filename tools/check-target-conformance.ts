#!/usr/bin/env bun

import { fileURLToPath } from "node:url";

import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import {
  ASK_GINA_SKILL_DEFINITIONS,
  PRODUCTION_MCP_URL,
  RELEASE_VERSION,
  isGinaPredictionRenderToolName,
  isGinaReadToolName,
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
  readonly passed: boolean;
  readonly checks: readonly TargetConformanceCheck[];
}

export interface RepositorySummary {
  readonly target: "repository";
  readonly passed: boolean;
  readonly checks: readonly TargetConformanceCheck[];
}
export interface TargetConformanceReport {
  readonly targets: Partial<Record<TargetName, TargetSummary>>;
  readonly repository?: RepositorySummary;
  readonly totalChecks: number;
  readonly totalPassed: number;
  readonly totalFailed: number;
  readonly allPassed: boolean;
}

export interface TargetConformanceOptions {
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
      nested(manifest, "interface", "logo") === "./assets/icon.svg" &&
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
      nested(manifest, "displayName") === "Ask Gina" &&
      nested(manifest, "homepage") === "https://askgina.ai" &&
      nested(manifest, "repository") === "https://github.com/askgina/plugins" &&
      nested(manifest, "license") === "Apache-2.0" &&
      nested(manifest, "logo") === "assets/icon.svg"
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
  return (
    nested(server, "type") ===
    (target === "openai" || target === "claude" ? "http" : "streamable-http")
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

      addCheck(
        `${target}.skills.contract_catalog`,
        `${target} skill definitions use only public catalog or renderer tools`,
        ASK_GINA_SKILL_DEFINITIONS.every((skill) =>
          skill.tools.every(
            (tool) => isGinaReadToolName(tool) || isGinaPredictionRenderToolName(tool),
          ),
        ),
      );

      let skillsHandoffFree = true;
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
            `${target}: ${skill.name} advertises exactly its owned tools`,
            sameSortedStrings(actualTools, expectedTools),
          );
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
            const expectedInterface = openAiSkillInterfaces[skill.name];
            const metadataMatches =
              metadataExists &&
              metadata === canonicalMetadata &&
              metadata.startsWith(
                `interface:\n  display_name: "${expectedInterface.display_name}"\n  short_description: "${expectedInterface.short_description}"\ndependencies:\n`,
              ) &&
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

      addCheck(
        `${target}.skills.execution_handoff_free`,
        `${target} skills omit execution handoff URLs`,
        skillsHandoffFree,
      );

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

export const checkRepositoryConformance = (
  options: TargetConformanceOptions = {},
): Effect.Effect<RepositorySummary, TargetConformanceError, ConformanceEnvironment> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;
    const packageRoot = paths.resolve(options.packageRoot ?? defaultPackageRootFor(paths));
    const repositoryRoot = paths.resolve(
      options.repositoryRoot ??
        (options.packageRoot === undefined
          ? defaultRepositoryRootFor(paths)
          : paths.join(packageRoot, "..", "..")),
    );
    const canonicalRepositoryRoot = yield* withFileSystemError(
      repositoryRoot,
      "cannot be resolved",
      fs.realPath(repositoryRoot),
    );
    const checks: TargetConformanceCheck[] = [];
    const addCheck = (id: string, title: string, passed: boolean, detail?: string): void => {
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
      const plugin = Array.isArray(plugins) && plugins.length === 1 ? plugins[0] : undefined;
      const source = nested(plugin, "source");
      const policy = nested(plugin, "policy");
      const marketplaceContract =
        hasExactKeys(marketplace, ["name", "interface", "plugins"]) &&
        nested(marketplace, "name") === "ask-gina-plugins" &&
        hasExactKeys(nested(marketplace, "interface"), ["displayName"]) &&
        nested(marketplace, "interface", "displayName") === "Ask Gina Plugins" &&
        Array.isArray(plugins) &&
        plugins.length === 1 &&
        hasExactKeys(plugin, ["name", "source", "policy", "category"]) &&
        nested(plugin, "name") === "ask-gina" &&
        hasExactKeys(source, ["source", "path"]) &&
        nested(source, "source") === "local" &&
        nested(source, "path") === "./plugins/ask-gina" &&
        hasExactKeys(policy, ["installation", "authentication"]) &&
        nested(policy, "installation") === "AVAILABLE" &&
        nested(policy, "authentication") === "ON_INSTALL" &&
        nested(plugin, "category") === "Finance";
      addCheck(
        "marketplace.schema",
        "Repository marketplace has exact schema and values",
        marketplaceContract,
        marketplaceContract
          ? undefined
          : "marketplace name, interface, plugin, policy, category, or source is malformed",
      );
      const descriptorVersioned =
        nested(marketplace, "version") !== undefined || nested(plugin, "version") !== undefined;
      addCheck(
        "marketplace.no_version",
        "Repository marketplace descriptor is unversioned",
        !descriptorVersioned,
        descriptorVersioned ? "marketplace descriptor must not declare version" : undefined,
      );

      const sourceValue = nested(source, "path");
      let sourceContained = false;
      let sourceDetail: string | undefined;
      if (typeof sourceValue !== "string") {
        sourceDetail = "plugin source path must be a string";
      } else {
        const segments = sourceValue.split(/[\\/]/u);
        const normalized = paths.normalize(sourceValue);
        const resolvedSource = paths.resolve(repositoryRoot, sourceValue);
        const normalizedExpected = paths.normalize("plugins/ask-gina");
        if (
          paths.isAbsolute(sourceValue) ||
          segments.some((segment) => segment === "..") ||
          normalized !== normalizedExpected ||
          !isWithin(paths, repositoryRoot, resolvedSource)
        ) {
          sourceDetail = `plugin source path escapes or is not canonical: ${sourceValue}`;
        } else {
          const exists = yield* withFileSystemError(
            resolvedSource,
            "cannot be inspected",
            fs.exists(resolvedSource),
          );
          if (!exists) {
            sourceDetail = `declared plugin source is missing: ${sourceValue}`;
          } else {
            const sourceIsLink = yield* fs
              .readLink(resolvedSource)
              .pipe(Effect.match({ onFailure: () => false, onSuccess: () => true }));
            if (sourceIsLink) {
              sourceDetail = `declared plugin source is a symbolic link: ${sourceValue}`;
            } else {
              const realSource = yield* withFileSystemError(
                resolvedSource,
                "cannot be resolved",
                fs.realPath(resolvedSource),
              );
              sourceContained = isWithin(paths, canonicalRepositoryRoot, realSource);
              if (!sourceContained) sourceDetail = `declared plugin source escapes: ${sourceValue}`;
            }
          }
        }
      }
      addCheck(
        "marketplace.source_containment",
        "Repository marketplace source exists inside the repository without symlink indirection",
        sourceContained,
        sourceDetail,
      );
    }

    const openAiManifestPath = paths.join(packageRoot, ".codex-plugin", "plugin.json");
    const openAiMcpPath = paths.join(packageRoot, ".mcp.json");
    const openAiIconPath = paths.join(packageRoot, "assets", "icon.svg");
    const canonicalSkillsRoot = paths.join(packageRoot, "skills");
    const requiredOpenAiPaths = [
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
    ] as const;
    for (const [candidate, id, title, expectedType] of requiredOpenAiPaths) {
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
        validateManifest("openai", manifest),
      );
    }
    if (
      yield* withFileSystemError(openAiMcpPath, "cannot be inspected", fs.exists(openAiMcpPath))
    ) {
      const mcp = yield* readJson(fs, openAiMcpPath);
      addCheck(
        "repository.root_openai.mcp_contract",
        "Root OpenAI MCP configuration binds the production endpoint",
        validateMcp("openai", mcp),
      );
    }

    const expectedSkillNames = ASK_GINA_SKILL_DEFINITIONS.map((skill) => skill.name).sort();
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
      const cursorPlugins = nested(cursorMarketplace, "plugins");
      const cursorPlugin =
        Array.isArray(cursorPlugins) && cursorPlugins.length === 1 ? cursorPlugins[0] : undefined;
      const cursorMarketplaceContract =
        hasExactKeys(cursorMarketplace, ["name", "owner", "metadata", "plugins"]) &&
        nested(cursorMarketplace, "name") === "ask-gina-plugins" &&
        hasExactKeys(nested(cursorMarketplace, "owner"), ["name"]) &&
        nested(cursorMarketplace, "owner", "name") === "Ask Gina" &&
        hasExactKeys(nested(cursorMarketplace, "metadata"), ["description", "version"]) &&
        nested(cursorMarketplace, "metadata", "version") === RELEASE_VERSION &&
        hasExactKeys(cursorPlugin, ["name", "source", "description"]) &&
        nested(cursorPlugin, "name") === "ask-gina" &&
        nested(cursorPlugin, "source") === "./plugins/ask-gina";
      addCheck(
        "repository.cursor.marketplace_contract",
        "Cursor marketplace points at the plugin root without overlay overrides",
        cursorMarketplaceContract,
      );
    }

    const cursorManifestPath = paths.join(packageRoot, ".cursor-plugin", "plugin.json");
    const cursorMcpPath = paths.join(packageRoot, "mcp.json");
    const cursorReadmePath = paths.join(packageRoot, "README.md");
    const requiredCursorPaths = [
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
    ] as const;
    for (const [candidate, id, title, expectedType] of requiredCursorPaths) {
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
        validateManifest("cursor", manifest),
      );
    }
    if (
      yield* withFileSystemError(cursorMcpPath, "cannot be inspected", fs.exists(cursorMcpPath))
    ) {
      const mcp = yield* readJson(fs, cursorMcpPath);
      addCheck(
        "repository.root_cursor.mcp_contract",
        "Root Cursor MCP configuration binds the production endpoint",
        validateMcp("cursor", mcp),
      );
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
      const claudePlugins = nested(claudeMarketplace, "plugins");
      const claudePlugin =
        Array.isArray(claudePlugins) && claudePlugins.length === 1 ? claudePlugins[0] : undefined;
      const claudeContract =
        nested(claudeMarketplace, "name") === "ask-gina-plugins" &&
        nested(claudePlugin, "name") === "ask-gina" &&
        nested(claudePlugin, "source") === "./plugins/ask-gina" &&
        nested(claudePlugin, "skills") === "./skills" &&
        nested(claudePlugin, "mcpServers") === "./targets/claude/.mcp.json";
      addCheck(
        "repository.claude.marketplace_contract",
        "Claude marketplace independently references the Claude MCP overlay",
        claudeContract,
      );
    }

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
        validateManifest("claude", claudeManifest) && validateMcp("claude", claudeMcp),
      );
    }

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
    const targetsToRun = options.target === undefined ? TARGET_NAMES : [options.target];
    const summaries = yield* Effect.forEach(
      targetsToRun,
      (target) => checkTargetConformance(target, options),
      { concurrency: "unbounded" },
    );
    const targets: Partial<Record<TargetName, TargetSummary>> = {};
    for (const summary of summaries) targets[summary.target] = summary;
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
  for (const target of TARGET_NAMES) {
    const summary = report.targets[target];
    if (summary === undefined) continue;
    process.stdout.write(`\n${target.toUpperCase()}: ${summary.passed ? "PASS" : "FAIL"}\n`);
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
