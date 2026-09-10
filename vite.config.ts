import { recommended as effectTsgoRecommended } from "@effect/tsgo/oxlint-presets";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { defineConfig } from "vite-plus";
import type { PackUserConfig } from "vite-plus/pack";

const evalsRequire = createRequire(new URL("packages/evals/package.json", import.meta.url));
const codexPackageDirectory = new URL(
  ".",
  pathToFileURL(evalsRequire.resolve("@ai-sdk/harness-codex/package.json")),
);
const evalsCodexBridgeFile = (relativeName: string): string =>
  fileURLToPath(new URL(relativeName, codexPackageDirectory));
const harnessPackageUrl = pathToFileURL(evalsRequire.resolve("@ai-sdk/harness/package.json"));
const evalsHarnessFile = (relativeName: string): string =>
  fileURLToPath(new URL(relativeName, harnessPackageUrl));

const packDefaults = {
  deps: { neverBundle: true },
  dts: true,
  fixedExtension: false,
  format: "esm",
  plugins: [
    {
      name: "strip-unemitted-declaration-map-references",
      generateBundle(_options, bundle) {
        for (const output of Object.values(bundle)) {
          if (output.type === "chunk" && output.fileName.endsWith(".d.ts")) {
            output.code = output.code.replace(
              /\n?\/\/# sourceMappingURL=[^\r\n]+\.d\.ts\.map\s*$/u,
              "\n",
            );
          }
        }
      },
    },
  ],
  sourcemap: true,
} satisfies PackUserConfig;

export default defineConfig({
  pack: [
    {
      ...packDefaults,
      cwd: fileURLToPath(new URL("packages/contracts/", import.meta.url)),
      entry: ["src/index.ts"],
      name: "contracts",
    },
    {
      ...packDefaults,
      cwd: fileURLToPath(new URL("packages/sdk/", import.meta.url)),
      entry: ["src/index.ts"],
      name: "sdk",
    },
    {
      ...packDefaults,
      cwd: fileURLToPath(new URL("packages/cli/", import.meta.url)),
      entry: { bin: "bin.ts", index: "src/index.ts" },
      name: "cli",
    },
    {
      ...packDefaults,
      cwd: fileURLToPath(new URL("packages/evals/", import.meta.url)),
      entry: {
        "bin/check-codex-marketplace": "src/bin/check-codex-marketplace.ts",
        "bin/export-public-results": "src/bin/export-public-results.ts",
        "bin/live": "src/bin/live.ts",
        "bin/replay": "src/bin/replay.ts",
        index: "src/index.ts",
      },
      name: "evals",
      deps: {
        neverBundle: true,
        alwaysBundle: ["@ai-sdk/harness-codex", /^@ai-sdk\/harness(?:\/|$)/u],
      },
      alias: {
        "@ai-sdk/harness-codex": evalsCodexBridgeFile("src/index.ts"),
        "@ai-sdk/harness/agent": evalsHarnessFile("agent/index.ts"),
        "@ai-sdk/harness/utils": evalsHarnessFile("utils/index.ts"),
        "@ai-sdk/harness/bridge": evalsHarnessFile("bridge/index.ts"),
        "@ai-sdk/harness": evalsHarnessFile("src/index.ts"),
      },
      copy: [
        {
          from: evalsCodexBridgeFile("dist/bridge/package.json"),
          to: "dist/bridge",
        },
        {
          from: evalsCodexBridgeFile("dist/bridge/pnpm-lock.yaml"),
          to: "dist/bridge",
        },
        {
          from: evalsCodexBridgeFile("dist/bridge/index.mjs"),
          to: "dist/bridge",
        },
        {
          from: evalsCodexBridgeFile("dist/bridge/codex-sdk-0.153.4.patch"),
          to: "dist/bridge",
        },
      ],
    },
    {
      ...packDefaults,
      cwd: fileURLToPath(new URL("plugins/ask-gina/", import.meta.url)),
      entry: ["src/index.ts"],
      name: "plugin-core",
    },
  ],
  fmt: {
    ignorePatterns: ["dist/**", "apps/*/dist/**"],
  },
  lint: {
    ...effectTsgoRecommended,
    overrides: [
      ...(effectTsgoRecommended.overrides ?? []),
      {
        // The docs workflow runs these standalone Node checks without installing
        // workspace dependencies. Keep general lint rules enabled for both files.
        files: ["tools/docs/check.mjs", "tools/docs/check.test.mjs"],
        rules: {
          "effecttsgo/node-builtin-import": "off",
          "effecttsgo/async-function": "off",
          "effecttsgo/global-console": "off",
          "effecttsgo/global-date": "off",
          "effecttsgo/global-fetch": "off",
        },
      },
    ],
    options: {
      ...effectTsgoRecommended.options,
      typeAware: true,
      typeCheck: true,
    },
  },
  check: {
    fmt: true,
    lint: true,
  },
  test: {
    include: [
      "apps/evals/__tests__/**/*.test.ts",
      "packages/**/__tests__/**/*.test.ts",
      "plugins/**/__tests__/**/*.test.ts",
      "tools/**/__tests__/**/*.test.ts",
    ],
    environment: "node",
  },
  run: {
    enablePrePostScripts: false,
    cache: { scripts: false, tasks: true },
    tasks: {
      quality: {
        command: [
          "vp check .",
          "node_modules/.bin/tsc --noEmit -p tsconfig.json",
          "bun run check:typescript-imports",
        ],
        dependsOn: ["build-packages"],
        output: [],
      },
      "build-packages": {
        command: "vp run --filter '@askgina/*' --fail-if-no-match build",
        input: [{ auto: true }, "!packages/*/dist/**", "!plugins/*/dist/**"],
        output: [
          { pattern: "packages/*/dist/**", base: "workspace" },
          { pattern: "plugins/*/dist/**", base: "workspace" },
        ],
      },
      tests: {
        command: "bun --bun node_modules/.bin/vp test --run",
        dependsOn: ["quality"],
        output: [],
      },
      "build-artifacts": {
        command: "bun tools/pack-artifacts.ts",
        dependsOn: ["tests"],
        input: [{ auto: true }, "!dist/**"],
        output: [{ pattern: "dist/**", base: "workspace" }],
      },
      "verify-artifacts": {
        command: "bun tools/verify-artifacts.ts",
        dependsOn: ["build-artifacts"],
        cache: false,
      },
      "public-boundary": {
        command: "bun tools/check-public-boundary.ts",
        dependsOn: ["build-artifacts"],
        cache: false,
      },
      "target-conformance": {
        command: "bun tools/check-target-conformance.ts",
        dependsOn: ["quality"],
        cache: false,
      },
    },
  },
});
