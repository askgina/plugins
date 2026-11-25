// Effect `Crypto` is asynchronous and whole-buffer; these digests are synchronous and streamed.
// @effect-diagnostics-next-line nodeBuiltinImport:off
import { createHash } from "node:crypto";

/** Preserves JSON array order while sorting every object's own enumerable keys. */
export const canonicalJson = (input: unknown): string =>
  JSON.stringify(input, (_key, value: unknown) =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).sort(([left], [right]) =>
            left < right ? -1 : left > right ? 1 : 0,
          ),
        )
      : value,
  );

export const sha256Hex = (input: string | Uint8Array): string => {
  const hash = createHash("sha256");
  return (typeof input === "string" ? hash.update(input, "utf8") : hash.update(input)).digest(
    "hex",
  );
};

export interface Sha256Stream {
  readonly update: (chunk: Uint8Array) => void;
  readonly digestHex: () => string;
}

/** Incremental SHA-256 for streamed file reads. */
export const createSha256Stream = (): Sha256Stream => {
  const hash = createHash("sha256");
  return {
    update: (chunk) => {
      hash.update(chunk);
    },
    digestHex: () => hash.digest("hex"),
  };
};

export const canonicalJsonSha256 = (input: unknown): string => sha256Hex(canonicalJson(input));
