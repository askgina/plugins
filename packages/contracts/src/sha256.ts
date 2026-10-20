// Effect `Crypto` is asynchronous; schema filters need a synchronous digest.
// @effect-diagnostics-next-line nodeBuiltinImport:off
import { createHash } from "node:crypto";

export const sha256Hex = (content: string): string =>
  createHash("sha256").update(content, "utf8").digest("hex");
