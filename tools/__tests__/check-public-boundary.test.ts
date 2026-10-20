import { fileURLToPath } from "node:url";

import * as BunServices from "@effect/platform-bun/BunServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";

import {
  expectedArtifactPaths,
  findArtifactInventoryViolations,
  findPublicBinaryBoundaryRules,
  scanPublicBoundaryFile,
} from "../check-public-boundary";
import { loadArtifactPackages } from "../pack-artifacts";
import { isAttestedPublicSourceAsset, type PublicSourceAsset } from "../public-source-assets";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const WOFF2 = Uint8Array.from([0x77, 0x4f, 0x46, 0x32, 0, 1, 2, 3]);
const WEBP = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 12, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0, 1, 2, 3,
]);
const FONT_PATH = "apps/evals/public/fonts/geist-mono.woff2";
const IMAGE_PATH = "apps/evals/public/images/hero-watercolor-landscape.webp";
const inventory: readonly PublicSourceAsset[] = [
  {
    path: FONT_PATH,
    sha256: "c6f0ff524cb7be6c8041911340f7e56f2d3b34811fc9b17f6a12b08be1a2d36e",
    bytes: WOFF2.length,
    kind: "woff2",
  },
  {
    path: IMAGE_PATH,
    sha256: "12c48730f5bef13fde7532d8197e4a6a5d0c6e6efbfa9fb5aabe71618b327e61",
    bytes: WEBP.length,
    kind: "webp",
  },
];

