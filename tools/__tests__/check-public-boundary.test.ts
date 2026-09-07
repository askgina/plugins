import { assert, describe, it } from "@effect/vitest";

import { findPublicBinaryBoundaryRules } from "../check-public-boundary";
import { type PublicSourceAsset } from "../public-source-assets";

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
  it("admits only attested app bytes at their reviewed paths", () => {
    assert.deepStrictEqual(findPublicBinaryBoundaryRules(FONT_PATH, WOFF2, inventory), []);
    assert.deepStrictEqual(findPublicBinaryBoundaryRules(IMAGE_PATH, WEBP, inventory), []);
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
  });

  it("keeps OpenAI PNG admission path-bound", () => {
    assert.deepStrictEqual(
      findPublicBinaryBoundaryRules("plugins/ask-gina/assets/hyperliquid-chart.png", PNG),
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

  it("rejects lookalike bytes at reviewed app paths", () => {
    assert.deepStrictEqual(findPublicBinaryBoundaryRules(FONT_PATH, WOFF2), [
      "unscannable-binary-file",
    ]);
  });
});
