import { createHash } from "node:crypto";

export type PublicSourceAssetKind = "woff2" | "webp";

export type PublicSourceAsset = {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly kind: PublicSourceAssetKind;
};

const SHA_256 = /^[a-f0-9]{64}$/u;
const WOFF2_SIGNATURE = [0x77, 0x4f, 0x46, 0x32] as const;
const WEBP_RIFF = [0x52, 0x49, 0x46, 0x46] as const;
const WEBP_FOURCC = [0x57, 0x45, 0x42, 0x50] as const;

export const PUBLIC_SOURCE_ASSETS: readonly PublicSourceAsset[] = [
  {
    path: "apps/evals/public/fonts/NebulaSans-Book.woff2",
    sha256: "4d396c7c7f93b3f9d8e90d5a8c5e28b29266243946d4320783abc3628d9ef8df",
    bytes: 70652,
    kind: "woff2",
  },
  {
    path: "apps/evals/public/fonts/NebulaSans-Medium.woff2",
    sha256: "5d185acda0c62e1cc156a7508a98c37c56014690e79697c071b0fd2babcb00cb",
    bytes: 71036,
    kind: "woff2",
  },
  {
    path: "apps/evals/public/fonts/NebulaSans-Semibold.woff2",
    sha256: "0e7cd15b1fea9ed847b48f8d53dca88f54f016c352aaa8f895731b3d44d8fc64",
    bytes: 72020,
    kind: "woff2",
  },
  {
    path: "apps/evals/public/fonts/geist-mono.woff2",
    sha256: "d3169faa71ed70a6db519fa5745fda36a38bd0328cb41eb2b7ee09bb3c2b453b",
    bytes: 62216,
    kind: "woff2",
  },
  {
    path: "apps/evals/public/images/hero-watercolor-landscape.webp",
    sha256: "8eb6c16ace76975235321402660b4de444ad55dceb4375bf1148dcdedd4df0c7",
    bytes: 85488,
    kind: "webp",
  },
];

export const isAttestedPublicSourceAsset = (
  label: string,
  bytes: Uint8Array,
  inventory: readonly PublicSourceAsset[] = PUBLIC_SOURCE_ASSETS,
): boolean => {
  const asset = inventory.find((item) => item.path === label);
  if (asset === undefined) return false;
  if (bytes.length !== asset.bytes || !SHA_256.test(asset.sha256)) return false;
  if (createHash("sha256").update(bytes).digest("hex") !== asset.sha256) return false;
  if (asset.kind === "woff2") {
    return bytes.length >= 4 && WOFF2_SIGNATURE.every((value, index) => bytes[index] === value);
  }
  return (
    bytes.length >= 12 &&
    WEBP_RIFF.every((value, index) => bytes[index] === value) &&
    WEBP_FOURCC.every((value, index) => bytes[8 + index] === value)
  );
};