describe("public binary boundary", () => {
  it("requires an exact path, digest and JPEG signature for reviewed screenshots", () => {
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0, 0xff, 0xd9]);
    const label = "docs/images/product/example.jpg";
    const assets: readonly PublicSourceAsset[] = [
      {
        path: label,
        bytes: jpeg.length,
        kind: "jpeg",
        sha256: "1d4d47030772999b01d3d1ba14be0f13ce77efc2860086dfaefdb0e8bacf6b2b",
      },
    ];
    assert.deepStrictEqual(findPublicBinaryBoundaryRules(label, jpeg, assets), []);
    assert.deepStrictEqual(
      findPublicBinaryBoundaryRules("docs/images/product/other.jpg", jpeg, assets),
      ["unscannable-binary-file"],
    );
    const changed = Uint8Array.from(jpeg);
    changed[3] = 1;
    assert.deepStrictEqual(findPublicBinaryBoundaryRules(label, changed, assets), [
      "unscannable-binary-file",
    ]);
    assert.isFalse(
      isAttestedPublicSourceAsset(IMAGE_PATH, WEBP, [{ ...inventory[1]!, kind: "jpeg" }]),
    );
  });

  it("admits only attested app bytes at their reviewed paths", () => {
    assert.deepStrictEqual(findPublicBinaryBoundaryRules(FONT_PATH, WOFF2, inventory), []);
    assert.deepStrictEqual(findPublicBinaryBoundaryRules(IMAGE_PATH, WEBP, inventory), []);
    assert.deepStrictEqual(findPublicBinaryBoundaryRules(WOFF2, inventory)(FONT_PATH), []);
    assert.deepStrictEqual(findPublicBinaryBoundaryRules(WEBP, inventory)(IMAGE_PATH), []);
    assert.isTrue(isAttestedPublicSourceAsset(FONT_PATH, WOFF2, inventory));
    assert.isTrue(isAttestedPublicSourceAsset(WOFF2, inventory)(FONT_PATH));
    assert.isTrue(isAttestedPublicSourceAsset(WEBP, inventory)(IMAGE_PATH));
  });

  it("rejects tampered, misplaced, and unlisted binaries", () => {
    assert.deepStrictEqual(
      findPublicBinaryBoundaryRules(FONT_PATH, new TextEncoder().encode("not a font"), inventory),
      ["unscannable-binary-file"],
    );
    const tampered = Uint8Array.from(WOFF2);
    tampered[tampered.length - 1] = 9;
    assert.deepStrictEqual(findPublicBinaryBoundaryRules(FONT_PATH, tampered, inventory), [
      "unscannable-binary-file",
    ]);
    assert.deepStrictEqual(
      findPublicBinaryBoundaryRules("apps/evals/src/geist-mono.woff2", WOFF2, inventory),
      ["unscannable-binary-file"],
    );
    assert.deepStrictEqual(
      findPublicBinaryBoundaryRules("apps/evals/public/fonts/unlisted.woff2", WOFF2, inventory),
      ["unscannable-binary-file"],
    );
    assert.deepStrictEqual(findPublicBinaryBoundaryRules(tampered, inventory)(FONT_PATH), [
      "unscannable-binary-file",
    ]);
    assert.deepStrictEqual(
      findPublicBinaryBoundaryRules(WOFF2, inventory)("apps/evals/src/geist-mono.woff2"),
      ["unscannable-binary-file"],
    );
    assert.deepStrictEqual(
      findPublicBinaryBoundaryRules(WOFF2, inventory)("apps/evals/public/fonts/unlisted.woff2"),
      ["unscannable-binary-file"],
    );
    assert.isFalse(isAttestedPublicSourceAsset(tampered, inventory)(FONT_PATH));
    assert.isFalse(
      isAttestedPublicSourceAsset(WOFF2, inventory)("apps/evals/src/geist-mono.woff2"),
    );
    assert.isFalse(
      isAttestedPublicSourceAsset(WOFF2, inventory)("apps/evals/public/fonts/unlisted.woff2"),
    );
  });

  it("admits only reviewed documentation PNGs at their declared paths", () => {
    for (const reviewedPath of [
      "docs/images/product/wallet-balance.png",
      "docs/images/clients/grok-bot.png",
      "docs/images/clients/hermes.png",
    ]) {
      assert.deepStrictEqual(findPublicBinaryBoundaryRules(reviewedPath, PNG), []);
      assert.deepStrictEqual(
        findPublicBinaryBoundaryRules(
          reviewedPath,
          Uint8Array.from([0xff, 0xd8, 0xff, 0, 0xff, 0xd9]),
        ),
        ["unscannable-binary-file"],
      );
    }
    assert.deepStrictEqual(
      findPublicBinaryBoundaryRules("docs/images/product/unreviewed.png", PNG),
      ["unscannable-binary-file"],
    );
    assert.deepStrictEqual(
      findPublicBinaryBoundaryRules("docs/images/clients/unreviewed.png", PNG),
      ["unscannable-binary-file"],
    );
  });

  it("keeps OpenAI PNG admission path-bound", () => {
    assert.deepStrictEqual(
      findPublicBinaryBoundaryRules("plugins/ask-gina/assets/hyperliquid-chart.png", PNG),
      [],
    );
    assert.deepStrictEqual(
      findPublicBinaryBoundaryRules(PNG)("plugins/ask-gina/assets/hyperliquid-chart.png"),
      [],
    );
    assert.deepStrictEqual(
      findPublicBinaryBoundaryRules(
        "dist/targets/ask-gina-openai-1.0.0.tgz:assets/hyperliquid-chart.png",
        PNG,
      ),
      [],
    );
    assert.deepStrictEqual(
      findPublicBinaryBoundaryRules("apps/evals/public/images/hyperliquid-chart.png", PNG),
      ["unscannable-binary-file"],
    );
  });

  it("admits reviewed PNGs only for their own package", () => {
    const rejected = ["unscannable-binary-file"];
    assert.deepStrictEqual(
      findPublicBinaryBoundaryRules(
        "dist/targets/ask-gina-cursor-1.0.0.tgz:assets/hyperliquid-chart.png",
        PNG,
      ),
      [],
    );
    for (const label of [
      "plugins/ask-gina-spot/assets/hyperliquid-chart.png",
      "dist/targets/ask-gina-spot-openai-1.0.0.tgz:assets/hyperliquid-chart.png",
      "dist/targets/ask-gina-spot-cursor-1.0.0.tgz:assets/hyperliquid-chart.png",
      "dist/skills/ask-gina-spot-skills-1.0.0.tgz:assets/hyperliquid-chart.png",
    ]) {
      assert.deepStrictEqual(findPublicBinaryBoundaryRules(label, PNG), rejected, label);
    }
  });

  it("rejects lookalike bytes at reviewed app paths", () => {
    assert.deepStrictEqual(findPublicBinaryBoundaryRules(FONT_PATH, WOFF2), [
      "unscannable-binary-file",
    ]);
    assert.deepStrictEqual(findPublicBinaryBoundaryRules(WOFF2)(FONT_PATH), [
      "unscannable-binary-file",
    ]);
    assert.isFalse(isAttestedPublicSourceAsset(FONT_PATH, WOFF2));
    assert.isFalse(isAttestedPublicSourceAsset(WOFF2)(FONT_PATH));
  });
});

