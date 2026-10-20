#!/usr/bin/env bun

import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Console, Data, Effect, FileSystem, Layer, Path, Schema } from "effect";
import { parse } from "yaml";

/** Print width the repository formatter applies to JSON arrays. */
const PRINT_WIDTH = 100;

export const MARKETPLACE_SOURCE_PATH = "marketplace.yaml";

export class PluginManifestError extends Data.TaggedError("PluginManifestError")<{
  readonly problems: readonly string[];
}> {
  override get message(): string {
    return this.problems.join("\n");
  }
}

const fail = (message: string): PluginManifestError =>
  new PluginManifestError({ problems: [message] });

const Author = Schema.Struct({ name: Schema.String, url: Schema.String });

/**
 * Per-host descriptions. codex, cursor and claude are required because every plugin appears in
 * the three repository marketplaces. A devin, copilot or gemini description opts the plugin into
 * that target; without one the target's manifests are not generated.
 */
const Descriptions = Schema.Struct({
  codex: Schema.String,
  cursor: Schema.String,
  claude: Schema.String,
  devin: Schema.optional(Schema.String),
  copilot: Schema.optional(Schema.String),
  gemini: Schema.optional(Schema.String),
});

/** The `listing` block of plugin.yaml: every value a host manifest needs beyond name and version. */
const Listing = Schema.Struct({
  version: Schema.String,
  displayName: Schema.String,
  author: Author,
  homepage: Schema.String,
  repository: Schema.String,
  license: Schema.String,
  category: Schema.String,
  keywords: Schema.Array(Schema.String),
  icon: Schema.String,
  mcpServerName: Schema.String,
  descriptions: Descriptions,
  codex: Schema.Struct({
    shortDescription: Schema.String,
    longDescription: Schema.String,
    capabilities: Schema.Array(Schema.String),
    privacyPolicyURL: Schema.String,
    supportURL: Schema.String,
    termsOfServiceURL: Schema.String,
    defaultPrompt: Schema.Array(Schema.String),
    brandColor: Schema.String,
    screenshots: Schema.optional(Schema.Array(Schema.String)),
    policy: Schema.Struct({ installation: Schema.String, authentication: Schema.String }),
  }),
  cursorMarketplaceDescription: Schema.String,
});

const PluginSource = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  mcp: Schema.Struct({ url: Schema.String, scopes: Schema.Array(Schema.String) }),
  skills: Schema.Array(Schema.Struct({ id: Schema.String, mcpServed: Schema.Boolean })),
  listing: Listing,
});

const MarketplaceSource = Schema.Struct({
  name: Schema.String,
  displayName: Schema.String,
  owner: Author,
  version: Schema.String,
  claudeDescription: Schema.String,
  cursorDescription: Schema.String,
});

export type PluginSource = typeof PluginSource.Type;
export type MarketplaceSource = typeof MarketplaceSource.Type;

type Json = string | boolean | readonly Json[] | { readonly [key: string]: Json };

