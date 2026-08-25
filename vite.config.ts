import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    ignorePatterns: ["dist/**"],
  },
  lint: {
    options: {
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
        command: "vp check .",
        output: [],
      },
      tests: {
        command: "vp test --run",
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
    },
  },
});
