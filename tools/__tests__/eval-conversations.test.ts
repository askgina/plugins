import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { assert, describe, it } from "@effect/vitest";
import { createHash } from "node:crypto";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import {
  evalConversationsPlugin,
  isLocalConversationRequest,
  readConversation,
} from "../eval-conversations";
import type { ConversationReference } from "../../apps/evals/src/lib/conversations";

const services = Layer.merge(BunFileSystem.layer, BunPath.layer);
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const reference: ConversationReference = {
  campaignId: "reasoning-sweep-2026-09-16",
  rowId: "sample-high",
  family: "spot",
  caseId: "spot-example",
  repetition: 1,
  sourceSummarySha256: "a".repeat(64),
  sourceCommit: "b".repeat(40),
  catalogSha: "c".repeat(64),
  target: "omp_harness",
};
const row = {
  rowId: reference.rowId,
  sourceCommit: reference.sourceCommit,
  target: reference.target,
  provenance: { catalogSha: reference.catalogSha },
  sourceFiles: [
    { path: "results/sample-high/summary.json", sha256: reference.sourceSummarySha256, bytes: 10 },
  ],
};
const document = {
  schemaVersion: "ask-gina-private-evidence.v1",
  rowId: reference.rowId,
  family: reference.family,
  caseId: reference.caseId,
  repetition: reference.repetition,
  rowProvenance: row,
  visibleEvidenceSource: "omp-native-message-events",
  frozenUserTurns: [{ role: "user", content: "A private prompt" }],
  visibleMessages: [
    { role: "user", sequence: 0, content: [{ type: "text", text: "A private prompt" }] },
    {
      role: "assistant",
      sequence: 1,
      content: [{ type: "toolCall", id: "call-1", name: "example", arguments: { query: "test" } }],
    },
    {
      role: "tool",
      sequence: 2,
      content: [{ type: "toolResult", toolCallId: "call-1", text: "A private result" }],
    },
  ],
  completeness: {
    transcriptCaptureComplete: false,
    modelObservedTruncation: true,
    auxiliarySourceComplete: false,
    finalAnswerPresent: false,
    nativeVisibleEvidenceAvailable: true,
  },
  gaps: [{ code: "native-tool-result-truncated", scope: "model-observed-truncation" }],
};

const fixture = (
  options: {
    readonly document?: unknown;
    readonly path?: string;
    readonly duplicate?: boolean;
  } = {},
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.makeTempDirectoryScoped();
    const relative = "chats/sample-high/spot/1-spot-example.json";
    const text = encodeJson(options.document ?? document);
    const entry = {
      rowId: reference.rowId,
      family: reference.family,
      caseId: reference.caseId,
      repetition: reference.repetition,
      path: options.path ?? relative,
      bytes: new TextEncoder().encode(text).byteLength,
      sha256: createHash("sha256").update(text).digest("hex"),
    };
    yield* fs.makeDirectory(path.join(root, "chats/sample-high/spot"), { recursive: true });
    yield* fs.writeFileString(path.join(root, relative), text);
    yield* fs.writeFileString(
      path.join(root, "manifest.json"),
      encodeJson({
        schemaVersion: "ask-gina-private-evidence.v1",
        private: true,
        rows: [row],
        outputs: options.duplicate ? [entry, entry] : [entry],
      }),
    );
    return { root, file: path.join(root, relative), sha256: entry.sha256 };
  });

describe("local conversation evidence", () => {
  it.effect("loads verified evidence, preserving capture gaps and message order", () =>
    Effect.gen(function* () {
      const bundle = yield* fixture();
      const result = yield* readConversation(bundle.root, reference);
      assert.equal(result.status, "available");
      if (result.status !== "available") return;
      assert.equal(result.sha256, bundle.sha256);
      assert.deepEqual(
        result.conversation.visibleMessages.map((message) => message.role),
        ["user", "assistant", "tool"],
      );
      assert.equal(result.conversation.completeness.transcriptCaptureComplete, false);
      assert.deepEqual(result.conversation.gaps, document.gaps);
    }).pipe(Effect.scoped, Effect.provide(services)),
  );

  it.effect("does not bind a different campaign, summary, configuration or repetition", () =>
    Effect.gen(function* () {
      const bundle = yield* fixture();
      for (const patch of [
        { campaignId: "older-campaign" },
        { rowId: "sample-low" },
        { family: "perps" },
        { repetition: 2 },
        { sourceSummarySha256: "d".repeat(64) },
        { catalogSha: "e".repeat(64) },
        { sourceCommit: "other-commit" },
        { target: "muse_cli" },
      ])
        assert.equal(
          (yield* readConversation(bundle.root, { ...reference, ...patch })).status,
          "unavailable",
        );
    }).pipe(Effect.scoped, Effect.provide(services)),
  );

  it.effect("rejects changed bytes and contradictory document identity", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const bundle = yield* fixture();
      yield* fs.writeFileString(bundle.file, "changed bytes");
      assert.deepEqual(yield* readConversation(bundle.root, reference), {
        status: "unavailable",
        reason: "mismatch",
      });
      const wrong = yield* fixture({ document: { ...document, repetition: 2 } });
      assert.deepEqual(yield* readConversation(wrong.root, reference), {
        status: "unavailable",
        reason: "mismatch",
      });
    }).pipe(Effect.scoped, Effect.provide(services)),
  );

  it.effect("rejects malformed documents, ambiguous entries and path traversal", () =>
    Effect.gen(function* () {
      for (const options of [
        { document: { ...document, visibleMessages: "invalid" } },
        { duplicate: true },
        { path: "../../private.json" },
      ]) {
        const bundle = yield* fixture(options);
        assert.equal((yield* readConversation(bundle.root, reference)).status, "unavailable");
      }
    }).pipe(Effect.scoped, Effect.provide(services)),
  );

  it.effect("rejects symlinks out of the bundle", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const bundle = yield* fixture();
      const outside = yield* fs.makeTempDirectoryScoped();
      const target = path.join(outside, "outside.json");
      yield* fs.copyFile(bundle.file, target);
      yield* fs.remove(bundle.file);
      yield* fs.symlink(target, bundle.file);
      assert.deepEqual(yield* readConversation(bundle.root, reference), {
        status: "unavailable",
        reason: "invalid_bundle",
      });
    }).pipe(Effect.scoped, Effect.provide(services)),
  );

  it("only enables the endpoint in development and rejects remote or cross-origin reads", () => {
    assert.equal(evalConversationsPlugin().apply, "serve");
    const local = {
      remoteAddress: "127.0.0.1",
      host: "localhost:5173",
      origin: "http://localhost:5173",
      fetchSite: "same-origin",
    };
    assert.isTrue(isLocalConversationRequest(local));
    assert.isTrue(isLocalConversationRequest({ remoteAddress: "::1", host: "[::1]:5173" }));
    for (const patch of [
      { remoteAddress: "192.168.1.10" },
      { host: "attacker.example" },
      { origin: "http://localhost:9000" },
      { origin: "https://attacker.example" },
      { fetchSite: "cross-site" },
      { fetchSite: "same-site" },
    ])
      assert.isFalse(isLocalConversationRequest({ ...local, ...patch }));
  });
});