const scanTextFixture = (text: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const paths = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "public-boundary-test-" });
      const file = paths.join(directory, "fixture.txt");
      yield* fs.writeFileString(file, text);
      const findings: { rule: string; path: string }[] = [];
      yield* scanPublicBoundaryFile(file, "fixture.txt", false, (rule, path) => {
        findings.push({ rule, path });
      });
      return findings;
    }),
  );

const GINA_HOSTS = ["openai", "cursor", "claude", "copilot", "gemini", "devin"] as const;
const SPOT_HOSTS = ["openai", "cursor", "claude", "copilot", "devin"] as const;
const bothPackages = [
  { name: "ask-gina", hosts: GINA_HOSTS },
  { name: "ask-gina-spot", hosts: SPOT_HOSTS },
] as const;

describe("artifact inventory", () => {
  it("expects every package's host archives and skills archive", () => {
    const expected = expectedArtifactPaths({ version: "1.0.0", packages: bothPackages });
    for (const host of GINA_HOSTS) {
      assert.include(expected, `targets/ask-gina-${host}-1.0.0.tgz`);
    }
    for (const host of SPOT_HOSTS) {
      assert.include(expected, `targets/ask-gina-spot-${host}-1.0.0.tgz`);
    }
    assert.include(expected, "skills/ask-gina-skills-1.0.0.tgz");
    assert.include(expected, "skills/ask-gina-spot-skills-1.0.0.tgz");
    assert.notInclude(expected, "targets/ask-gina-spot-gemini-1.0.0.tgz");
    assert.strictEqual(
      expected.length,
      5 + GINA_HOSTS.length + SPOT_HOSTS.length + 2 + 4,
      "five npm archives, host archives, two skills archives, four receipts",
    );
  });

  it("flags a spot archive missing from dist", () => {
    const expected = expectedArtifactPaths({ version: "1.0.0", packages: bothPackages });
    const missing = "targets/ask-gina-spot-openai-1.0.0.tgz";
    assert.deepStrictEqual(
      findArtifactInventoryViolations({
        expected,
        actual: expected.filter((file) => file !== missing),
      }),
      [{ rule: "missing-artifact", path: `dist/${missing}` }],
    );
    assert.deepStrictEqual(findArtifactInventoryViolations({ expected, actual: expected }), []);
  });

  it("flags spot archives that the expected list omits", () => {
    const actual = expectedArtifactPaths({ version: "1.0.0", packages: bothPackages });
    const expected = expectedArtifactPaths({ version: "1.0.0", packages: [bothPackages[0]] });
    assert.deepStrictEqual(
      findArtifactInventoryViolations({ expected, actual }).map(({ rule }) => rule),
      Array.from({ length: SPOT_HOSTS.length + 1 }, () => "extra-artifact"),
    );
  });

  it.layer(BunServices.layer)((it) => {
    it.effect("derives the expected list from the repository's plugin packages", () =>
      Effect.gen(function* () {
        const packages = yield* loadArtifactPackages({ root: repositoryRoot });
        assert.deepStrictEqual(
          packages.map(({ name }) => name),
          ["ask-gina", "ask-gina-spot"],
        );
        const expected = expectedArtifactPaths({ version: "1.0.0", packages });
        for (const plugin of packages) {
          assert.include(expected, `skills/${plugin.name}-skills-1.0.0.tgz`);
          for (const host of plugin.hosts) {
            assert.include(expected, `targets/${plugin.name}-${host}-1.0.0.tgz`);
          }
        }
      }),
    );

    it.effect("scans the tracked source of ask-gina-spot with the same rules", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const paths = yield* Path.Path;
        const spotRoot = paths.join(repositoryRoot, "plugins", "ask-gina-spot");
        const scanned: string[] = [];
        const findings: { rule: string; path: string }[] = [];
        for (const relative of yield* fs.readDirectory(spotRoot, { recursive: true })) {
          const absolute = paths.join(spotRoot, relative);
          if ((yield* fs.stat(absolute)).type !== "File") continue;
          scanned.push(relative);
          const label = `plugins/ask-gina-spot/${relative}`;
          yield* scanPublicBoundaryFile(absolute, label, false, (rule, path) => {
            findings.push({ rule, path });
          });
        }
        for (const required of ["README.md", "plugin.yaml", ".mcp.json"]) {
          assert.include(scanned, required);
        }
        assert.isTrue(scanned.some((file) => file.endsWith(".py")));
        assert.deepStrictEqual(findings, []);
      }),
    );

    it.effect("rejects a private host in spot documentation", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const paths = yield* Path.Path;
          const directory = yield* fs.makeTempDirectoryScoped({ prefix: "public-boundary-spot-" });
          const file = paths.join(directory, "README.md");
          yield* fs.writeFileString(
            file,
            `Callback ${["http:", "", "localhost:8787/callback"].join("/")}\n`,
          );
          const findings: { rule: string; path: string }[] = [];
          yield* scanPublicBoundaryFile(
            file,
            "plugins/ask-gina-spot/README.md",
            false,
            (rule, path) => {
              findings.push({ rule, path });
            },
          );
          assert.deepStrictEqual(findings, [
            { rule: "private-host", path: "plugins/ask-gina-spot/README.md" },
          ]);
        }),
      ),
    );
  });
});

