import { gunzipSync } from "node:zlib";

import { ChildProcess } from "effect/unstable/process";
import type { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";
import { Data, Effect, FileSystem, Function, Path } from "effect";

const TAR_BLOCK_BYTES = 512;
const TAR_END_BYTES = TAR_BLOCK_BYTES * 2;
const utf8 = new TextDecoder("utf-8", { fatal: true });

export interface ArchiveLimits {
  readonly maxCompressedBytes: number;
  readonly maxMembers: number;
  readonly maxFileBytes: number;
  readonly maxExpandedBytes: number;
  readonly maxDepth: number;
  readonly maxPathLength: number;
  readonly maxTimestampSeconds: number;
}

export const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = {
  maxCompressedBytes: 64 * 1024 * 1024,
  maxMembers: 10_000,
  maxFileBytes: 16 * 1024 * 1024,
  maxExpandedBytes: 128 * 1024 * 1024,
  maxDepth: 32,
  maxPathLength: 512,
  maxTimestampSeconds: 4_102_444_800,
};

export interface ArchiveMember {
  readonly path: string;
  readonly type: "file" | "directory";
  readonly size: number;
}

export interface TarPreflight {
  readonly compressedBytes: number;
  readonly expandedBytes: number;
  readonly members: readonly ArchiveMember[];
}

export class ArchiveSecurityError extends Data.TaggedError("ArchiveSecurityError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const fail = (message: string, cause?: unknown): ArchiveSecurityError =>
  new ArchiveSecurityError(cause === undefined ? { message } : { message, cause });

const ascii = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

const fieldBytes = (header: Uint8Array, offset: number, length: number): Uint8Array => {
  const field = header.subarray(offset, offset + length);
  const nul = field.indexOf(0);
  if (nul >= 0 && field.subarray(nul).some((byte) => byte !== 0))
    throw fail("tar header field contains data after NUL");
  return field.subarray(0, nul < 0 ? field.length : nul);
};

const parseText = (header: Uint8Array, offset: number, length: number, label: string): string => {
  try {
    return utf8.decode(fieldBytes(header, offset, length));
  } catch (cause) {
    throw cause instanceof ArchiveSecurityError
      ? cause
      : fail(`${label} is not valid UTF-8`, cause);
  }
};

const parseOctal = (header: Uint8Array, offset: number, length: number, label: string): number => {
  const field = ascii(header.subarray(offset, offset + length));
  if (/^[ \0]*$/u.test(field)) return 0;
  if (!/^ *[0-7]+[\0 ]*$/u.test(field)) throw fail(`${label} is not a POSIX octal number`);
  const digits = field.match(/[0-7]+/u)?.[0];
  if (digits === undefined) throw fail(`${label} is not a POSIX octal number`);
  const value = Number.parseInt(digits, 8);
  if (!Number.isSafeInteger(value)) throw fail(`${label} exceeds the safe integer range`);
  return value;
};

const isZeroBlock = (bytes: Uint8Array, offset: number): boolean => {
  for (let index = offset; index < offset + TAR_BLOCK_BYTES; index += 1) {
    if (bytes[index] !== 0) return false;
  }
  return true;
};

const verifyHeader = (header: Uint8Array): void => {
  const declared = parseOctal(header, 148, 8, "tar checksum");
  let actual = 0;
  for (let index = 0; index < TAR_BLOCK_BYTES; index += 1)
    actual += index >= 148 && index < 156 ? 0x20 : (header[index] ?? 0);
  if (declared !== actual) throw fail("tar header checksum does not match");
  const magic = ascii(header.subarray(257, 263));
  if (magic !== "ustar\0" && magic !== "ustar ") throw fail("tar header is not POSIX ustar");
};

const resolveLimits = (overrides: Partial<ArchiveLimits>): ArchiveLimits => {
  const limits: ArchiveLimits = { ...DEFAULT_ARCHIVE_LIMITS, ...overrides };
  for (const key of [
    "maxCompressedBytes",
    "maxMembers",
    "maxFileBytes",
    "maxExpandedBytes",
    "maxDepth",
    "maxPathLength",
  ] as const) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] <= 0)
      throw fail(`archive limit ${key} must be a positive safe integer`);
  }
  if (!Number.isSafeInteger(limits.maxTimestampSeconds) || limits.maxTimestampSeconds < 0)
    throw fail("archive limit maxTimestampSeconds must be a non-negative safe integer");
  return limits;
};

