import { createHash } from "node:crypto";
import { Function } from "effect";

export type PublicSourceAssetKind = "woff2" | "webp" | "png" | "ico";

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
  // User-supplied Cognition avatars, verified for light and dark themes.
  {
    path: "apps/evals/public/images/model-logos/cognition-avatar-black.png",
    sha256: "b1fb2f8df71414bd998dc964dd5554f46cb5ac773073457833e57afc5341a3c2",
    bytes: 21810,
    kind: "png",
  },
  {
    path: "apps/evals/public/images/model-logos/cognition-avatar-white.png",
    sha256: "ec8073d7c7a35036d2d7dfce43de9df2639d4739ff5547a2d57ca97b2f4714eb",
    bytes: 20973,
    kind: "png",
  },
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
  {
    path: "apps/evals/public/apple-touch-icon.png",
    sha256: "649853e67f8eba6da365192d1725a27978928d6b99702234990398044ff88480",
    bytes: 4200,
    kind: "png",
  },
  {
    path: "apps/evals/public/favicon.ico",
    sha256: "00d7f7999e1d6890675433f79f195f28dd692cc794b17eacb9656412f6ed3106",
    bytes: 5430,
    kind: "ico",
  },
];

export const isAttestedPublicSourceAsset: {
  (bytes: Uint8Array, inventory?: readonly PublicSourceAsset[]): (label: string) => boolean;
  (label: string, bytes: Uint8Array, inventory?: readonly PublicSourceAsset[]): boolean;
} = Function.dual(
  (args) => typeof args[0] === "string",
  (
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
    if (asset.kind === "webp") {
      return (
        bytes.length >= 12 &&
        WEBP_RIFF.every((value, index) => bytes[index] === value) &&
        WEBP_FOURCC.every((value, index) => bytes[8 + index] === value)
      );
    }
    if (asset.kind === "png") {
      return (
        bytes.length >= 8 &&
        [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
          (value, index) => bytes[index] === value,
        )
      );
    }
    return (
      bytes.length >= 4 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0
    );
  },
);