describe("public file boundary", () => {
  it.layer(BunServices.layer)((it) => {
    it.effect("accepts clean text larger than 2 MiB", () =>
      Effect.gen(function* () {
        const findings = yield* scanTextFixture(" ".repeat(2 * 1024 * 1024 + 1));
        assert.deepStrictEqual(findings, []);
      }),
    );

    it.effect("detects a forbidden repository marker after the former 2 MiB boundary", () =>
      Effect.gen(function* () {
        const marker = ["nextjs", "-ai-chatbot"].join("");
        const findings = yield* scanTextFixture(" ".repeat(2 * 1024 * 1024) + marker);
        assert.deepStrictEqual(findings, [
          { rule: "private-repository-name", path: "fixture.txt" },
        ]);
      }),
    );

    it.effect("scans a forbidden tail marker at exactly 16 MiB", () =>
      Effect.gen(function* () {
        const marker = ["nextjs", "-ai-chatbot"].join("");
        const findings = yield* scanTextFixture(
          " ".repeat(16 * 1024 * 1024 - marker.length) + marker,
        );
        assert.deepStrictEqual(findings, [
          { rule: "private-repository-name", path: "fixture.txt" },
        ]);
      }),
    );

    it.effect("rejects files larger than 16 MiB as unscannable", () =>
      Effect.gen(function* () {
        const findings = yield* scanTextFixture(" ".repeat(16 * 1024 * 1024 + 1));
        assert.deepStrictEqual(findings, [
          { rule: "unscannable-oversized-file", path: "fixture.txt" },
        ]);
      }),
    );

    it.effect("rejects a file that grows beyond 16 MiB after stat without scanning its tail", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const paths = yield* Path.Path;
          const directory = yield* fs.makeTempDirectoryScoped({ prefix: "public-boundary-test-" });
          const file = paths.join(directory, "fixture.txt");
          yield* fs.writeFileString(file, "clean");
          const marker = ["nextjs", "-ai-chatbot"].join("");
          const text = " ".repeat(16 * 1024 * 1024 + 1 - marker.length) + marker;
          const findings: { rule: string; path: string }[] = [];
          yield* scanPublicBoundaryFile(file, "fixture.txt", false, (rule, path) => {
            findings.push({ rule, path });
          }).pipe(
            Effect.provideService(FileSystem.FileSystem, {
              ...fs,
              readFile: (path) =>
                fs.writeFileString(path, text).pipe(Effect.andThen(fs.readFile(path))),
            }),
          );
          assert.deepStrictEqual(findings, [
            { rule: "unscannable-oversized-file", path: "fixture.txt" },
          ]);
        }),
      ),
    );
  });
});
