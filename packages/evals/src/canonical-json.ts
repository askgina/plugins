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

export const canonicalJsonSha256 = (input: unknown): string => sha256Hex(canonicalJson(input));
