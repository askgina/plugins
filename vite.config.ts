import { recommended as effectTsgoRecommended } from "@effect/tsgo/oxlint-presets";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";
import type { PackUserConfig } from "vite-plus/pack";

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
        "bin/live": "src/bin/live.ts",
        "bin/replay": "src/bin/replay.ts",
        index: "src/index.ts",
      },
      name: "evals",
    },
    {
      ...packDefaults,
      cwd: fileURLToPath(new URL("plugins/ask-gina/", import.meta.url)),
      entry: ["src/index.ts"],
      name: "plugin-core",
    },
  ],
  fmt: {
    ignorePatterns: ["dist/**"],
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
