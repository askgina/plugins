import { createHash } from "node:crypto";

import { Data, Effect, FileSystem, Function, Path, Schema } from "effect";

const OPENROUTER_ENDPOINT_MAX_LENGTH = 128;
const OPENROUTER_ENDPOINT_SLUG =
  /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?(?:\/[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?){0,3}$/;

const modelBaseName = (model: string): string => {
  const separator = model.lastIndexOf("/");
  return separator === -1 ? model : model.slice(separator + 1);
};

export const isExactOpenRouterEndpointSlug = Function.dual<
  (model: string) => (endpoint: string) => boolean,
  (endpoint: string, model: string) => boolean
>(
  2,
  (endpoint, model) =>
    typeof endpoint === "string" &&
    endpoint.length > 0 &&
    endpoint.length <= OPENROUTER_ENDPOINT_MAX_LENGTH &&
    endpoint === endpoint.trim() &&
    OPENROUTER_ENDPOINT_SLUG.test(endpoint) &&
    endpoint !== model &&
    endpoint !== modelBaseName(model),
);

export const LiveEvalRequestedRoutingSchema = Schema.Struct({
  kind: Schema.Literal("openrouter-endpoint"),
  endpoint: Schema.NonEmptyString.check(
    Schema.isMaxLength(OPENROUTER_ENDPOINT_MAX_LENGTH),
    Schema.isPattern(OPENROUTER_ENDPOINT_SLUG),
    Schema.makeFilter((endpoint) => endpoint === endpoint.trim()),
  ),
  allow_fallbacks: Schema.Literal(false),
  require_parameters: Schema.Literal(true),
});

export type LiveEvalRequestedRouting = typeof LiveEvalRequestedRoutingSchema.Type;

export const LiveEvalRequestedRoutingEvidenceSchema = Schema.Struct({
  schemaVersion: Schema.Literal("requested-routing-v1"),
  sourceReportSha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u)),
  requested_routing: LiveEvalRequestedRoutingSchema,
});

export type LiveEvalRequestedRoutingEvidence = typeof LiveEvalRequestedRoutingEvidenceSchema.Type;

export class LiveEvalRequestedRoutingEvidenceError extends Data.TaggedError(
  "LiveEvalRequestedRoutingEvidenceError",
)<{
  readonly reason: "invalid-evidence" | "output-conflict" | "output-exists" | "write-failed";
}> {}

const encodeEvidence = Schema.encodeEffect(
  Schema.fromJsonString(LiveEvalRequestedRoutingEvidenceSchema, { space: 2 }),
);

export const sha256Hex = (content: string): string =>
  createHash("sha256").update(content, "utf8").digest("hex");

export const makeLiveEvalRequestedRoutingEvidence = (options: {
  readonly reportContent: string;
  readonly requestedRouting: LiveEvalRequestedRouting;
}): LiveEvalRequestedRoutingEvidence => ({
  schemaVersion: "requested-routing-v1",
  sourceReportSha256: sha256Hex(options.reportContent),
  requested_routing: options.requestedRouting,
});

export const liveEvalRequestedRoutingEvidenceOutputPath = Function.dual<
  (reportPath: string) => (path: Path.Path) => string,
  (path: Path.Path, reportPath: string) => string
>(2, (path, reportPath) => {
  const ext = path.extname(reportPath);
  const base = ext.length > 0 ? reportPath.slice(0, reportPath.length - ext.length) : reportPath;
  return `${base}.requested-routing-v1.json`;
});

export const writeLiveEvalRequestedRoutingEvidence = (options: {
  readonly outputPath: string;
  readonly reportPath: string;
  readonly reportContent: string;
  readonly evidence: LiveEvalRequestedRoutingEvidence;
}): Effect.Effect<void, LiveEvalRequestedRoutingEvidenceError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const output = path.resolve(options.outputPath);
    const report = path.resolve(options.reportPath);
    const fail = (reason: LiveEvalRequestedRoutingEvidenceError["reason"]) =>
      new LiveEvalRequestedRoutingEvidenceError({ reason });
    if (
      output === report ||
      options.evidence.sourceReportSha256 !== sha256Hex(options.reportContent)
    ) {
      return yield* fail("output-conflict");
    }
    if (yield* fs.exists(output).pipe(Effect.mapError(() => fail("write-failed")))) {
      return yield* fail("output-exists");
    }
    const encoded = yield* encodeEvidence(options.evidence).pipe(
      Effect.mapError(() => fail("invalid-evidence")),
    );
    yield* fs
      .makeDirectory(path.dirname(output), { recursive: true })
      .pipe(Effect.mapError(() => fail("write-failed")));
    yield* fs
      .writeFileString(output, `${encoded}\n`, { flag: "wx", mode: 0o600 })
      .pipe(Effect.mapError(() => fail("write-failed")));
  });
