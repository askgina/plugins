import { createHash } from "node:crypto";
import {
  decodePublicEvalIndex,
  decodePublicEvalPublication,
  PUBLIC_EVAL_DECODE_OPTIONS,
  PublicEvalIdentifierSchema,
  PublicEvalPublicationSchema,
  PublicEvalSha256Schema,
  type PublicEvalDataOrigin,
  type PublicEvalIndex,
  type PublicEvalPublication,
  type PublicEvalResult,
} from "@askgina/contracts";
import { Data, DateTime, Effect, FileSystem, Option, Path, Schema } from "effect";

import { isSafePublicEvalText } from "./sanitize";

export type PublicEvalPublicationErrorReason =
  | "invalid_request"
  | "invalid_publication"
  | "approval_mismatch"
  | "unsafe_text"
  | "unsafe_path"
  | "index_locked"
  | "index_unreadable"
  | "index_invalid"
  | "origin_mismatch"
  | "unknown_publication"
  | "revision_mismatch"
  | "prior_snapshot_mismatch"
  | "snapshot_exists"
  | "write_failed";

/** Never retain decoder errors, filesystem errors, input values or paths. */
export class PublicEvalPublicationError extends Data.TaggedError("PublicEvalPublicationError")<{
  readonly reason: PublicEvalPublicationErrorReason;
}> {}

export interface PublicEvalPublicationExportOptions {
  readonly publication: unknown;
  readonly outputDirectory: string;
}
export interface PublicEvalPublicationExportResult {
  readonly publicationPath: string;
  readonly indexPath: string;
}

const error = (reason: PublicEvalPublicationErrorReason) => new PublicEvalPublicationError({ reason });
const positiveInt = Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER));
const publicationFields = PublicEvalPublicationSchema.fields;
const requestFields = {
  schemaVersion: Schema.Literal("eval-export-request.v1"),
  publicationId: publicationFields.publicationId,
  revisionId: publicationFields.revisionId,
  revision: publicationFields.revision,
  dataOrigin: publicationFields.dataOrigin,
  publishedAt: publicationFields.publishedAt,
  review: publicationFields.review,
  supersedes: publicationFields.supersedes,
};

export const PublicEvalExportRequestSchema = Schema.Union([
  Schema.Struct({
    ...requestFields,
    kind: Schema.Literal("result"),
    resultId: PublicEvalIdentifierSchema,
    expectedProvenance: Schema.Struct({
      suiteId: PublicEvalIdentifierSchema,
      suiteVersion: positiveInt,
      fixtureVersion: positiveInt,
      catalogSha: PublicEvalSha256Schema,
    }),
    declaredCoverage: Schema.optionalKey(Schema.Struct({
      plannedCases: positiveInt,
      plannedAttempts: positiveInt,
      planSha256: PublicEvalSha256Schema,
      statusSha256: PublicEvalSha256Schema,
    })),
    withholdAttempts: Schema.optionalKey(Schema.Boolean),
  }),
  Schema.Struct({
    ...requestFields,
    kind: Schema.Literal("withdrawal"),
    notice: Schema.Struct({
      reason: Schema.Literals(["privacy", "data_integrity", "owner_request"]),
      withdrawnAt: publicationFields.publishedAt,
      notice: Schema.NonEmptyString.check(Schema.isMaxLength(500), Schema.isPattern(/^[^\p{Cc}]*$/u)),
    }),
  }),
]).check(Schema.makeFilter((request) => {
  if ((request.dataOrigin === "measured") !== (request.review.status === "approved")) return "origin requires its matching review";
  if ((request.revision === 1) !== (request.supersedes === null)) return "revision requires its predecessor";
  if (request.review.status === "approved" && DateTime.isGreaterThan(DateTime.makeUnsafe(request.review.approvedAt), DateTime.makeUnsafe(request.publishedAt))) return "approval must precede publication";
  if (request.supersedes !== null && (
    request.supersedes.revision !== request.revision - 1 ||
    request.supersedes.revisionId === request.revisionId ||
    request.supersedes.reason !== (request.kind === "result" ? "correction" : "withdrawal")
  )) return "invalid predecessor";
  if (request.kind === "withdrawal" && (request.supersedes === null || DateTime.isGreaterThan(DateTime.makeUnsafe(request.notice.withdrawnAt), DateTime.makeUnsafe(request.publishedAt)))) return "invalid withdrawal";
  return undefined;
}));
export type PublicEvalExportRequest = typeof PublicEvalExportRequestSchema.Type;
export type PublicEvalResultExportRequest = Extract<PublicEvalExportRequest, { kind: "result" }>;
export type PublicEvalWithdrawalExportRequest = Extract<PublicEvalExportRequest, { kind: "withdrawal" }>;

