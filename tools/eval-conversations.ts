import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { createHash } from "node:crypto";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import { loadEnv, type Plugin } from "vite-plus";
import {
  CONVERSATION_ENDPOINT,
  type ConversationReference,
  type ConversationResponse,
} from "../apps/evals/src/lib/conversations";

const CAMPAIGN = "reasoning-sweep-2026-09-16";
const Identifier = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,150}$/u));
const Sha256 = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u));
const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0));
const ReferenceSchema = Schema.Struct({
  campaignId: Schema.Literal(CAMPAIGN),
  rowId: Identifier,
  family: Schema.Literals(["spot", "perps", "predictions"]),
  caseId: Identifier,
  repetition: PositiveInt,
  sourceSummarySha256: Sha256,
  sourceCommit: Schema.String,
  catalogSha: Sha256,
  target: Schema.String,
});
const FileSchema = Schema.Struct({ path: Schema.String, sha256: Sha256, bytes: PositiveInt });
const RowSchema = Schema.Struct({
  rowId: Identifier,
  sourceCommit: Schema.String,
  target: Schema.String,
  provenance: Schema.Struct({ catalogSha: Sha256 }),
  sourceFiles: Schema.Array(FileSchema),
});
const ManifestSchema = Schema.Struct({
  schemaVersion: Schema.Literal("ask-gina-private-evidence.v1"),
  private: Schema.Literal(true),
  rows: Schema.Array(RowSchema),
  outputs: Schema.Array(
    Schema.Struct({
      ...FileSchema.fields,
      rowId: Schema.optional(Schema.String),
      family: Schema.optional(Schema.String),
      caseId: Schema.optional(Schema.String),
      repetition: Schema.optional(PositiveInt),
    }),
  ),
});
const ContentSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal("text"), text: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("toolCall"),
    name: Schema.String,
    id: Schema.optional(Schema.String),
    call_id: Schema.optional(Schema.String),
    arguments: Schema.Unknown,
  }),
  Schema.Struct({
    type: Schema.Literal("toolResult"),
    text: Schema.String,
    toolCallId: Schema.optional(Schema.String),
    toolName: Schema.optional(Schema.String),
    isError: Schema.optional(Schema.Boolean),
  }),
]);
const ConversationSchema = Schema.Struct({
  schemaVersion: Schema.Literal("ask-gina-private-evidence.v1"),
  rowId: Identifier,
  family: Schema.String,
  caseId: Identifier,
  repetition: PositiveInt,
  rowProvenance: Schema.Struct({
    rowId: Identifier,
    sourceCommit: Schema.String,
    target: Schema.String,
    provenance: Schema.Struct({ catalogSha: Sha256 }),
  }),
  visibleEvidenceSource: Schema.String,
  frozenUserTurns: Schema.Array(Schema.Struct({ role: Schema.String, content: Schema.String })),
  visibleMessages: Schema.Array(
    Schema.Struct({
      role: Schema.Literals(["user", "assistant", "tool"]),
      sequence: Schema.Int,
      content: Schema.Array(ContentSchema),
    }),
  ),
  completeness: Schema.Struct({
    transcriptCaptureComplete: Schema.Boolean,
    modelObservedTruncation: Schema.Boolean,
    auxiliarySourceComplete: Schema.Boolean,
    finalAnswerPresent: Schema.Boolean,
    nativeVisibleEvidenceAvailable: Schema.Boolean,
  }),
  gaps: Schema.Array(Schema.Struct({ code: Schema.String, scope: Schema.String })),
});

const unavailable = (
  reason: Extract<ConversationResponse, { status: "unavailable" }>["reason"],
): ConversationResponse => ({ status: "unavailable", reason });

