import { createHash } from "node:crypto";
import type { PublicEvalDataOrigin, PublicEvalIndex, PublicEvalPublication, PublicEvalResult } from "@askgina/contracts";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path } from "effect";

import {
  exportPublicEvalPublication,
  PublicEvalPublicationError,
  type PublicEvalPublicationErrorReason,
  publicEvalPublicationSubjectSha256,
  readPublicEvalIndex,
} from "../src/publication";

const sha256Hex = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

const RUN_ID = "run-synthetic-routing-001";
const PUBLICATION_ID = "pub-routing-synthetic";
const STARTED_AT = "2026-08-25T00:00:00.000Z";
const PUBLISHED_1 = "2026-08-26T00:00:00.000Z";
const PUBLISHED_2 = "2026-08-27T00:00:00.000Z";
const WITHDRAWN_AT = "2026-08-28T00:00:00.000Z";
const PUBLISHED_3 = "2026-08-28T01:00:00.000Z";
const PUBLISHED_4 = "2026-08-29T00:00:00.000Z";

const makeResult = (
  dataOrigin: PublicEvalDataOrigin = "synthetic",
  overrides: Partial<PublicEvalResult> = {},
): PublicEvalResult => ({
  schemaVersion: "eval-result.v1",
  resultId: `result-${dataOrigin}-routing-001`,
  dataOrigin,
  measures: "conformance",
  run: { runId: RUN_ID, startedAt: STARTED_AT },
  source: {
    kind: "sanitized_aggregate",
    reportSchemaVersion: "v1",
    reportSha256: sha256Hex("synthetic-report"),
    attemptCaptureSha256: null,
  },
  benchmark: {
    suiteId: "gina-routing",
    suiteVersion: 1,
    fixtureVersion: 1,
    catalogSha: sha256Hex("synthetic-catalog"),
    target: "fixture",
    accountClass: "synthetic",
    cleanChat: true,
    repetitions: 2,
  },
  configuration: {
    availability: "pinned",
    candidate: "gina-mcp-plugin",
    model: "synthetic-model",
    reasoning: null,
    pinnedSha256: sha256Hex("synthetic-configuration"),
  },
  coverage: {
    planSource: "run_manifest",
    planSha256: null,
    statusSha256: null,
    status: "complete",
    plannedCases: 2,
    plannedAttempts: 4,
  },
  counts: {
    attempts: { total: 4, passed: 3, failed: 1 },
    cases: { total: 2, passedEveryAttempt: null, failedAnyAttempt: null },
  },
  dimensions: {
    routing: { passed: 3, failed: 1, notApplicable: 0 },
    arguments: { passed: 4, failed: 0, notApplicable: 0 },
    safety: { passed: 0, failed: 0, notApplicable: 4 },
    completion: { passed: 4, failed: 0, notApplicable: 0 },
    skillActivation: { passed: 0, failed: 0, notApplicable: 4 },
  },
  metrics: {
    passRate: { availability: "available", unit: "ratio", value: 0.75, numerator: 3, denominator: 4 },
    latencyMs: { availability: "available", unit: "milliseconds", p50: 5, p95: 7, max: 7, sampleCount: 4 },
    tokenUsage: { availability: "not_retained", reason: "not_captured" },
    answerAccuracy: { availability: "not_evaluated", reason: "no_declared_method" },
    usdCost: { availability: "not_evaluated", reason: "no_declared_method" },
    uncertainty: { availability: "not_evaluated", reason: "no_declared_method" },
  },
  evidence: { attemptDetail: "aggregate_only" },
  ranking: { status: "unranked", reasons: dataOrigin === "synthetic" ? ["pilot", "synthetic"] : ["pilot"] },
  attempts: null,
  ...overrides,
});

const syntheticResult = makeResult();
const correctedResult = makeResult("synthetic", {
  metrics: {
    ...syntheticResult.metrics,
    latencyMs: { availability: "available", unit: "milliseconds", p50: 6, p95: 7, max: 7, sampleCount: 4 },
  },
});

interface PublicationOptions {
  readonly publicationId?: string;
  readonly revisionId: string;
  readonly revision: number;
  readonly publishedAt: string;
  readonly runId?: string;
  readonly dataOrigin?: PublicEvalDataOrigin;
  readonly review?: PublicEvalPublication["review"];
  readonly supersedes?: PublicEvalPublication["supersedes"];
  readonly content?: PublicEvalPublication["content"];
}

const makePublication = (options: PublicationOptions): PublicEvalPublication => ({
  schemaVersion: "eval-publication.v1",
  publicationId: options.publicationId ?? PUBLICATION_ID,
  revisionId: options.revisionId,
  revision: options.revision,
  runId: options.runId ?? RUN_ID,
  dataOrigin: options.dataOrigin ?? "synthetic",
  publishedAt: options.publishedAt,
  review: options.review ?? { status: "synthetic_preview" },
  supersedes: options.supersedes ?? null,
  content: options.content ?? { kind: "result", result: syntheticResult },
});

const initial = makePublication({ revisionId: "rev-1", revision: 1, publishedAt: PUBLISHED_1 });

const correction = makePublication({
  revisionId: "rev-2",
  revision: 2,
  publishedAt: PUBLISHED_2,
  supersedes: { revisionId: "rev-1", revision: 1, reason: "correction", summary: "Corrected the latency percentiles." },
  content: { kind: "result", result: correctedResult },
});

const withdrawal = makePublication({
  revisionId: "rev-3",
  revision: 3,
  publishedAt: PUBLISHED_3,
  supersedes: { revisionId: "rev-2", revision: 2, reason: "withdrawal", summary: "Withdrawn after a privacy review." },
  content: {
    kind: "withdrawal_notice",
    reason: "privacy",
    withdrawnAt: WITHDRAWN_AT,
    notice: "This publication was withdrawn after a privacy review.",
  },
});

const TestPlatformLayer = Layer.merge(BunFileSystem.layer, BunPath.layer);

/** Canonical temp root: the exporter rejects symlinked ancestors, and Darwin's /tmp and /var are aliases. */
const canonicalOutputDirectory = (prefix: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix }));
    return { root, outputDirectory: path.join(root, "output") };
  });