/** Only called after strict decoding has excluded caller-supplied fields. */
const hasSafeText = (value: unknown): boolean => {
  if (typeof value === "string") return isSafePublicEvalText(value);
  if (Array.isArray(value)) return value.every(hasSafeText);
  if (value !== null && typeof value === "object") {
    return Object.entries(value).every(([key, item]) => isSafePublicEvalText(key) && hasSafeText(item));
  }
  return true;
};

export const decodePublicEvalExportRequest = (input: unknown): Effect.Effect<PublicEvalExportRequest, PublicEvalPublicationError> =>
  Schema.decodeUnknownEffect(PublicEvalExportRequestSchema, PUBLIC_EVAL_DECODE_OPTIONS)(input).pipe(
    Effect.mapError(() => error("invalid_request")),
    Effect.flatMap((request) => hasSafeText(request) ? Effect.succeed(request) : Effect.fail(error("unsafe_text"))),
  );

const canonicalJson = (input: unknown): string => JSON.stringify(input, (_key, value: unknown) =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0))
    : value);

/** Canonical approval subject; deliberately excludes the approval record itself. */
export const publicEvalPublicationSubjectSha256 = (publication: Omit<PublicEvalPublication, "review">): string =>
  createHash("sha256").update(canonicalJson(
    Object.fromEntries(Object.entries(publication).filter(([key]) => key !== "review")),
  ), "utf8").digest("hex");

const validatePublication = (input: unknown, deletingPrivateBytes = false): Effect.Effect<PublicEvalPublication, PublicEvalPublicationError> =>
  decodePublicEvalPublication(input).pipe(
    Effect.mapError(() => error("invalid_publication")),
    Effect.flatMap((publication) => {
      if (!deletingPrivateBytes && !hasSafeText(publication)) return Effect.fail(error("unsafe_text"));
      if (publication.review.status === "approved" && publication.review.subjectSha256 !== publicEvalPublicationSubjectSha256(publication)) {
        return Effect.fail(error("approval_mismatch"));
      }
      return Effect.succeed(publication);
    }),
  );

export const makePublicEvalResultPublication = (
  request: PublicEvalResultExportRequest,
  result: PublicEvalResult,
): Effect.Effect<PublicEvalPublication, PublicEvalPublicationError> => Effect.gen(function* () {
  const decoded = yield* decodePublicEvalExportRequest(request);
  if (decoded.kind !== "result" || decoded.resultId !== result.resultId) return yield* error("invalid_request");
  return yield* validatePublication({
    schemaVersion: "eval-publication.v1",
    publicationId: decoded.publicationId,
    revisionId: decoded.revisionId,
    revision: decoded.revision,
    runId: result.run.runId,
    dataOrigin: decoded.dataOrigin,
    publishedAt: decoded.publishedAt,
    review: decoded.review,
    supersedes: decoded.supersedes,
    content: { kind: "result", result },
  });
});

export const makePublicEvalWithdrawalPublication = (
  request: PublicEvalWithdrawalExportRequest,
  runId: string,
): Effect.Effect<PublicEvalPublication, PublicEvalPublicationError> => Effect.gen(function* () {
  const decoded = yield* decodePublicEvalExportRequest(request);
  if (decoded.kind !== "withdrawal") return yield* error("invalid_request");
  return yield* validatePublication({
    schemaVersion: "eval-publication.v1",
    publicationId: decoded.publicationId,
    revisionId: decoded.revisionId,
    revision: decoded.revision,
    runId,
    dataOrigin: decoded.dataOrigin,
    publishedAt: decoded.publishedAt,
    review: decoded.review,
    supersedes: decoded.supersedes,
    content: { kind: "withdrawal_notice", ...decoded.notice },
  });
});

type Platform = FileSystem.FileSystem | Path.Path;
type IndexEntry = PublicEvalIndex["publications"][number];
type IndexRevision = IndexEntry["revisions"][number];
const PATH_SEGMENT = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/u;
const snapshotPath = (publicationId: string, revisionId: string): string => `${publicationId}/${revisionId}.json`;
const sha256 = (content: string): string => createHash("sha256").update(content, "utf8").digest("hex");
const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