/** Renders JSON the way the repository formatter does: expanded objects, inline arrays that fit. */
const emit = (value: Json, indent: string, lead: string, comma: string): string => {
  if (typeof value !== "object") return `${indent}${lead}${JSON.stringify(value)}${comma}`;
  if (Array.isArray(value)) {
    if (value.length === 0) return `${indent}${lead}[]${comma}`;
    if (value.every((item) => typeof item !== "object")) {
      const inline = `[${value.map((item) => JSON.stringify(item)).join(", ")}]`;
      if (indent.length + lead.length + inline.length + comma.length <= PRINT_WIDTH) {
        return `${indent}${lead}${inline}${comma}`;
      }
    }
    const items = value.map((item, index) =>
      emit(item, `${indent}  `, "", index < value.length - 1 ? "," : ""),
    );
    return [`${indent}${lead}[`, ...items, `${indent}]${comma}`].join("\n");
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return `${indent}${lead}{}${comma}`;
  const members = entries.map(([key, member], index) =>
    emit(member, `${indent}  `, `${JSON.stringify(key)}: `, index < entries.length - 1 ? "," : ""),
  );
  return [`${indent}${lead}{`, ...members, `${indent}}${comma}`].join("\n");
};

export const renderJson = (value: Json): string => `${emit(value, "", "", "")}\n`;

const mcpServers = (key: string, server: Json): { readonly mcpServers: Json } => ({
  mcpServers: { [key]: server },
});

const codexManifest = (source: PluginSource): Json => {
  const { listing } = source;
  return {
    name: source.name,
    version: listing.version,
    description: listing.descriptions.codex,
    author: { name: listing.author.name, url: listing.author.url },
    homepage: listing.homepage,
    repository: listing.repository,
    license: listing.license,
    keywords: listing.keywords,
    skills: "./skills/",
    mcpServers: "./.mcp.json",
    interface: {
      displayName: listing.displayName,
      shortDescription: listing.codex.shortDescription,
      longDescription: listing.codex.longDescription,
      developerName: listing.author.name,
      category: listing.category,
      capabilities: listing.codex.capabilities,
      websiteURL: listing.homepage,
      privacyPolicyURL: listing.codex.privacyPolicyURL,
      supportURL: listing.codex.supportURL,
      termsOfServiceURL: listing.codex.termsOfServiceURL,
      defaultPrompt: listing.codex.defaultPrompt,
      brandColor: listing.codex.brandColor,
      composerIcon: `./${listing.icon}`,
      logo: `./${listing.icon}`,
      ...(listing.codex.screenshots === undefined
        ? {}
        : { screenshots: listing.codex.screenshots }),
    },
  };
};

const cursorManifest = (source: PluginSource): Json => {
  const { listing } = source;
  return {
    name: source.name,
    displayName: listing.displayName,
    version: listing.version,
    description: listing.descriptions.cursor,
    author: { name: listing.author.name },
    homepage: listing.homepage,
    repository: listing.repository,
    license: listing.license,
    keywords: listing.keywords,
    logo: listing.icon,
  };
};

const devinManifest = (source: PluginSource, description: string): Json => {
  const { listing } = source;
  return {
    name: source.name,
    displayName: listing.displayName,
    version: source.version,
    description,
    author: { name: listing.author.name },
    homepage: listing.homepage,
    repository: listing.repository,
    license: listing.license,
    logo: listing.icon,
    keywords: [listing.category],
    skills: "skills",
    mcpServers: ".mcp.json",
  };
};

/** Host targets in the order the packer and conformance tools use. */
export const HOST_TARGETS = ["openai", "cursor", "claude", "copilot", "gemini", "devin"] as const;
export type HostTarget = (typeof HOST_TARGETS)[number];

/**
 * Hosts a plugin publishes for. openai (Codex), cursor and claude are always included; copilot,
 * gemini and devin only when the listing has a description for them.
 */
export const hostsOf = (source: PluginSource): readonly HostTarget[] =>
  HOST_TARGETS.filter(
    (host) =>
      host === "openai" ||
      host === "cursor" ||
      host === "claude" ||
      source.listing.descriptions[host] !== undefined,
  );

/** Skill ids declared in plugin.yaml, sorted. */
export const skillIdsOf = (source: PluginSource): readonly string[] =>
  [...source.skills.map(({ id }) => id)].sort();

/** Every generated file of one plugin package, keyed by path relative to the package root. */
export const generatePluginFiles = (source: PluginSource): Readonly<Record<string, string>> => {
  const { listing } = source;
  const url = source.mcp.url;
  const { devin, copilot, gemini } = listing.descriptions;
  return {
    ".codex-plugin/plugin.json": renderJson(codexManifest(source)),
    ".cursor-plugin/plugin.json": renderJson(cursorManifest(source)),
    ...(devin === undefined
      ? {}
      : { ".devin-plugin/plugin.json": renderJson(devinManifest(source, devin)) }),
    ".mcp.json": renderJson(mcpServers(source.name, { type: "http", url })),
    "mcp.json": renderJson(mcpServers(listing.mcpServerName, { url })),
    "targets/claude/.claude-plugin/plugin.json": renderJson({
      name: source.name,
      version: source.version,
      description: listing.descriptions.claude,
      author: { name: listing.author.name },
    }),
    "targets/claude/.mcp.json": renderJson(
      mcpServers(listing.mcpServerName, { type: "http", url }),
    ),
    ...(copilot === undefined
      ? {}
      : {
          "targets/copilot/plugin.json": renderJson({
            $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
            name: source.name,
            version: source.version,
            description: copilot,
            author: { name: listing.author.name },
          }),
          "targets/copilot/mcp.json": renderJson({
            $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
            ...mcpServers(listing.mcpServerName, { type: "streamable-http", url }),
          }),
        }),
    ...(gemini === undefined
      ? {}
      : {
          "targets/gemini/gemini-extension.json": renderJson({
            name: source.name,
            version: source.version,
            description: gemini,
            ...mcpServers(listing.mcpServerName, { httpUrl: url }),
          }),
        }),
  };
};

/** The three root marketplace descriptors, keyed by repo-relative path. */
export const generateMarketplaceFiles = (options: {
  readonly marketplace: MarketplaceSource;
  readonly plugins: readonly PluginSource[];
}): Readonly<Record<string, string>> => {
  const { marketplace, plugins } = options;
  return {
    ".claude-plugin/marketplace.json": renderJson({
      name: marketplace.name,
      owner: { name: marketplace.owner.name, url: marketplace.owner.url },
      description: marketplace.claudeDescription,
      version: marketplace.version,
      plugins: plugins.map(({ name, listing }) => ({
        name,
        source: `./plugins/${name}`,
        strict: false,
        skills: "./skills",
        mcpServers: "./targets/claude/.mcp.json",
        displayName: listing.displayName,
        description: listing.descriptions.claude,
        version: listing.version,
        author: { name: listing.author.name, url: listing.author.url },
        homepage: listing.homepage,
        repository: listing.repository,
        license: listing.license,
        keywords: listing.keywords,
      })),
    }),
    ".cursor-plugin/marketplace.json": renderJson({
      name: marketplace.name,
      owner: { name: marketplace.owner.name },
      metadata: { description: marketplace.cursorDescription, version: marketplace.version },
      plugins: plugins.map(({ name, listing }) => ({
        name,
        source: `./plugins/${name}`,
        description: listing.cursorMarketplaceDescription,
      })),
    }),
    ".agents/plugins/marketplace.json": renderJson({
      name: marketplace.name,
      interface: { displayName: marketplace.displayName },
      plugins: plugins.map(({ name, listing }) => ({
        name,
        source: { source: "local", path: `./plugins/${name}` },
        policy: {
          installation: listing.codex.policy.installation,
          authentication: listing.codex.policy.authentication,
        },
        category: listing.category,
      })),
    }),
  };
};

const readYaml = <S extends Schema.Decoder<unknown>>(
  schema: S,
  root: string,
  relative: string,
): Effect.Effect<S["Type"], PluginManifestError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const text = yield* fs
      .readFileString(path.join(root, relative))
      .pipe(Effect.mapError(() => fail(`${relative} cannot be read`)));
    const value = yield* Effect.try({
      try: () => parse(text) as unknown,
      catch: () => fail(`${relative} contains invalid YAML`),
    });
    return yield* Schema.decodeUnknownEffect(schema)(value).pipe(
      Effect.mapError((error) => fail(`${relative} is invalid: ${String(error)}`)),
    );
  }) as Effect.Effect<S["Type"], PluginManifestError, FileSystem.FileSystem | Path.Path>;