const maximumTarBytes = (limits: ArchiveLimits): number => {
  const maximum = limits.maxExpandedBytes + limits.maxMembers * TAR_BLOCK_BYTES * 2 + TAR_END_BYTES;
  if (!Number.isSafeInteger(maximum)) throw fail("archive limits are too large");
  return maximum;
};

const normalizePath = (
  name: string,
  prefix: string,
  type: ArchiveMember["type"],
  limits: ArchiveLimits,
): string => {
  const raw = prefix.length > 0 ? `${prefix}/${name}` : name;
  if (type === "directory" && (raw === "." || raw === "./")) return ".";
  const withoutTarPrefix = raw.startsWith("./") ? raw.slice(2) : raw;
  const path = type === "directory" ? withoutTarPrefix.replace(/\/+$/u, "") : withoutTarPrefix;
  const hasControlCharacter = (() => {
    for (let index = 0; index < path.length; index += 1) {
      const code = path.charCodeAt(index);
      if (code <= 0x1f || code === 0x7f) return true;
    }
    return false;
  })();
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    /^[A-Za-z]:/u.test(path) ||
    path.includes("\\") ||
    hasControlCharacter
  )
    throw fail("tar member path is unsafe");
  const segments = path.split("/");
  if (
    segments.length > limits.maxDepth ||
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
  )
    throw fail("tar member path is unsafe or too deep");
  if (new TextEncoder().encode(path).byteLength > limits.maxPathLength)
    throw fail("tar member path is too long");
  return path;
};

const parseTar = (
  bytes: Uint8Array,
  compressedBytes: number,
  limits: ArchiveLimits,
): TarPreflight => {
  if (bytes.byteLength > maximumTarBytes(limits))
    throw fail("decompressed tar exceeds its byte bound");
  if (bytes.byteLength < TAR_END_BYTES || bytes.byteLength % TAR_BLOCK_BYTES !== 0)
    throw fail("tar stream is truncated or not block aligned");

  const members: ArchiveMember[] = [];
  const knownPaths = new Map<string, ArchiveMember["type"]>();
  let expandedBytes = 0;
  let offset = 0;
  let foundEnd = false;
  let foundRoot = false;

  while (offset < bytes.byteLength) {
    if (isZeroBlock(bytes, offset)) {
      if (
        offset + TAR_END_BYTES > bytes.byteLength ||
        !isZeroBlock(bytes, offset + TAR_BLOCK_BYTES)
      )
        throw fail("tar stream is missing its second end block");
      for (let index = offset; index < bytes.byteLength; index += 1) {
        if (bytes[index] !== 0) throw fail("tar stream has data after its end blocks");
      }
      foundEnd = true;
      break;
    }

    const header = bytes.subarray(offset, offset + TAR_BLOCK_BYTES);
    verifyHeader(header);
    parseOctal(header, 100, 8, "tar mode");
    parseOctal(header, 108, 8, "tar uid");
    parseOctal(header, 116, 8, "tar gid");
    const size = parseOctal(header, 124, 12, "tar member size");
    const timestamp = parseOctal(header, 136, 12, "tar member timestamp");
    if (timestamp > limits.maxTimestampSeconds)
      throw fail("tar member timestamp exceeds its bound");
    if (fieldBytes(header, 157, 100).length !== 0)
      throw fail("tar member link target is not permitted");

    const flag = header[156] ?? 0;
    const type: ArchiveMember["type"] | undefined =
      flag === 0 || flag === 0x30 ? "file" : flag === 0x35 ? "directory" : undefined;
    if (type === undefined) throw fail("tar member type is not permitted");
    if (type === "directory" && size !== 0) throw fail("tar directory has a non-zero size");
    if (type === "file" && size > limits.maxFileBytes)
      throw fail("tar member exceeds the file-size bound");

    const path = normalizePath(
      parseText(header, 0, 100, "tar member name"),
      parseText(header, 345, 155, "tar member prefix"),
      type,
      limits,
    );
    if (path === ".") {
      if (foundRoot) throw fail("tar has duplicate root members");
      foundRoot = true;
      offset += TAR_BLOCK_BYTES;
      continue;
    }
    if (knownPaths.has(path)) throw fail("tar has duplicate member paths");
    for (const [otherPath, otherType] of knownPaths) {
      if (otherType === "file" && path.startsWith(`${otherPath}/`))
        throw fail("tar member is nested below a file");
      if (type === "file" && otherPath.startsWith(`${path}/`))
        throw fail("tar file conflicts with an existing member");
    }
    if (members.length >= limits.maxMembers) throw fail("tar member count exceeds its bound");
    if (type === "file") {
      if (expandedBytes > limits.maxExpandedBytes - size)
        throw fail("tar expanded payload exceeds its bound");
      expandedBytes += size;
    }

    const nextOffset =
      offset + TAR_BLOCK_BYTES + Math.ceil(size / TAR_BLOCK_BYTES) * TAR_BLOCK_BYTES;
    if (!Number.isSafeInteger(nextOffset) || nextOffset > bytes.byteLength)
      throw fail("tar member payload is truncated");
    const member: ArchiveMember = { path, type, size };
    members.push(member);
    knownPaths.set(path, type);
    offset = nextOffset;
  }

  if (!foundEnd) throw fail("tar stream is missing its end blocks");
  return { compressedBytes, expandedBytes, members };
};