const originPaths = (path: Path.Path, outputDirectory: string, dataOrigin: PublicEvalDataOrigin = "synthetic") => {
  const originDirectory = path.join(outputDirectory, dataOrigin);
  return {
    originDirectory,
    indexPath: path.join(originDirectory, "index.json"),
    lockPath: path.join(originDirectory, "index.lock"),
    snapshot: (revisionId: string, publicationId = PUBLICATION_ID) =>
      path.join(originDirectory, publicationId, `${revisionId}.json`),
  };
};

const exportTo = (outputDirectory: string, publication: unknown) =>
  exportPublicEvalPublication({ publication, outputDirectory });

const rejection = <A, R>(
  effect: Effect.Effect<A, PublicEvalPublicationError, R>,
  reason: PublicEvalPublicationErrorReason,
  label: string,
) =>
  Effect.gen(function* () {
    const result = yield* Effect.result(effect);
    assert.strictEqual(result._tag, "Failure", `${label}: expected rejection`);
    if (result._tag !== "Failure") return assert.fail(label);
    assert.instanceOf(result.failure, PublicEvalPublicationError, label);
    assert.strictEqual(result.failure.reason, reason, `${label}: reason`);
    return result.failure;
  });

const errorText = (error: PublicEvalPublicationError): string => `${String(error)} ${JSON.stringify(error)}`;

const readJson = (fs: FileSystem.FileSystem, target: string) =>
  fs.readFileString(target).pipe(Effect.map((text) => JSON.parse(text) as unknown));

const overwriteFile = (fs: FileSystem.FileSystem, target: string, content: string) =>
  fs.chmod(target, 0o644).pipe(Effect.andThen(fs.writeFileString(target, content)));

interface MutableIndex {
  publications: Array<{
    runId: string;
    summary: { model: string } | null;
    revisions: Array<{ publishedAt: string; sha256: string | null }>;
  }>;
}