/** The caller supplies an identity, never a filesystem path. All reads stay inside the bundle. */
export const readConversation = (directory: string, reference: ConversationReference) =>
  Effect.gen(function* () {
    const ref = yield* Schema.decodeUnknownEffect(ReferenceSchema)(reference);
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.realPath(directory);
    const manifestPath = yield* fs.realPath(path.join(root, "manifest.json"));
    if (!manifestPath.startsWith(`${root}${path.sep}`)) return unavailable("invalid_bundle");
    const manifest = yield* fs
      .readFileString(manifestPath)
      .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(ManifestSchema))));
    const rows = manifest.rows.filter((row) => row.rowId === ref.rowId);
    const row = rows[0];
    if (rows.length !== 1 || !row) return unavailable("not_found");
    if (
      row.sourceCommit !== ref.sourceCommit ||
      row.target !== ref.target ||
      row.provenance.catalogSha !== ref.catalogSha ||
      !row.sourceFiles.some(
        (file) =>
          file.path === `results/${ref.rowId}/summary.json` &&
          file.sha256 === ref.sourceSummarySha256,
      )
    )
      return unavailable("mismatch");
    const entries = manifest.outputs.filter(
      (entry) =>
        entry.rowId === ref.rowId &&
        entry.family === ref.family &&
        entry.caseId === ref.caseId &&
        entry.repetition === ref.repetition,
    );
    const entry = entries[0];
    if (!entry) return unavailable("not_found");
    const expectedPath = `chats/${ref.rowId}/${ref.family}/${ref.repetition}-${ref.caseId}.json`;
    if (entries.length !== 1 || entry.path !== expectedPath) return unavailable("mismatch");
    const filePath = yield* fs.realPath(path.join(root, entry.path));
    if (!filePath.startsWith(`${root}${path.sep}`)) return unavailable("invalid_bundle");
    const bytes = yield* fs.readFile(filePath);
    if (
      bytes.byteLength !== entry.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== entry.sha256
    )
      return unavailable("mismatch");
    const document = yield* Schema.decodeEffect(Schema.fromJsonString(ConversationSchema))(
      new TextDecoder().decode(bytes),
    );
    if (
      document.rowId !== ref.rowId ||
      document.family !== ref.family ||
      document.caseId !== ref.caseId ||
      document.repetition !== ref.repetition ||
      document.rowProvenance.rowId !== ref.rowId ||
      document.rowProvenance.sourceCommit !== ref.sourceCommit ||
      document.rowProvenance.target !== ref.target ||
      document.rowProvenance.provenance.catalogSha !== ref.catalogSha
    )
      return unavailable("mismatch");
    return {
      status: "available",
      conversation: document,
      sha256: entry.sha256,
    } satisfies ConversationResponse;
  }).pipe(Effect.orElseSucceed(() => unavailable("invalid_bundle")));

const services = Layer.merge(BunFileSystem.layer, BunPath.layer);
const encodeResponse = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

/** Private evidence is only served to the local, same-origin development UI. */
export function isLocalConversationRequest(input: {
  readonly remoteAddress?: string;
  readonly host?: string;
  readonly origin?: string;
  readonly fetchSite?: string;
}): boolean {
  if (
    !input.remoteAddress ||
    !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(input.remoteAddress)
  )
    return false;
  if (!input.host || !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/u.test(input.host)) return false;
  if (
    input.origin &&
    input.origin !== `http://${input.host}` &&
    input.origin !== `https://${input.host}`
  )
    return false;
  return !input.fetchSite || input.fetchSite === "same-origin" || input.fetchSite === "none";
}

export const evalConversationsPlugin = (directory?: string): Plugin => ({
  name: "local-eval-conversations",
  apply: "serve",
  configResolved(config) {
    directory ??= loadEnv(config.mode, config.envDir, "EVAL_").EVAL_TRANSCRIPTS_DIR;
  },
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      if (request.url?.split("?")[0] !== CONVERSATION_ENDPOINT) return next();
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
      const send = (result: ConversationResponse, status = 200) => {
        response.statusCode = status;
        response.end(encodeResponse(result));
      };
      if (
        !isLocalConversationRequest({
          remoteAddress: request.socket.remoteAddress,
          host: request.headers.host,
          origin: request.headers.origin,
          fetchSite:
            typeof request.headers["sec-fetch-site"] === "string"
              ? request.headers["sec-fetch-site"]
              : undefined,
        })
      )
        return send(unavailable("forbidden"), 403);
      if (request.method !== "GET") {
        response.setHeader("Allow", "GET");
        return send(unavailable("forbidden"), 405);
      }
      if (!directory) return send(unavailable("not_configured"));
      const params = new URL(request.url!, "http://localhost").searchParams;
      const reference = {
        campaignId: params.get("campaignId") ?? "",
        rowId: params.get("rowId") ?? "",
        family: params.get("family") ?? "",
        caseId: params.get("caseId") ?? "",
        repetition: Number(params.get("repetition")),
        sourceSummarySha256: params.get("sourceSummarySha256") ?? "",
        sourceCommit: params.get("sourceCommit") ?? "",
        catalogSha: params.get("catalogSha") ?? "",
        target: params.get("target") ?? "",
      };
      void Effect.runPromise(readConversation(directory, reference).pipe(Effect.provide(services)))
        .then((result) => send(result))
        .catch(() => send(unavailable("invalid_bundle"), 500));
    });
  },
});