/** Check every existing ancestor, including dangling links, before creating or opening files. */
const inspectPath = (target: string): Effect.Effect<FileSystem.File.Info | null, PublicEvalPublicationError, Platform> => Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const components: string[] = [];
  for (let next = target; path.dirname(next) !== next; next = path.dirname(next)) components.push(next);
  let info: FileSystem.File.Info | null = null;
  for (let i = components.length - 1; i >= 0; i--) {
    const component = components[i]!;
    const link = yield* Effect.result(fs.readLink(component));
    if (link._tag === "Success") return yield* error("unsafe_path");
    const stat = yield* Effect.result(fs.stat(component));
    if (stat._tag === "Failure") {
      if (stat.failure.reason._tag === "NotFound") return null;
      return yield* error("unsafe_path");
    }
    if (i > 0 && stat.success.type !== "Directory") return yield* error("unsafe_path");
    const real = yield* fs.realPath(component).pipe(Effect.mapError(() => error("unsafe_path")));
    if (real !== component) return yield* error("unsafe_path");
    info = stat.success;
  }
  return info;
});

const ensureDirectory = (target: string): Effect.Effect<void, PublicEvalPublicationError, Platform> => Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const existing = yield* inspectPath(target);
  if (existing !== null && existing.type !== "Directory") return yield* error("unsafe_path");
  if (existing === null) yield* fs.makeDirectory(target, { recursive: true, mode: 0o755 }).pipe(Effect.mapError(() => error("write_failed")));
  const created = yield* inspectPath(target);
  if (created?.type !== "Directory") return yield* error("unsafe_path");
});

interface Layout {
  readonly originDirectory: string;
  readonly indexPath: string;
  readonly lockPath: string;
}
const resolveLayout = (outputDirectory: string, dataOrigin: PublicEvalDataOrigin): Effect.Effect<Layout, PublicEvalPublicationError, Platform> => Effect.gen(function* () {
  const path = yield* Path.Path;
  if (!outputDirectory.trim() || outputDirectory.includes("\0") || outputDirectory.split(/[\\/]/u).includes("..") || (dataOrigin !== "synthetic" && dataOrigin !== "measured")) {
    return yield* error("unsafe_path");
  }
  const originDirectory = path.resolve(outputDirectory, dataOrigin);
  yield* inspectPath(originDirectory);
  return { originDirectory, indexPath: path.join(originDirectory, "index.json"), lockPath: path.join(originDirectory, "index.lock") };
});

const readIndex = (layout: Layout, dataOrigin: PublicEvalDataOrigin, privacyWithdrawalPublicationId?: string): Effect.Effect<PublicEvalIndex | null, PublicEvalPublicationError, Platform> => Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const info = yield* inspectPath(layout.indexPath);
  if (info === null) return null;
  if (info.type !== "File" || Option.getOrElse(info.nlink, () => 1) !== 1) return yield* error("unsafe_path");
  const bytes = yield* fs.readFile(layout.indexPath).pipe(Effect.mapError(() => error("index_unreadable")));
  const text = yield* Effect.try({
    try: () => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes),
    catch: () => error("index_invalid"),
  });
  const index = yield* decodeJson(text).pipe(Effect.flatMap(decodePublicEvalIndex), Effect.mapError(() => error("index_invalid")));
  if (index.dataOrigin !== dataOrigin) return yield* error("origin_mismatch");
  // The selected summary and review will be replaced. All retained identifiers,
  // revision metadata and other publications must still pass the public checks.
  const retained = privacyWithdrawalPublicationId === undefined ? index : {
    ...index,
    publications: index.publications.map((entry) => entry.publicationId === privacyWithdrawalPublicationId ? { ...entry, summary: null, review: null } : entry),
  };
  if (!hasSafeText(retained)) return yield* error("unsafe_text");
  return index;
});

/** CLI withdrawal lookup is advisory. The exporter rechecks it under the index lock. */
export const readPublicEvalIndex = (options: {
  readonly outputDirectory: string;
  readonly dataOrigin: PublicEvalDataOrigin;
  /** Private withdrawal lookup only; permits an unsafe summary that will be deleted. */
  readonly privacyWithdrawalPublicationId?: string;
}): Effect.Effect<PublicEvalIndex | null, PublicEvalPublicationError, Platform> => Effect.gen(function* () {
  const layout = yield* resolveLayout(options.outputDirectory, options.dataOrigin);
  return yield* readIndex(layout, options.dataOrigin, options.privacyWithdrawalPublicationId);
});

const summaryOf = (publication: PublicEvalPublication): IndexEntry["summary"] => publication.content.kind === "result" ? {
  suiteId: publication.content.result.benchmark.suiteId,
  candidate: publication.content.result.configuration.candidate,
  model: publication.content.result.configuration.model,
  startedAt: publication.content.result.run.startedAt,
} : null;