describe("public eval publication exporter", () => {
  it.layer(TestPlatformLayer)((it) => {
    it.effect("publishes a synthetic preview and appends a correction without touching the first snapshot", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { outputDirectory } = yield* canonicalOutputDirectory("publication-lifecycle-");
        const origin = originPaths(path, outputDirectory);

        const first = yield* exportTo(outputDirectory, initial);
        assert.strictEqual(first.publicationPath, origin.snapshot("rev-1"));
        assert.strictEqual(first.indexPath, origin.indexPath);
        const firstBytes = yield* fs.readFileString(first.publicationPath);
        assert.deepStrictEqual(JSON.parse(firstBytes), initial);
        assert.isFalse(yield* fs.exists(origin.lockPath));

        const indexed = yield* readPublicEvalIndex({ outputDirectory, dataOrigin: "synthetic" });
        assert.isNotNull(indexed);
        if (indexed === null) return assert.fail("index missing");
        assert.strictEqual(indexed.dataOrigin, "synthetic");
        assert.deepStrictEqual(indexed.publications, [
          {
            publicationId: PUBLICATION_ID,
            runId: RUN_ID,
            review: { status: "synthetic_preview" },
            status: "current",
            currentRevisionId: "rev-1",
            summary: { suiteId: "gina-routing", candidate: "gina-mcp-plugin", model: "synthetic-model", startedAt: STARTED_AT },
            revisions: [
              {
                revisionId: "rev-1",
                revision: 1,
                kind: "result",
                state: "current",
                publishedAt: PUBLISHED_1,
                path: `${PUBLICATION_ID}/rev-1.json`,
                sha256: sha256Hex(firstBytes),
              },
            ],
          },
        ]);
        assert.isNull(yield* readPublicEvalIndex({ outputDirectory, dataOrigin: "measured" }));

        const second = yield* exportTo(outputDirectory, correction);
        assert.strictEqual(second.publicationPath, origin.snapshot("rev-2"));
        assert.strictEqual(yield* fs.readFileString(first.publicationPath), firstBytes);
        const secondBytes = yield* fs.readFileString(second.publicationPath);
        assert.deepStrictEqual(JSON.parse(secondBytes), correction);

        const corrected = yield* readPublicEvalIndex({ outputDirectory, dataOrigin: "synthetic" });
        if (corrected === null) return assert.fail("index missing after correction");
        assert.lengthOf(corrected.publications, 1);
        const entry = corrected.publications[0]!;
        assert.strictEqual(entry.status, "current");
        assert.strictEqual(entry.currentRevisionId, "rev-2");
        assert.deepStrictEqual(entry.review, { status: "synthetic_preview" });
        assert.deepStrictEqual(entry.revisions, [
          {
            revisionId: "rev-1",
            revision: 1,
            kind: "result",
            state: "superseded",
            publishedAt: PUBLISHED_1,
            path: `${PUBLICATION_ID}/rev-1.json`,
            sha256: sha256Hex(firstBytes),
          },
          {
            revisionId: "rev-2",
            revision: 2,
            kind: "result",
            state: "current",
            publishedAt: PUBLISHED_2,
            path: `${PUBLICATION_ID}/rev-2.json`,
            sha256: sha256Hex(secondBytes),
          },
        ]);
      }),
    );

    it.effect("rejects a measured publication without a recorded manual approval and writes nothing", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { outputDirectory } = yield* canonicalOutputDirectory("publication-approval-");
        const measured = makePublication({
          revisionId: "rev-1",
          revision: 1,
          publishedAt: PUBLISHED_1,
          dataOrigin: "measured",
          content: { kind: "result", result: makeResult("measured") },
        });

        yield* rejection(exportTo(outputDirectory, measured), "invalid_publication", "measured preview");
        assert.isNull(yield* readPublicEvalIndex({ outputDirectory, dataOrigin: "measured" }));
        assert.isFalse(yield* fs.exists(originPaths(path, outputDirectory, "measured").snapshot("rev-1")));
      }),
    );

    it.effect("accepts measured approval only for its exact subject and rejects private review text", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { outputDirectory } = yield* canonicalOutputDirectory("publication-approved-subject-");
        const origin = originPaths(path, outputDirectory, "measured");
        const subject = makePublication({
          revisionId: "rev-1",
          revision: 1,
          publishedAt: PUBLISHED_1,
          dataOrigin: "measured",
          content: { kind: "result", result: makeResult("measured") },
        });
        const approved: PublicEvalPublication = {
          ...subject,
          review: {
            status: "approved",
            method: "manual",
            approvedBy: "reviewer-fixture",
            approvedAt: PUBLISHED_1,
            subjectSha256: publicEvalPublicationSubjectSha256(subject),
            record: "Manual privacy review completed for this snapshot.",
          },
        };
        const published = yield* exportTo(outputDirectory, approved);
        const approvedBytes = yield* fs.readFileString(published.publicationPath);
        assert.deepStrictEqual(JSON.parse(approvedBytes), approved);
        const index = yield* readPublicEvalIndex({ outputDirectory, dataOrigin: "measured" });
        if (index === null) return assert.fail("approved measured index missing");
        assert.deepStrictEqual(index.publications[0]!.review, approved.review);
        assert.isNull(yield* readPublicEvalIndex({ outputDirectory, dataOrigin: "synthetic" }));
        const indexBytes = yield* fs.readFileString(origin.indexPath);

        yield* rejection(
          exportTo(outputDirectory, { ...approved, publishedAt: PUBLISHED_2 }),
          "approval_mismatch",
          "approval copied to changed publication subject",
        );
        const privateRecord = "sk-proj-Qw3eRt6yUi9oPa2sDf5gHj8k";
        const privateReview = { ...approved, review: { ...approved.review, record: `Reviewed ${privateRecord}.` } };
        const failure = yield* rejection(exportTo(outputDirectory, privateReview), "unsafe_text", "private manual review record");
        assert.notInclude(errorText(failure), privateRecord);
        assert.strictEqual(yield* fs.readFileString(origin.indexPath), indexBytes);
        assert.strictEqual(yield* fs.readFileString(published.publicationPath), approvedBytes);
      }),
    );

    it.effect("rejects origin confusion between publication, result and index", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { outputDirectory } = yield* canonicalOutputDirectory("publication-origin-");
        const confused = makePublication({
          revisionId: "rev-1",
          revision: 1,
          publishedAt: PUBLISHED_1,
          content: { kind: "result", result: makeResult("measured") },
        });
        yield* rejection(exportTo(outputDirectory, confused), "invalid_publication", "measured result in synthetic publication");
        assert.isFalse(yield* fs.exists(originPaths(path, outputDirectory).snapshot("rev-1")));

        yield* exportTo(outputDirectory, initial);
        const syntheticIndex = yield* fs.readFileString(originPaths(path, outputDirectory).indexPath);
        const measured = originPaths(path, outputDirectory, "measured");
        yield* fs.makeDirectory(measured.originDirectory, { recursive: true });
        yield* fs.writeFileString(measured.indexPath, syntheticIndex);
        yield* rejection(
          readPublicEvalIndex({ outputDirectory, dataOrigin: "measured" }),
          "origin_mismatch",
          "synthetic index under the measured origin",
        );
      }),
    );

    it.effect("rejects revision gaps, stale supersedes and reused identifiers without changing the index", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { outputDirectory } = yield* canonicalOutputDirectory("publication-revisions-");
        const origin = originPaths(path, outputDirectory);
        yield* exportTo(outputDirectory, initial);
        yield* exportTo(outputDirectory, correction);
        const indexBytes = yield* fs.readFileString(origin.indexPath);

        const rows: ReadonlyArray<{ label: string; publication: PublicEvalPublication; reason: PublicEvalPublicationErrorReason }> = [
          {
            label: "supersedes a superseded revision",
            publication: makePublication({
              revisionId: "rev-3",
              revision: 3,
              publishedAt: PUBLISHED_3,
              supersedes: { revisionId: "rev-1", revision: 2, reason: "correction", summary: "Stale predecessor." },
            }),
            reason: "revision_mismatch",
          },
          {
            label: "skips a revision number",
            publication: makePublication({
              revisionId: "rev-4",
              revision: 4,
              publishedAt: PUBLISHED_4,
              supersedes: { revisionId: "rev-2", revision: 3, reason: "correction", summary: "Gap in revisions." },
            }),
            reason: "revision_mismatch",
          },
          {
            label: "publishes before the current revision",
            publication: makePublication({
              revisionId: "rev-3",
              revision: 3,
              publishedAt: PUBLISHED_1,
              supersedes: { revisionId: "rev-2", revision: 2, reason: "correction", summary: "Backdated correction." },
            }),
            reason: "revision_mismatch",
          },
          {
            label: "re-publishes revision one of an indexed publication",
            publication: initial,
            reason: "revision_mismatch",
          },
          {
            label: "reuses a revisionId under another publication",
            publication: makePublication({
              publicationId: "pub-routing-other",
              revisionId: "rev-1",
              revision: 1,
              publishedAt: PUBLISHED_1,
            }),
            reason: "revision_mismatch",
          },
          {
            label: "corrects a publication that was never indexed",
            publication: makePublication({
              publicationId: "pub-routing-unknown",
              revisionId: "rev-9",
              revision: 2,
              publishedAt: PUBLISHED_2,
              supersedes: { revisionId: "rev-8", revision: 1, reason: "correction", summary: "Unknown predecessor." },
            }),
            reason: "unknown_publication",
          },
        ];
        for (const row of rows) {
          const candidatePath = origin.snapshot(row.publication.revisionId, row.publication.publicationId);
          const existedBefore = yield* fs.exists(candidatePath);
          yield* rejection(exportTo(outputDirectory, row.publication), row.reason, row.label);
          assert.strictEqual(yield* fs.exists(candidatePath), existedBefore, row.label);
          assert.strictEqual(yield* fs.readFileString(origin.indexPath), indexBytes, row.label);
        }
        assert.isFalse(yield* fs.exists(origin.snapshot("rev-3")));
        assert.isFalse(yield* fs.exists(origin.snapshot("rev-4")));
        assert.isFalse(yield* fs.exists(path.join(origin.originDirectory, "pub-routing-other")));
        assert.isFalse(yield* fs.exists(path.join(origin.originDirectory, "pub-routing-unknown")));
      }),
    );

    it.effect("refuses to promote when a recorded snapshot or its index entry no longer agree", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;

        const tamperings: ReadonlyArray<{
          label: string;
          tamper: (snapshot: string, indexPath: string) => Effect.Effect<void, unknown>;
        }> = [
          {
            label: "snapshot bytes changed",
            tamper: (snapshot) =>
              overwriteFile(fs, snapshot, `${JSON.stringify({ ...initial, publishedAt: "2026-08-26T00:00:01.000Z" }, null, 2)}\n`),
          },
          {
            label: "index publishedAt differs from the snapshot",
            tamper: (_, indexPath) =>
              readJson(fs, indexPath).pipe(
                Effect.flatMap((raw) => {
                  const index = raw as MutableIndex;
                  index.publications[0]!.revisions[0]!.publishedAt = "2026-08-26T12:00:00.000Z";
                  return fs.writeFileString(indexPath, `${JSON.stringify(index, null, 2)}\n`);
                }),
              ),
          },
          {
            label: "index summary differs from the snapshot",
            tamper: (_, indexPath) =>
              readJson(fs, indexPath).pipe(
                Effect.flatMap((raw) => {
                  const index = raw as MutableIndex;
                  index.publications[0]!.summary!.model = "other-model";
                  return fs.writeFileString(indexPath, `${JSON.stringify(index, null, 2)}\n`);
                }),
              ),
          },
          {
            label: "snapshot identity replaced with a matching hash",
            tamper: (snapshot, indexPath) =>
              Effect.gen(function* () {
                const replaced = `${JSON.stringify({ ...initial, publicationId: "pub-foreign" }, null, 2)}\n`;
                yield* overwriteFile(fs, snapshot, replaced);
                const index = (yield* readJson(fs, indexPath)) as MutableIndex;
                index.publications[0]!.revisions[0]!.sha256 = sha256Hex(replaced);
                yield* fs.writeFileString(indexPath, `${JSON.stringify(index, null, 2)}\n`);
              }),
          },
        ];

        for (const row of tamperings) {
          const { outputDirectory } = yield* canonicalOutputDirectory("publication-tamper-");
          const origin = originPaths(path, outputDirectory);
          yield* exportTo(outputDirectory, initial);
          yield* row.tamper(origin.snapshot("rev-1"), origin.indexPath).pipe(Effect.orDie);
          const tamperedIndex = yield* fs.readFileString(origin.indexPath);
          const tamperedSnapshot = yield* fs.readFileString(origin.snapshot("rev-1"));

          yield* rejection(exportTo(outputDirectory, correction), "prior_snapshot_mismatch", row.label);
          const unrelated = makePublication({
            publicationId: "pub-unrelated",
            revisionId: "rev-unrelated",
            revision: 1,
            publishedAt: PUBLISHED_1,
          });
          yield* rejection(exportTo(outputDirectory, unrelated), "prior_snapshot_mismatch", `${row.label}: unrelated publication`);
          assert.isFalse(yield* fs.exists(origin.snapshot("rev-unrelated", "pub-unrelated")), row.label);
          assert.isFalse(yield* fs.exists(origin.snapshot("rev-2")), row.label);
          assert.strictEqual(yield* fs.readFileString(origin.indexPath), tamperedIndex, row.label);
          assert.strictEqual(yield* fs.readFileString(origin.snapshot("rev-1")), tamperedSnapshot, row.label);
          assert.isFalse(yield* fs.exists(origin.lockPath), row.label);
        }
      }),
    );

    it.effect("rejects symbolic links at the output directory, its ancestors and inside the origin tree", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { root } = yield* canonicalOutputDirectory("publication-symlink-");

        const realOutput = path.join(root, "real-output");
        const linkedOutput = path.join(root, "linked-output");
        yield* fs.makeDirectory(realOutput);
        yield* fs.symlink(realOutput, linkedOutput);
        yield* rejection(exportTo(linkedOutput, initial), "unsafe_path", "symlinked output directory");
        assert.isFalse(yield* fs.exists(path.join(realOutput, "synthetic")));

        const realParent = path.join(root, "real-parent");
        const linkedParent = path.join(root, "linked-parent");
        yield* fs.makeDirectory(realParent);
        yield* fs.symlink(realParent, linkedParent);
        yield* rejection(exportTo(path.join(linkedParent, "output"), initial), "unsafe_path", "symlinked ancestor");
        assert.isFalse(yield* fs.exists(path.join(realParent, "output")));

        const originOutput = path.join(root, "origin-output");
        const elsewhere = path.join(root, "elsewhere");
        yield* fs.makeDirectory(originOutput);
        yield* fs.makeDirectory(elsewhere);
        yield* fs.symlink(elsewhere, path.join(originOutput, "synthetic"));
        yield* rejection(exportTo(originOutput, initial), "unsafe_path", "symlinked origin directory");
        assert.isFalse(yield* fs.exists(path.join(elsewhere, "index.json")));
        assert.isFalse(yield* fs.exists(path.join(elsewhere, PUBLICATION_ID)));

        const publicationOutput = path.join(root, "publication-output");
        const elsewhereSnapshots = path.join(root, "elsewhere-snapshots");
        const publicationOrigin = originPaths(path, publicationOutput);
        yield* fs.makeDirectory(publicationOrigin.originDirectory, { recursive: true });
        yield* fs.makeDirectory(elsewhereSnapshots);
        yield* fs.symlink(elsewhereSnapshots, path.join(publicationOrigin.originDirectory, PUBLICATION_ID));
        yield* rejection(exportTo(publicationOutput, initial), "unsafe_path", "symlinked publication directory");
        assert.isFalse(yield* fs.exists(path.join(elsewhereSnapshots, "rev-1.json")));
        assert.isFalse(yield* fs.exists(publicationOrigin.indexPath));

        const snapshotOutput = path.join(root, "snapshot-output");
        const snapshotOrigin = originPaths(path, snapshotOutput);
        yield* exportTo(snapshotOutput, initial);
        const snapshotCopy = path.join(root, "snapshot-copy.json");
        yield* fs.rename(snapshotOrigin.snapshot("rev-1"), snapshotCopy);
        yield* fs.symlink(snapshotCopy, snapshotOrigin.snapshot("rev-1"));
        const snapshotBytes = yield* fs.readFileString(snapshotCopy);
        const originalIndex = yield* fs.readFileString(snapshotOrigin.indexPath);
        yield* rejection(exportTo(snapshotOutput, correction), "unsafe_path", "symlinked prior snapshot");
        assert.isFalse(yield* fs.exists(snapshotOrigin.snapshot("rev-2")));
        assert.strictEqual(yield* fs.readFileString(snapshotCopy), snapshotBytes);
        assert.strictEqual(yield* fs.readFileString(snapshotOrigin.indexPath), originalIndex);

        const indexOutput = path.join(root, "index-output");
        const indexOrigin = originPaths(path, indexOutput);
        yield* exportTo(indexOutput, initial);
        const indexCopy = path.join(root, "index-copy.json");
        yield* fs.rename(indexOrigin.indexPath, indexCopy);
        yield* fs.symlink(indexCopy, indexOrigin.indexPath);
        yield* rejection(readPublicEvalIndex({ outputDirectory: indexOutput, dataOrigin: "synthetic" }), "unsafe_path", "symlinked index read");
        yield* rejection(exportTo(indexOutput, correction), "unsafe_path", "symlinked index export");
        assert.isFalse(yield* fs.exists(indexOrigin.snapshot("rev-2")));
      }),
    );

    it.effect("rejects identifiers that would alias or escape the snapshot layout without echoing them", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const { outputDirectory } = yield* canonicalOutputDirectory("publication-identifiers-");
        const rows: ReadonlyArray<{ field: "publicationId" | "revisionId"; value: string; reason: PublicEvalPublicationErrorReason }> = [
          { field: "publicationId", value: "pub:colon", reason: "unsafe_path" },
          { field: "revisionId", value: "rev:colon", reason: "unsafe_path" },
          { field: "publicationId", value: "index", reason: "unsafe_path" },
          { field: "publicationId", value: "index.json", reason: "unsafe_path" },
          { field: "publicationId", value: "../escape", reason: "invalid_publication" },
          { field: "revisionId", value: "nested/escape", reason: "invalid_publication" },
          { field: "revisionId", value: ".hidden", reason: "invalid_publication" },
        ];
        for (const row of rows) {
          const publication = { ...initial, [row.field]: row.value };
          const error = yield* rejection(exportTo(outputDirectory, publication), row.reason, `${row.field}=${row.value}`);
          assert.notInclude(errorText(error), row.value, `${row.field}=${row.value}`);
        }
        assert.isFalse(yield* fs.exists(outputDirectory));
      }),
    );

    it.effect("does not overwrite an existing file at the snapshot path", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { outputDirectory } = yield* canonicalOutputDirectory("publication-collision-");
        const origin = originPaths(path, outputDirectory);
        const sentinel = '{"sentinel":true}\n';
        yield* fs.makeDirectory(path.join(origin.originDirectory, PUBLICATION_ID), { recursive: true });
        yield* fs.writeFileString(origin.snapshot("rev-1"), sentinel);

        yield* rejection(exportTo(outputDirectory, initial), "snapshot_exists", "occupied snapshot path");
        assert.strictEqual(yield* fs.readFileString(origin.snapshot("rev-1")), sentinel);
        assert.isNull(yield* readPublicEvalIndex({ outputDirectory, dataOrigin: "synthetic" }));
        assert.isFalse(yield* fs.exists(origin.lockPath));
      }),
    );

    it.effect("preserves a competing snapshot created after preflight and does not promote the index", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { outputDirectory } = yield* canonicalOutputDirectory("publication-exclusive-create-");
        const origin = originPaths(path, outputDirectory);
        const competingBytes = "A competing writer owns these bytes.\n";
        const competingFileSystem: FileSystem.FileSystem = {
          ...fs,
          writeFileString: (file, content, options) => Effect.gen(function* () {
            if (file === origin.snapshot("rev-1")) {
              yield* fs.writeFileString(file, competingBytes, { flag: "wx", mode: 0o600 });
            }
            yield* fs.writeFileString(file, content, options);
          }),
        };

        yield* rejection(
          exportTo(outputDirectory, initial).pipe(Effect.provideService(FileSystem.FileSystem, competingFileSystem)),
          "snapshot_exists",
          "snapshot appeared after preflight",
        );
        assert.strictEqual(yield* fs.readFileString(origin.snapshot("rev-1")), competingBytes);
        assert.isFalse(yield* fs.exists(origin.indexPath));
        yield* rejection(exportTo(outputDirectory, initial), "index_locked", "interrupted publication requires recovery");
        assert.strictEqual(yield* fs.readFileString(origin.snapshot("rev-1")), competingBytes);
      }),
    );

    it.effect("refuses to export while another exporter holds the index lock", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { outputDirectory } = yield* canonicalOutputDirectory("publication-lock-");
        const origin = originPaths(path, outputDirectory);
        yield* fs.makeDirectory(origin.lockPath, { recursive: true });

        yield* rejection(exportTo(outputDirectory, initial), "index_locked", "held lock");
        assert.strictEqual((yield* fs.stat(origin.lockPath)).type, "Directory");
        assert.isFalse(yield* fs.exists(origin.snapshot("rev-1")));
        assert.isNull(yield* readPublicEvalIndex({ outputDirectory, dataOrigin: "synthetic" }));

        yield* fs.remove(origin.lockPath);
        yield* exportTo(outputDirectory, initial);
        assert.isTrue(yield* fs.exists(origin.snapshot("rev-1")));
      }),
    );

    it.effect("keeps correcting, withdrawing and replacing notices beyond fifty revisions", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { outputDirectory } = yield* canonicalOutputDirectory("publication-long-history-");
        const origin = originPaths(path, outputDirectory);
        const publicationDirectory = path.join(origin.originDirectory, PUBLICATION_ID);
        yield* fs.makeDirectory(publicationDirectory, { recursive: true });
        const revisions: Array<PublicEvalIndex["publications"][number]["revisions"][number]> = [];
        for (let revision = 1; revision <= 50; revision++) {
          const publication = makePublication({
            revisionId: `rev-${revision}`,
            revision,
            publishedAt: PUBLISHED_1,
            supersedes: revision === 1 ? null : {
              revisionId: `rev-${revision - 1}`,
              revision: revision - 1,
              reason: "correction",
              summary: "Corrected result metadata.",
            },
          });
          const bytes = `${JSON.stringify(publication, null, 2)}\n`;
          yield* fs.writeFileString(origin.snapshot(publication.revisionId), bytes, { mode: 0o444 });
          revisions.push({
            revisionId: publication.revisionId,
            revision,
            kind: "result",
            state: revision === 50 ? "current" : "superseded",
            publishedAt: PUBLISHED_1,
            path: `${PUBLICATION_ID}/${publication.revisionId}.json`,
            sha256: sha256Hex(bytes),
          });
        }
        const index: PublicEvalIndex = {
          schemaVersion: "eval-index.v1",
          dataOrigin: "synthetic",
          generatedAt: PUBLISHED_1,
          publications: [{
            publicationId: PUBLICATION_ID,
            runId: RUN_ID,
            review: { status: "synthetic_preview" },
            status: "current",
            currentRevisionId: "rev-50",
            summary: { suiteId: "gina-routing", candidate: "gina-mcp-plugin", model: "synthetic-model", startedAt: STARTED_AT },
            revisions,
          }],
        };
        yield* fs.writeFileString(origin.indexPath, `${JSON.stringify(index, null, 2)}\n`);
        const fiftiethBytes = yield* fs.readFileString(origin.snapshot("rev-50"));

        const correctionFiftyOne = makePublication({
          revisionId: "rev-51",
          revision: 51,
          publishedAt: PUBLISHED_2,
          supersedes: { revisionId: "rev-50", revision: 50, reason: "correction", summary: "Corrected the latency percentiles." },
          content: { kind: "result", result: correctedResult },
        });
        yield* exportTo(outputDirectory, correctionFiftyOne);
        assert.strictEqual(yield* fs.readFileString(origin.snapshot("rev-50")), fiftiethBytes);
        const fiftyFirstBytes = yield* fs.readFileString(origin.snapshot("rev-51"));
        assert.deepStrictEqual(JSON.parse(fiftyFirstBytes), correctionFiftyOne);
        assert.lengthOf(yield* fs.readDirectory(publicationDirectory), 51);
        const corrected = yield* readPublicEvalIndex({ outputDirectory, dataOrigin: "synthetic" });
        if (corrected === null) return assert.fail("index missing after revision fifty-one");
        assert.strictEqual(corrected.publications[0]!.status, "current");
        assert.strictEqual(corrected.publications[0]!.currentRevisionId, "rev-51");
        assert.lengthOf(corrected.publications[0]!.revisions, 51);
        assert.strictEqual(corrected.publications[0]!.revisions[49]!.state, "superseded");
        assert.deepStrictEqual(corrected.publications[0]!.revisions[50], {
          revisionId: "rev-51",
          revision: 51,
          kind: "result",
          state: "current",
          publishedAt: PUBLISHED_2,
          path: `${PUBLICATION_ID}/rev-51.json`,
          sha256: sha256Hex(fiftyFirstBytes),
        });

        const withdrawalFiftyTwo: PublicEvalPublication = {
          ...withdrawal,
          revisionId: "rev-52",
          revision: 52,
          supersedes: { revisionId: "rev-51", revision: 51, reason: "withdrawal", summary: "Withdrawn after a privacy review." },
        };
        yield* exportTo(outputDirectory, withdrawalFiftyTwo);
        assert.deepStrictEqual(yield* fs.readDirectory(publicationDirectory), ["rev-52.json"]);
        assert.deepStrictEqual(yield* readJson(fs, origin.snapshot("rev-52")), withdrawalFiftyTwo);
        const withdrawn = yield* readPublicEvalIndex({ outputDirectory, dataOrigin: "synthetic" });
        if (withdrawn === null) return assert.fail("index missing after revision fifty-two");
        const withdrawnEntry = withdrawn.publications[0]!;
        assert.strictEqual(withdrawnEntry.status, "withdrawn");
        assert.isNull(withdrawnEntry.summary);
        assert.strictEqual(withdrawnEntry.currentRevisionId, "rev-52");
        assert.lengthOf(withdrawnEntry.revisions, 52);
        for (let position = 0; position < 51; position++) {
          const removed = withdrawnEntry.revisions[position]!;
          assert.strictEqual(removed.kind, "result");
          assert.strictEqual(removed.state, "removed");
          assert.isNull(removed.path);
          assert.isNull(removed.sha256);
        }
        assert.strictEqual(withdrawnEntry.revisions[51]!.path, `${PUBLICATION_ID}/rev-52.json`);

        const noticeFiftyThree: PublicEvalPublication = {
          ...withdrawal,
          revisionId: "rev-53",
          revision: 53,
          publishedAt: PUBLISHED_4,
          supersedes: { revisionId: "rev-52", revision: 52, reason: "withdrawal", summary: "Replaced the withdrawal notice." },
          content: {
            kind: "withdrawal_notice",
            reason: "privacy",
            withdrawnAt: PUBLISHED_4,
            notice: "The previous withdrawal notice was replaced after a privacy review.",
          },
        };
        yield* exportTo(outputDirectory, noticeFiftyThree);
        assert.deepStrictEqual(yield* fs.readDirectory(publicationDirectory), ["rev-53.json"]);
        assert.deepStrictEqual(yield* readJson(fs, origin.snapshot("rev-53")), noticeFiftyThree);
        const replaced = yield* readPublicEvalIndex({ outputDirectory, dataOrigin: "synthetic" });
        if (replaced === null) return assert.fail("index missing after revision fifty-three");
        const replacedEntry = replaced.publications[0]!;
        assert.strictEqual(replacedEntry.status, "withdrawn");
        assert.strictEqual(replacedEntry.currentRevisionId, "rev-53");
        assert.lengthOf(replacedEntry.revisions, 53);
        assert.deepStrictEqual(replacedEntry.revisions[51], {
          revisionId: "rev-52",
          revision: 52,
          kind: "withdrawal_notice",
          state: "removed",
          publishedAt: PUBLISHED_3,
          path: null,
          sha256: null,
        });
        assert.strictEqual(replacedEntry.revisions[52]!.state, "current");
        assert.strictEqual(replacedEntry.revisions[52]!.path, `${PUBLICATION_ID}/rev-53.json`);
      }),
    );

    it.effect("never reuses a removed revision identifier under a different letter case", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { outputDirectory } = yield* canonicalOutputDirectory("publication-casefold-");
        const origin = originPaths(path, outputDirectory);
        const publicationDirectory = path.join(origin.originDirectory, PUBLICATION_ID);
        yield* exportTo(outputDirectory, initial);
        const firstNotice: PublicEvalPublication = {
          ...withdrawal,
          revisionId: "rev-2",
          revision: 2,
          supersedes: { revisionId: "rev-1", revision: 1, reason: "withdrawal", summary: "Withdrawn after a privacy review." },
        };
        yield* exportTo(outputDirectory, firstNotice);
        assert.deepStrictEqual(yield* fs.readDirectory(publicationDirectory), ["rev-2.json"]);
        const indexBytes = yield* fs.readFileString(origin.indexPath);
        const noticeBytes = yield* fs.readFileString(origin.snapshot("rev-2"));

        const recycled: PublicEvalPublication = {
          ...withdrawal,
          revisionId: "REV-1",
          revision: 3,
          publishedAt: PUBLISHED_4,
          supersedes: { revisionId: "rev-2", revision: 2, reason: "withdrawal", summary: "Replaced the withdrawal notice." },
          content: {
            kind: "withdrawal_notice",
            reason: "privacy",
            withdrawnAt: PUBLISHED_4,
            notice: "The previous withdrawal notice was replaced after a privacy review.",
          },
        };
        yield* rejection(exportTo(outputDirectory, recycled), "revision_mismatch", "removed identifier reused in upper case");
        assert.isFalse(yield* fs.exists(origin.snapshot("REV-1")));
        assert.deepStrictEqual(yield* fs.readDirectory(publicationDirectory), ["rev-2.json"]);
        assert.strictEqual(yield* fs.readFileString(origin.snapshot("rev-2")), noticeBytes);
        assert.strictEqual(yield* fs.readFileString(origin.indexPath), indexBytes);
        assert.isFalse(yield* fs.exists(origin.lockPath));
      }),
    );

    it.effect("a privacy withdrawal removes every historic result snapshot and leaves only the notice reachable", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { outputDirectory } = yield* canonicalOutputDirectory("publication-withdrawal-");
        const origin = originPaths(path, outputDirectory);
        yield* exportTo(outputDirectory, initial);
        yield* exportTo(outputDirectory, correction);

        const notice = yield* exportTo(outputDirectory, withdrawal);
        assert.strictEqual(notice.publicationPath, origin.snapshot("rev-3"));
        assert.isFalse(yield* fs.exists(origin.snapshot("rev-1")));
        assert.isFalse(yield* fs.exists(origin.snapshot("rev-2")));
        const noticeBytes = yield* fs.readFileString(notice.publicationPath);
        assert.deepStrictEqual(JSON.parse(noticeBytes), withdrawal);

        const index = yield* readPublicEvalIndex({ outputDirectory, dataOrigin: "synthetic" });
        if (index === null) return assert.fail("index missing after withdrawal");
        assert.deepStrictEqual(index.publications, [
          {
            publicationId: PUBLICATION_ID,
            runId: RUN_ID,
            review: { status: "synthetic_preview" },
            status: "withdrawn",
            currentRevisionId: "rev-3",
            summary: null,
            revisions: [
              { revisionId: "rev-1", revision: 1, kind: "result", state: "removed", publishedAt: PUBLISHED_1, path: null, sha256: null },
              { revisionId: "rev-2", revision: 2, kind: "result", state: "removed", publishedAt: PUBLISHED_2, path: null, sha256: null },
              {
                revisionId: "rev-3",
                revision: 3,
                kind: "withdrawal_notice",
                state: "current",
                publishedAt: PUBLISHED_3,
                path: `${PUBLICATION_ID}/rev-3.json`,
                sha256: sha256Hex(noticeBytes),
              },
            ],
          },
        ]);
        const indexBytes = yield* fs.readFileString(origin.indexPath);

        const restore = makePublication({
          revisionId: "rev-4",
          revision: 4,
          publishedAt: PUBLISHED_4,
          supersedes: { revisionId: "rev-3", revision: 3, reason: "correction", summary: "Attempted restoration." },
        });
        yield* rejection(exportTo(outputDirectory, restore), "revision_mismatch", "restore after withdrawal");
        yield* rejection(
          exportTo(outputDirectory, { ...initial, revisionId: "rev-5", publishedAt: PUBLISHED_4 }),
          "revision_mismatch",
          "fresh revision one after withdrawal",
        );
        assert.isFalse(yield* fs.exists(origin.snapshot("rev-4")));
        assert.isFalse(yield* fs.exists(origin.snapshot("rev-5")));
        assert.strictEqual(yield* fs.readFileString(origin.indexPath), indexBytes);
        assert.strictEqual(yield* fs.readFileString(notice.publicationPath), noticeBytes);
      }),
    );

    it.effect("allows a privacy withdrawal to remove previously indexed private metadata", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { outputDirectory } = yield* canonicalOutputDirectory("publication-private-history-");
        const origin = originPaths(path, outputDirectory);
        yield* exportTo(outputDirectory, initial);
        yield* exportTo(outputDirectory, correction);

        const privateModel = "10.0.0.5";
        const privateSnapshot = {
          ...correction,
          content: {
            kind: "result",
            result: {
              ...correctedResult,
              configuration: { ...correctedResult.configuration, model: privateModel },
            },
          },
        };
        const privateBytes = `${JSON.stringify(privateSnapshot, null, 2)}\n`;
        yield* overwriteFile(fs, origin.snapshot("rev-2"), privateBytes);
        yield* fs.chmod(origin.snapshot("rev-2"), 0o600);
        const index = (yield* readJson(fs, origin.indexPath)) as MutableIndex;
        index.publications[0]!.summary!.model = privateModel;
        index.publications[0]!.revisions[1]!.sha256 = sha256Hex(privateBytes);
        yield* fs.writeFileString(origin.indexPath, `${JSON.stringify(index, null, 2)}\n`);

        yield* rejection(
          readPublicEvalIndex({ outputDirectory, dataOrigin: "synthetic" }),
          "unsafe_text",
          "normal lookup rejects private summary",
        );
        yield* rejection(
          readPublicEvalIndex({ outputDirectory, dataOrigin: "synthetic", privacyWithdrawalPublicationId: "pub-other" }),
          "unsafe_text",
          "another publication cannot bypass the private summary check",
        );
        assert.deepStrictEqual(
          yield* readPublicEvalIndex({ outputDirectory, dataOrigin: "synthetic", privacyWithdrawalPublicationId: PUBLICATION_ID }),
          index,
        );

        const thirdResult = makePublication({
          revisionId: "rev-3",
          revision: 3,
          publishedAt: PUBLISHED_3,
          supersedes: { revisionId: "rev-2", revision: 2, reason: "correction", summary: "Corrected metadata." },
        });
        const blocked = yield* rejection(exportTo(outputDirectory, thirdResult), "unsafe_text", "private index metadata");
        assert.notInclude(errorText(blocked), privateModel);
        assert.strictEqual(yield* fs.readFileString(origin.snapshot("rev-2")), privateBytes);

        yield* exportTo(outputDirectory, withdrawal);
        assert.isFalse(yield* fs.exists(origin.snapshot("rev-1")));
        assert.isFalse(yield* fs.exists(origin.snapshot("rev-2")));
        const noticeBytes = yield* fs.readFileString(origin.snapshot("rev-3"));
        assert.deepStrictEqual(JSON.parse(noticeBytes), withdrawal);
        assert.notInclude(noticeBytes, privateModel);
        const cleanIndex = yield* readPublicEvalIndex({ outputDirectory, dataOrigin: "synthetic" });
        if (cleanIndex === null) return assert.fail("index missing after private metadata withdrawal");
        assert.strictEqual(cleanIndex.publications[0]!.status, "withdrawn");
        assert.isNull(cleanIndex.publications[0]!.summary);
        const reachablePaths: string[] = [];
        for (const revision of cleanIndex.publications[0]!.revisions) {
          if (revision.path !== null) reachablePaths.push(revision.path);
        }
        assert.deepStrictEqual(reachablePaths, [`${PUBLICATION_ID}/rev-3.json`]);
        assert.notInclude(yield* fs.readFileString(origin.indexPath), privateModel);
      }),
    );

    it.effect("replaces a newly unsafe withdrawal notice without retaining its bytes or bypassing its hash", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { outputDirectory } = yield* canonicalOutputDirectory("publication-private-notice-");
        const origin = originPaths(path, outputDirectory);
        yield* exportTo(outputDirectory, initial);
        const firstNotice: PublicEvalPublication = {
          ...withdrawal,
          revisionId: "rev-2",
          revision: 2,
          supersedes: { revisionId: "rev-1", revision: 1, reason: "withdrawal", summary: "Withdrawn after a privacy review." },
        };
        yield* exportTo(outputDirectory, firstNotice);
        assert.isFalse(yield* fs.exists(origin.snapshot("rev-1")));
        const privateMarker = "sk-proj-Zx3cVb6nMq9wEr2tYu5iOp8a";
        const unsafeNotice: PublicEvalPublication = {
          ...firstNotice,
          content: {
            kind: "withdrawal_notice",
            reason: "privacy",
            withdrawnAt: WITHDRAWN_AT,
            notice: `A previous review exposed ${privateMarker}.`,
          },
        };
        const unsafeBytes = `${JSON.stringify(unsafeNotice, null, 2)}\n`;
        yield* overwriteFile(fs, origin.snapshot("rev-2"), unsafeBytes);
        const replacement: PublicEvalPublication = {
          ...withdrawal,
          publishedAt: PUBLISHED_4,
          content: {
            kind: "withdrawal_notice",
            reason: "privacy",
            withdrawnAt: PUBLISHED_4,
            notice: "The previous withdrawal notice was replaced after a privacy review.",
          },
        };
        const staleIndexBytes = yield* fs.readFileString(origin.indexPath);
        yield* rejection(exportTo(outputDirectory, replacement), "prior_snapshot_mismatch", "privacy withdrawal still checks prior notice hash");
        assert.strictEqual(yield* fs.readFileString(origin.indexPath), staleIndexBytes);
        assert.strictEqual(yield* fs.readFileString(origin.snapshot("rev-2")), unsafeBytes);
        assert.isFalse(yield* fs.exists(origin.snapshot("rev-3")));

        const index = (yield* readJson(fs, origin.indexPath)) as MutableIndex;
        index.publications[0]!.revisions[1]!.sha256 = sha256Hex(unsafeBytes);
        yield* fs.writeFileString(origin.indexPath, `${JSON.stringify(index, null, 2)}\n`);
        yield* exportTo(outputDirectory, replacement);
        assert.deepStrictEqual(yield* fs.readDirectory(path.join(origin.originDirectory, PUBLICATION_ID)), ["rev-3.json"]);
        const replacementBytes = yield* fs.readFileString(origin.snapshot("rev-3"));
        assert.deepStrictEqual(JSON.parse(replacementBytes), replacement);
        assert.notInclude(replacementBytes, privateMarker);
        const cleanIndex = yield* readPublicEvalIndex({ outputDirectory, dataOrigin: "synthetic" });
        if (cleanIndex === null) return assert.fail("replacement notice index missing");
        const entry = cleanIndex.publications[0]!;
        assert.strictEqual(entry.status, "withdrawn");
        assert.strictEqual(entry.currentRevisionId, "rev-3");
        assert.deepStrictEqual(entry.revisions[1], {
          revisionId: "rev-2",
          revision: 2,
          kind: "withdrawal_notice",
          state: "removed",
          publishedAt: PUBLISHED_3,
          path: null,
          sha256: null,
        });
        assert.notInclude(yield* fs.readFileString(origin.indexPath), privateMarker);
      }),
    );

    it.effect("rejects secrets in a correction summary or withdrawal notice without echoing them", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const { outputDirectory } = yield* canonicalOutputDirectory("publication-secrets-");
        const origin = originPaths(path, outputDirectory);
        yield* exportTo(outputDirectory, initial);
        const indexBytes = yield* fs.readFileString(origin.indexPath);

        const apiKey = "sk-proj-Ab3dEf6hIj9kLm2nOp5qRs8t";
        const token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmaXh0dXJlIn0.c2lnbmF0dXJlZml4dHVyZQ";
        const leakingCorrection: PublicEvalPublication = {
          ...correction,
          supersedes: { revisionId: "rev-1", revision: 1, reason: "correction", summary: `Rotated ${apiKey} after review.` },
        };
        const leakingWithdrawal: PublicEvalPublication = {
          ...withdrawal,
          revisionId: "rev-2",
          revision: 2,
          supersedes: { revisionId: "rev-1", revision: 1, reason: "withdrawal", summary: "Withdrawn." },
          content: { kind: "withdrawal_notice", reason: "privacy", withdrawnAt: WITHDRAWN_AT, notice: `Session ${token} was exposed.` },
        };

        const correctionError = yield* rejection(exportTo(outputDirectory, leakingCorrection), "unsafe_text", "secret in summary");
        assert.notInclude(errorText(correctionError), apiKey);
        const withdrawalError = yield* rejection(exportTo(outputDirectory, leakingWithdrawal), "unsafe_text", "secret in notice");
        assert.notInclude(errorText(withdrawalError), token);

        assert.isFalse(yield* fs.exists(origin.snapshot("rev-2")));
        assert.strictEqual(yield* fs.readFileString(origin.indexPath), indexBytes);
        assert.isTrue(yield* fs.exists(origin.snapshot("rev-1")));
      }),
    );
  });
});