/** Reads and validates `<packageRoot>/plugin.yaml`, the source of every manifest of the package. */
export const loadPluginSource = (packageRoot: string) =>
  readYaml(PluginSource, packageRoot, "plugin.yaml");

/** Reads and validates `<repositoryRoot>/marketplace.yaml`, the source of the three marketplaces. */
export const loadMarketplaceSource = (repositoryRoot: string) =>
  readYaml(MarketplaceSource, repositoryRoot, MARKETPLACE_SOURCE_PATH);

/**
 * Loads every `plugins/<name>/plugin.yaml` in directory order. Each plugin's `name` must equal its
 * directory name.
 */
export const loadPluginSources = (root: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directories = yield* fs
      .readDirectory(path.join(root, "plugins"))
      .pipe(Effect.mapError(() => fail("plugins cannot be listed")));
    const plugins: { readonly directory: string; readonly source: PluginSource }[] = [];
    for (const directory of [...directories].sort()) {
      const packageRoot = path.join(root, "plugins", directory);
      const present = yield* fs
        .exists(path.join(packageRoot, "plugin.yaml"))
        .pipe(Effect.mapError(() => fail(`plugins/${directory}/plugin.yaml cannot be inspected`)));
      if (!present) continue;
      const source = yield* loadPluginSource(packageRoot);
      if (source.name !== directory) {
        return yield* fail(
          `plugins/${directory}/plugin.yaml declares name ${source.name}; expected ${directory}`,
        );
      }
      plugins.push({ directory, source });
    }
    return plugins;
  });

