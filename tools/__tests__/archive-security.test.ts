import * as BunServices from "@effect/platform-bun/BunServices";
import { assert, describe, it } from "@effect/vitest";
import { gzipSync } from "node:zlib";
import { Effect, FileSystem, Path } from "effect";

import {
  ArchiveSecurityError,
  copyCheckedRegularFile,
  preflightTarGz,
} from "../archive-security.js";

const BLOCK_BYTES = 512;
const encoder = new TextEncoder();

const writeText = (target: Uint8Array, offset: number, length: number, value: string): void => {
  const bytes = encoder.encode(value);
  if (bytes.byteLength > length) throw new Error("fixture field is too long");
  target.set(bytes, offset);
};

const writeOctal = (target: Uint8Array, offset: number, length: number, value: number): void => {
  writeText(target, offset, length, `${value.toString(8).padStart(length - 1, "0")}\0`);
};

const tarGz = (options: {
  readonly path: string;
  readonly type?: string;
  readonly body?: string;
  readonly declaredSize?: number;
  readonly link?: string;
}): Uint8Array => {
  const body = encoder.encode(options.body ?? "");
  const size = options.declaredSize ?? body.byteLength;
  const header = new Uint8Array(BLOCK_BYTES);
  writeText(header, 0, 100, options.path);
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  writeText(header, 156, 1, options.type ?? "0");
  if (options.link !== undefined) writeText(header, 157, 100, options.link);
  writeText(header, 257, 6, "ustar\0");
  writeText(header, 263, 2, "00");
  let checksum = 0;
  for (const byte of header) checksum += byte;
  writeText(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);

  const payloadBlocks = Math.ceil(body.byteLength / BLOCK_BYTES);
  const tar = new Uint8Array(BLOCK_BYTES + payloadBlocks * BLOCK_BYTES + BLOCK_BYTES * 2);
  tar.set(header);
  tar.set(body, BLOCK_BYTES);
  return gzipSync(tar);
};

const preflightFixture = (bytes: Uint8Array, limits = {}) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const paths = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "archive-security-test-" });
      const archive = paths.join(directory, "fixture.tgz");
      yield* fs.writeFile(archive, bytes);
      return yield* preflightTarGz(archive, limits);
    }),
  );

const rejectFixture = (bytes: Uint8Array, limits = {}) =>
  preflightFixture(bytes, limits).pipe(Effect.flip);

describe("archive security", () => {
  it.layer(BunServices.layer)((it) => {
    it.effect("rejects a symbolic-link source before mutating the destination", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const paths = yield* Path.Path;
          const directory = yield* fs.makeTempDirectoryScoped({
            prefix: "archive-security-copy-test-",
          });
          const target = paths.join(directory, "target.txt");
          const source = paths.join(directory, "source.txt");
          const destination = paths.join(directory, "destination.txt");
          yield* fs.writeFileString(target, "source bytes");
          yield* fs.symlink(target, source);
          yield* fs.writeFileString(destination, "destination marker");

          const error = yield* copyCheckedRegularFile(source, destination).pipe(Effect.flip);

          assert.instanceOf(error, ArchiveSecurityError);
          assert.include(error.message, "symbolic link");
          assert.strictEqual(yield* fs.readFileString(destination), "destination marker");
        }),
      ),
    );

    it.effect("retains copied bytes after the source path is replaced", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const paths = yield* Path.Path;
          const directory = yield* fs.makeTempDirectoryScoped({
            prefix: "archive-security-copy-test-",
          });
          const source = paths.join(directory, "source.txt");
          const destination = paths.join(directory, "destination.txt");
          yield* fs.writeFileString(source, "original bytes");

          yield* copyCheckedRegularFile(source, destination);
          yield* fs.remove(source);
          yield* fs.writeFileString(source, "replacement bytes");

          assert.strictEqual(yield* fs.readFileString(destination), "original bytes");
        }),
      ),
    );

    it.effect("accepts and excludes the synthetic GNU tar root directory", () =>
      Effect.gen(function* () {
        const result = yield* preflightFixture(tarGz({ path: "./", type: "5" }));
        assert.deepStrictEqual(result.members, []);
      }),
    );

    it.effect("rejects symbolic links, hard links, and extended metadata", () =>
      Effect.gen(function* () {
        for (const fixture of [
          tarGz({ path: "link", type: "2", link: "target" }),
          tarGz({ path: "hard", type: "1", link: "target" }),
          tarGz({ path: "pax", type: "x" }),
        ]) {
          const error = yield* rejectFixture(fixture);
          assert.instanceOf(error, ArchiveSecurityError);
          assert.include(error.message, "not permitted");
        }
      }),
    );

    it.effect("rejects a parent-directory traversal path", () =>
      Effect.gen(function* () {
        const error = yield* rejectFixture(tarGz({ path: "../escape", body: "x" }));
        assert.instanceOf(error, ArchiveSecurityError);
        assert.include(error.message, "path");
      }),
    );

    it.effect("rejects a declared file size above the configured resource bound", () =>
      Effect.gen(function* () {
        const error = yield* rejectFixture(tarGz({ path: "large", body: "12345" }), {
          maxFileBytes: 4,
          maxExpandedBytes: 4,
        });
        assert.instanceOf(error, ArchiveSecurityError);
        assert.include(error.message, "file-size");
      }),
    );
  });
});