/** Verify hashes AND identity, origin, predecessor, timestamps and summary before any mutation. */
const verifyIndexSnapshots = (layout: Layout, index: PublicEvalIndex, privacyWithdrawalPublicationId?: string): Effect.Effect<void, PublicEvalPublicationError, Platform> => Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  for (const entry of index.publications) {
    if (!PATH_SEGMENT.test(entry.publicationId) || /^index(?:\.|$)/iu.test(entry.publicationId)) return yield* error("unsafe_path");
    const expectedFiles = new Set<string>();
    for (const revision of entry.revisions) {
      if (!PATH_SEGMENT.test(revision.revisionId)) return yield* error("unsafe_path");
      const expected = snapshotPath(entry.publicationId, revision.revisionId);
      const target = path.join(layout.originDirectory, expected);
      const info = yield* inspectPath(target);
      if (revision.state === "removed") {
        if (info !== null) return yield* error("prior_snapshot_mismatch");
        continue;
      }
      if (revision.path !== expected || info?.type !== "File" || Option.getOrElse(info.nlink, () => 1) !== 1) return yield* error("prior_snapshot_mismatch");
      expectedFiles.add(`${revision.revisionId}.json`);
      const bytes = yield* fs.readFile(target).pipe(Effect.mapError(() => error("prior_snapshot_mismatch")));
      if (createHash("sha256").update(bytes).digest("hex") !== revision.sha256) return yield* error("prior_snapshot_mismatch");
      const text = yield* Effect.try({
        try: () => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes),
        catch: () => error("prior_snapshot_mismatch"),
      });
      const deletingPrivateBytes = entry.publicationId === privacyWithdrawalPublicationId;
      const prior = yield* decodeJson(text).pipe(
        Effect.flatMap((input) => validatePublication(input, deletingPrivateBytes)),
        Effect.mapError(() => error("prior_snapshot_mismatch")),
      );
      const predecessor = entry.revisions[revision.revision - 2];
      if (
        prior.publicationId !== entry.publicationId || prior.runId !== entry.runId || prior.dataOrigin !== index.dataOrigin ||
        prior.revisionId !== revision.revisionId || prior.revision !== revision.revision || prior.content.kind !== revision.kind ||
        prior.publishedAt !== revision.publishedAt ||
        (predecessor !== undefined && (prior.supersedes?.revisionId !== predecessor.revisionId || prior.supersedes?.revision !== predecessor.revision || DateTime.isLessThan(DateTime.makeUnsafe(prior.publishedAt), DateTime.makeUnsafe(predecessor.publishedAt)))) ||
        (revision.state === "current" && (canonicalJson(summaryOf(prior)) !== canonicalJson(entry.summary) || canonicalJson(prior.review) !== canonicalJson(entry.review)))
      ) return yield* error("prior_snapshot_mismatch");
    }
    const files = yield* fs.readDirectory(path.join(layout.originDirectory, entry.publicationId)).pipe(Effect.mapError(() => error("prior_snapshot_mismatch")));
    if (files.length !== expectedFiles.size || files.some((file) => !expectedFiles.has(file))) return yield* error("prior_snapshot_mismatch");
  }
});

/**
 * Local cooperative writer. The output tree must remain under operator control.
 * Atomic mkdir excludes concurrent exporters; no lock stealing or automatic retry.
 * After a partial write the lock remains, requiring manual inspection and recovery.
 */