const checked = <A>(thunk: () => A): Effect.Effect<A, ArchiveSecurityError> =>
  Effect.try({
    try: thunk,
    catch: (cause) =>
      cause instanceof ArchiveSecurityError ? cause : fail("archive check failed", cause),
  });

const readAndPreflightTarGz = (archive: string, limits: ArchiveLimits) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const info = yield* fs
      .stat(archive)
      .pipe(Effect.mapError((cause) => fail(`cannot inspect archive ${archive}`, cause)));
    if (info.type !== "File") return yield* fail("archive must be a regular file");
    const compressedSize = Number(info.size);
    if (!Number.isSafeInteger(compressedSize) || compressedSize > limits.maxCompressedBytes)
      return yield* fail("compressed archive exceeds its byte bound");
    const compressed = yield* fs
      .readFile(archive)
      .pipe(Effect.mapError((cause) => fail(`cannot read archive ${archive}`, cause)));
    if (compressed.byteLength !== compressedSize)
      return yield* fail("archive changed while it was being read");
    const preflight = yield* checked(() => {
      let expanded: Uint8Array;
      try {
        expanded = gunzipSync(compressed, { maxOutputLength: maximumTarBytes(limits) });
      } catch (cause) {
        throw fail("archive is not a bounded gzip stream", cause);
      }
      return parseTar(expanded, compressed.byteLength, limits);
    });
    return { compressed, preflight };
  });

export type PreflightTarGzEffect = Effect.Effect<
  TarPreflight,
  ArchiveSecurityError,
  FileSystem.FileSystem
>;

export const preflightTarGz: {
  (overrides?: Partial<ArchiveLimits>): (archive: string) => PreflightTarGzEffect;
  (archive: string, overrides?: Partial<ArchiveLimits>): PreflightTarGzEffect;
} = Function.dual(
  (args) => typeof args[0] === "string",
  (archive: string, overrides: Partial<ArchiveLimits> = {}): PreflightTarGzEffect =>
    Effect.gen(function* () {
      const limits = yield* checked(() => resolveLimits(overrides));
      return (yield* readAndPreflightTarGz(archive, limits)).preflight;
    }),
);

export type CopyCheckedRegularFileEffect = Effect.Effect<
  void,
  ArchiveSecurityError,
  FileSystem.FileSystem | Path.Path
>;

/**
 * Copies a checked byte snapshot. The destination's parent must already be a directory.
 */