/** Every generated file in the repository, keyed by repo-relative path. */
export const generateAllManifests = (root: string) =>
  Effect.gen(function* () {
    const marketplace = yield* loadMarketplaceSource(root);
    const plugins = yield* loadPluginSources(root);
    const files: Record<string, string> = {};
    for (const { directory, source } of plugins) {
      for (const [relative, content] of Object.entries(generatePluginFiles(source))) {
        files[`plugins/${directory}/${relative}`] = content;
      }
    }
    return {
      ...files,
      ...generateMarketplaceFiles({ marketplace, plugins: plugins.map(({ source }) => source) }),
    };
  });

/** Writes every generated manifest, or with `check` fails when any committed file differs. */
export const runPluginManifests = (options: { readonly root: string; readonly check: boolean }) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const files = yield* generateAllManifests(options.root);
    const drifted: string[] = [];
    for (const [relative, content] of Object.entries(files)) {
      const target = path.join(options.root, relative);
      const present = yield* fs
        .exists(target)
        .pipe(Effect.mapError(() => fail(`${relative} cannot be inspected`)));
      const current = present
        ? yield* fs
            .readFileString(target)
            .pipe(Effect.mapError(() => fail(`${relative} cannot be read`)))
        : undefined;
      if (current === content) continue;
      drifted.push(relative);
      if (options.check) continue;
      yield* fs
        .makeDirectory(path.dirname(target), { recursive: true })
        .pipe(Effect.mapError(() => fail(`${relative} directory cannot be created`)));
      yield* fs
        .writeFileString(target, content)
        .pipe(Effect.mapError(() => fail(`${relative} cannot be written`)));
    }
    if (options.check && drifted.length > 0) {
      return yield* new PluginManifestError({
        problems: [
          ...drifted.map((relative) => `${relative} is out of date`),
          "Run bun run manifests:generate and commit the result.",
        ],
      });
    }
    const total = Object.keys(files).length;
    return yield* Console.log(
      options.check
        ? `${total} generated manifests are up to date`
        : `Wrote ${drifted.length} of ${total} generated manifests`,
    );
  });

if (import.meta.main) {
  const main = Layer.build(BunServices.layer).pipe(
    Effect.flatMap((context) =>
      runPluginManifests({ root: process.cwd(), check: process.argv.includes("--check") }).pipe(
        Effect.provide(context),
      ),
    ),
    Effect.scoped,
  );
  BunRuntime.runMain(main);
}