export const exportPublicEvalPublication = (options: PublicEvalPublicationExportOptions): Effect.Effect<PublicEvalPublicationExportResult, PublicEvalPublicationError, Platform> => Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const publication = yield* validatePublication(options.publication);
  if (!PATH_SEGMENT.test(publication.publicationId) || /^index(?:\.|$)/iu.test(publication.publicationId) || !PATH_SEGMENT.test(publication.revisionId)) return yield* error("unsafe_path");
  const layout = yield* resolveLayout(options.outputDirectory, publication.dataOrigin);
  yield* ensureDirectory(layout.originDirectory);
  const relativePath = snapshotPath(publication.publicationId, publication.revisionId);
  const publicationPath = path.join(layout.originDirectory, relativePath);
  const publicationDirectory = path.dirname(publicationPath);
  const content = `${JSON.stringify(publication, null, 2)}\n`;
  let mutationStarted = false;
  let complete = false;
  return yield* Effect.acquireUseRelease(
    fs.makeDirectory(layout.lockPath, { mode: 0o700 }).pipe(Effect.mapError((cause) => error(cause.reason._tag === "AlreadyExists" ? "index_locked" : "write_failed"))),
    () => Effect.gen(function* () {
      const privacyWithdrawalId = publication.content.kind === "withdrawal_notice" && publication.content.reason === "privacy" ? publication.publicationId : undefined;
      const index = yield* readIndex(layout, publication.dataOrigin, privacyWithdrawalId);
      if (index !== null) yield* verifyIndexSnapshots(layout, index, privacyWithdrawalId);
      const entries = index?.publications ?? [];
      const entry = entries.find((item) => item.publicationId === publication.publicationId);
      const revisionIdKey = publication.revisionId.toLowerCase();
      if (entries.some((item) => item.revisions.some((revision) => revision.revisionId.toLowerCase() === revisionIdKey))) return yield* error("revision_mismatch");
      const withdrawal = publication.content.kind === "withdrawal_notice";
      if (entry === undefined) {
        if (publication.revision !== 1 || withdrawal) return yield* error("unknown_publication");
        const directory = yield* inspectPath(publicationDirectory);
        if (directory !== null) return yield* error("snapshot_exists");
      } else {
        const prior = entry.revisions[entry.revisions.length - 1]!;
        if ((!withdrawal && entry.status === "withdrawn") || entry.runId !== publication.runId || publication.revision !== prior.revision + 1 ||
          publication.supersedes?.revisionId !== entry.currentRevisionId || publication.supersedes.revision !== prior.revision ||
          DateTime.isLessThan(DateTime.makeUnsafe(publication.publishedAt), DateTime.makeUnsafe(prior.publishedAt))) return yield* error("revision_mismatch");
      }
      if ((yield* inspectPath(publicationPath)) !== null) return yield* error("snapshot_exists");
      const revisions: IndexRevision[] = (entry?.revisions ?? []).map((revision) => withdrawal
        ? { ...revision, state: "removed", path: null, sha256: null }
        : { ...revision, state: "superseded" });
      revisions.push({ revisionId: publication.revisionId, revision: publication.revision, kind: publication.content.kind,
        state: "current", publishedAt: publication.publishedAt, path: relativePath, sha256: sha256(content) });
      const nextEntry: IndexEntry = { publicationId: publication.publicationId, runId: publication.runId, review: publication.review,
        status: withdrawal ? "withdrawn" : "current", currentRevisionId: publication.revisionId, summary: summaryOf(publication), revisions };
      const nextIndex = yield* decodePublicEvalIndex({ schemaVersion: "eval-index.v1", dataOrigin: publication.dataOrigin,
        generatedAt: DateTime.formatIso(yield* DateTime.now),
        publications: entry === undefined ? [...entries, nextEntry] : entries.map((item) => item === entry ? nextEntry : item),
      }).pipe(Effect.mapError(() => error("index_invalid")));
      if (!hasSafeText(nextIndex)) return yield* error("unsafe_text");
      const nextContent = `${JSON.stringify(nextIndex, null, 2)}\n`;
      const temporaryIndex = path.join(layout.lockPath, "next-index.json");
      mutationStarted = true;
      yield* ensureDirectory(publicationDirectory);
      yield* fs.writeFileString(publicationPath, content, { flag: "wx", mode: 0o444 }).pipe(Effect.mapError((cause) => error(cause.reason._tag === "AlreadyExists" ? "snapshot_exists" : "write_failed")));
      yield* fs.writeFileString(temporaryIndex, nextContent, { flag: "wx", mode: 0o644 }).pipe(Effect.mapError(() => error("write_failed")));
      // Delete before index promotion: failure never reports a completed withdrawal.
      // A partial deletion deliberately leaves the lock held and never restores bytes.
      if (withdrawal && entry !== undefined) {
        for (const revision of entry.revisions) {
          if (revision.path === null) continue;
          const target = path.join(layout.originDirectory, revision.path);
          if ((yield* inspectPath(target))?.type !== "File") return yield* error("unsafe_path");
          yield* fs.remove(target).pipe(Effect.mapError(() => error("write_failed")));
        }
      }
      yield* inspectPath(layout.indexPath);
      yield* fs.rename(temporaryIndex, layout.indexPath).pipe(Effect.mapError(() => error("write_failed")));
      complete = true;
      return { publicationPath, indexPath: layout.indexPath };
    }),
    () => !mutationStarted || complete
      ? fs.remove(layout.lockPath, { recursive: true }).pipe(Effect.mapError(() => error("write_failed")))
      : Effect.void,
  );
});