export const copyCheckedRegularFile: {
  (destination: string): (source: string) => CopyCheckedRegularFileEffect;
  (source: string, destination: string): CopyCheckedRegularFileEffect;
} = Function.dual(2, (source: string, destination: string): CopyCheckedRegularFileEffect =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;
    const sourceLink = yield* fs
      .readLink(source)
      .pipe(Effect.match({ onFailure: () => false, onSuccess: () => true }));
    if (sourceLink) return yield* fail("source file must not be a symbolic link");
    const sourceInfo = yield* fs
      .stat(source)
      .pipe(Effect.mapError((cause) => fail(`cannot inspect source file ${source}`, cause)));
    if (sourceInfo.type !== "File") return yield* fail("source file must be a regular file");
    const bytes = yield* fs
      .readFile(source)
      .pipe(Effect.mapError((cause) => fail(`cannot read source file ${source}`, cause)));
    if (bytes.byteLength !== Number(sourceInfo.size))
      return yield* fail("source file changed while it was being read");

    const parent = paths.dirname(destination);
    const parentLink = yield* fs
      .readLink(parent)
      .pipe(Effect.match({ onFailure: () => false, onSuccess: () => true }));
    if (parentLink) {
      return yield* fail(`destination parent must not be a symbolic link: ${parent}`);
    }
    const parentInfo = yield* fs
      .stat(parent)
      .pipe(
        Effect.mapError((cause) =>
          fail(`destination parent must be an existing directory: ${parent}`, cause),
        ),
      );
    if (parentInfo.type !== "Directory")
      return yield* fail(`destination parent must be an existing directory: ${parent}`);
    const destinationLink = yield* fs
      .readLink(destination)
      .pipe(Effect.match({ onFailure: () => false, onSuccess: () => true }));
    if (destinationLink) return yield* fail("destination file must not be a symbolic link");
    const destinationExists = yield* fs
      .exists(destination)
      .pipe(
        Effect.mapError((cause) => fail(`cannot inspect destination file ${destination}`, cause)),
      );
    if (destinationExists) return yield* fail("destination file must be absent");
    yield* fs
      .writeFile(destination, bytes, { flag: "wx" })
      .pipe(
        Effect.mapError((cause) => fail(`cannot write checked snapshot to ${destination}`, cause)),
      );
  }),
);

const ensureEmptyDestination = (destination: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const symbolicLink = yield* fs
      .readLink(destination)
      .pipe(Effect.match({ onFailure: () => false, onSuccess: () => true }));
    if (symbolicLink) return yield* fail("extraction destination must not be a symbolic link");
    const exists = yield* fs
      .exists(destination)
      .pipe(
        Effect.mapError((cause) =>
          fail(`cannot inspect extraction destination ${destination}`, cause),
        ),
      );
    if (exists) {
      const entries = yield* fs
        .readDirectory(destination)
        .pipe(
          Effect.mapError((cause) =>
            fail(`extraction destination is not a directory: ${destination}`, cause),
          ),
        );
      if (entries.length > 0) return yield* fail("extraction destination must be empty");
    } else {
      yield* fs
        .makeDirectory(destination, { recursive: true })
        .pipe(
          Effect.mapError((cause) =>
            fail(`cannot create extraction destination ${destination}`, cause),
          ),
        );
    }
  });

const runTar = (archive: string, destination: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const child = yield* ChildProcess.make(
        "tar",
        ["-xzf", archive, "--no-same-owner", "--no-same-permissions", "-C", destination],
        {
          cwd: process.cwd(),
          env: {
            PATH: "/usr/bin:/bin",
            HOME: destination,
            LC_ALL: "C",
            TZ: "UTC",
            GIT_CONFIG_NOSYSTEM: "1",
          },
          extendEnv: false,
          stdin: "ignore",
          stdout: "ignore",
          stderr: "ignore",
        },
      ).pipe(Effect.mapError((cause) => fail("cannot start tar extraction", cause)));
      const exitCode = yield* child.exitCode.pipe(
        Effect.mapError((cause) => fail("cannot wait for tar extraction", cause)),
      );
      if (exitCode !== 0) return yield* fail(`tar extraction exited with ${exitCode}`);
    }),
  );

const scanExtractedTree = (destination: string, preflight: TarPreflight, limits: ArchiveLimits) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;
    const root = paths.resolve(destination);
    const expected = new Map(preflight.members.map((member) => [member.path, member]));
    const seen = new Set<string>();
    let memberCount = 0;
    let expandedBytes = 0;

    const visit = (absolute: string, relative: string): Effect.Effect<void, ArchiveSecurityError> =>
      Effect.gen(function* () {
        const names = yield* fs
          .readDirectory(absolute)
          .pipe(
            Effect.mapError((cause) => fail(`cannot scan extracted archive at ${absolute}`, cause)),
          );
        for (const name of names.sort()) {
          const childRelative = relative.length > 0 ? `${relative}/${name}` : name;
          const childAbsolute = paths.resolve(absolute, name);
          const containment = paths.relative(root, childAbsolute);
          if (
            containment === ".." ||
            containment.startsWith(`..${paths.sep}`) ||
            paths.isAbsolute(containment)
          )
            return yield* fail("extracted member escapes its destination");
          const symbolicLink = yield* fs
            .readLink(childAbsolute)
            .pipe(Effect.match({ onFailure: () => false, onSuccess: () => true }));
          if (symbolicLink) return yield* fail("extracted archive contains a symbolic link");
          const info = yield* fs
            .stat(childAbsolute)
            .pipe(
              Effect.mapError((cause) =>
                fail(`cannot inspect extracted member ${childRelative}`, cause),
              ),
            );
          const expectedMember = expected.get(childRelative);
          const implicitDirectory =
            info.type === "Directory" &&
            [...expected.keys()].some((candidate) => candidate.startsWith(`${childRelative}/`));
          if (expectedMember === undefined && !implicitDirectory)
            return yield* fail("extracted archive contains an unexpected member");
          memberCount += 1;
          if (memberCount > limits.maxMembers)
            return yield* fail("extracted member count exceeds its bound");
          if (info.type === "Directory") {
            if (expectedMember !== undefined && expectedMember.type !== "directory")
              return yield* fail("extracted archive member type changed");
            if (expectedMember !== undefined) seen.add(childRelative);
            yield* visit(childAbsolute, childRelative);
          } else if (info.type === "File" && expectedMember?.type === "file") {
            const size = Number(info.size);
            if (size !== expectedMember.size || size > limits.maxFileBytes)
              return yield* fail("extracted file size does not match preflight");
            if (expandedBytes > limits.maxExpandedBytes - size)
              return yield* fail("extracted payload exceeds its byte bound");
            expandedBytes += size;
            seen.add(childRelative);
          } else {
            return yield* fail("extracted archive contains an unsupported member type");
          }
        }
      });

    yield* visit(root, "");
    for (const member of preflight.members) {
      if (!seen.has(member.path)) return yield* fail("extracted archive is missing a member");
    }
    if (expandedBytes !== preflight.expandedBytes)
      return yield* fail("extracted payload size differs from preflight");
  });

export type ExtractCheckedTarGzEffect = Effect.Effect<
  TarPreflight,
  ArchiveSecurityError,
  ChildProcessSpawner | FileSystem.FileSystem | Path.Path
>;

export const extractCheckedTarGz: {
  (
    destination: string,
    overrides?: Partial<ArchiveLimits>,
  ): (archive: string) => ExtractCheckedTarGzEffect;
  (
    archive: string,
    destination: string,
    overrides?: Partial<ArchiveLimits>,
  ): ExtractCheckedTarGzEffect;
} = Function.dual(
  (args) => typeof args[0] === "string" && typeof args[1] === "string",
  (
    archive: string,
    destination: string,
    overrides: Partial<ArchiveLimits> = {},
  ): ExtractCheckedTarGzEffect =>
    Effect.scoped(
      Effect.gen(function* () {
        const limits = yield* checked(() => resolveLimits(overrides));
        const fs = yield* FileSystem.FileSystem;
        const paths = yield* Path.Path;
        const { compressed, preflight } = yield* readAndPreflightTarGz(archive, limits);
        const stagingDirectory = yield* fs
          .makeTempDirectoryScoped({ prefix: "askgina-archive-" })
          .pipe(Effect.mapError((cause) => fail("cannot create archive staging directory", cause)));
        const stagedArchive = paths.join(stagingDirectory, "archive.tgz");
        yield* fs
          .writeFile(stagedArchive, compressed)
          .pipe(Effect.mapError((cause) => fail("cannot stage checked archive", cause)));
        yield* ensureEmptyDestination(destination);
        yield* runTar(stagedArchive, destination);
        yield* scanExtractedTree(destination, preflight, limits);
        return preflight;
      }),
    ),
);
