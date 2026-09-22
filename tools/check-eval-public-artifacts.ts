#!/usr/bin/env bun

import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import { createHash } from "node:crypto";
import { Data, Effect, FileSystem, Function, Layer, Option, Path, Schema } from "effect";
import type { Plugin } from "vite-plus";

import {
  PUBLIC_EVAL_DECODE_OPTIONS,
  PublicEvalIdentifierSchema,
  PublicEvalModelSchema,
  PublicEvalSha256Schema,
  PublicEvalTimestampSchema,
} from "../packages/contracts/src/eval-results";
import { isSafePublicEvalText } from "../packages/evals/src/sanitize";
import { isUnknownRecord } from "../packages/evals/src/type-guards";
import {
  PUBLIC_TRANSCRIPTS_COUNT,
  PUBLIC_TRANSCRIPTS_INDEX_SHA256,
} from "../apps/evals/src/lib/public-transcript-manifest";
import {
  isPublicTranscript,
  isPublicTranscriptIndex,
  publicTranscriptPath,
  type PublicTranscriptEntry,
} from "../apps/evals/src/lib/public-transcript-schema";

const WITHHELD = "withheld: privacy_review";
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Repetition = Schema.Int.check(Schema.isGreaterThan(0));
const SafeIdentifier = PublicEvalIdentifierSchema.check(Schema.makeFilter(isSafePublicEvalText));
const SafeModel = PublicEvalModelSchema.check(Schema.makeFilter(isSafePublicEvalText));
const TokenUsage = Schema.Struct({
  input_tokens: Count,
  output_tokens: Count,
  total_tokens: Count,
});
const Observation = Schema.Struct({
  version: Schema.Literal(1),
  run_id: SafeIdentifier,
  case_id: SafeIdentifier,
  target: SafeIdentifier,
  model: SafeModel,
  repetition: Repetition,
  started_at: PublicEvalTimestampSchema,
  status: Schema.Literals(["completed", "failed"]),
  duration_ms: Count,
  token_usage: Schema.NullOr(TokenUsage),
});
const ScoreDimension = Schema.Struct({
  score: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  details: Schema.Array(Schema.Literal(WITHHELD)),
});
const Score = Schema.Struct({
  case_id: SafeIdentifier,
  overall_pass: Schema.Boolean,
  routing: ScoreDimension,
  arguments: ScoreDimension,
  completion: ScoreDimension,
  safety: Schema.optional(ScoreDimension),
  latency_ms: Count,
  total_result_bytes: Count,
});
const TrialError = Schema.Struct({
  tag: Schema.Literals([
    "PluginEvalOmpHarnessProcessError",
    "PluginEvalOmpHarnessTimeoutError",
    "PluginEvalOmpHarnessSpawnError",
    "PluginEvalOmpHarnessMcpError",
    "PluginEvalMuseCliTimeoutError",
    "PluginEvalMuseCliProcessError",
    "PluginEvalMuseMcpError",
    "PluginEvalDevinTimeoutError",
    "PluginEvalDevinSpawnError",
    "PluginEvalDevinMcpError",
    "PluginEvalDevinProcessError",
  ]),
  reason: Schema.NullOr(Schema.Literal(WITHHELD)),
});
const Trial = Schema.Struct({
  caseId: SafeIdentifier,
  repetition: Repetition,
  dispatchedAt: PublicEvalTimestampSchema,
  outcome: Schema.Literals(["observed", "runtime_failure"]),
  observation: Schema.NullOr(Observation),
  score: Schema.NullOr(Score),
  error: Schema.NullOr(TrialError),
  wallDurationMs: Schema.optional(Count),
});
const DimensionCounts = Schema.Struct({ passed: Count, failed: Count, unscored: Count });
const Dimensions = Schema.Struct({
  routing: DimensionCounts,
  arguments: DimensionCounts,
  completion: DimensionCounts,
  safety: DimensionCounts,
  skill_activation: DimensionCounts,
});

const RuntimeClassificationCounts = Schema.Struct({
  planned: Count,
  terminal: Count,
  graded: Count,
  passed: Count,
  failed: Count,
  unscored: Count,
  timeouts: Count,
  pending: Count,
});
const RuntimeClassification = Schema.Struct({
  schemaVersion: Schema.Literal("ask-gina-runtime-classification.v1"),
  receipt: Schema.Literal("classification-receipt.json"),
  receiptAvailability: Schema.Literal("withheld"),
  receiptSha256: PublicEvalSha256Schema,
  classifierSha256: PublicEvalSha256Schema,
  derived: Schema.Literal(true),
  scope: Schema.Literal("post-run-runtime-classification"),
  noAnswerRegrade: Schema.Literal(true),
  noOutcomeSelectiveRerun: Schema.Literal(true),
  rawEvidenceUnchanged: Schema.Literal(true),
  observationFiles: Schema.Literal("raw-unchanged"),
  counts: Schema.Struct({
    raw: RuntimeClassificationCounts,
    corrected: RuntimeClassificationCounts,
    changed: Count,
  }),
});

// Schema.is is a type guard, not the exporter's excess-property decoder.
// Decode strictly, discard the decoded value, and leave public bytes unchanged.
const strictFields: Readonly<Record<string, (value: unknown) => Option.Option<unknown>>> = {
  observation: Schema.decodeUnknownOption(Schema.NullOr(Observation), PUBLIC_EVAL_DECODE_OPTIONS),
  trials: Schema.decodeUnknownOption(Schema.Array(Trial), PUBLIC_EVAL_DECODE_OPTIONS),
  score: Schema.decodeUnknownOption(Schema.NullOr(Score), PUBLIC_EVAL_DECODE_OPTIONS),
  error: Schema.decodeUnknownOption(Schema.NullOr(TrialError), PUBLIC_EVAL_DECODE_OPTIONS),
  dimensions: Schema.decodeUnknownOption(Dimensions, PUBLIC_EVAL_DECODE_OPTIONS),
  token_usage: Schema.decodeUnknownOption(Schema.NullOr(TokenUsage), PUBLIC_EVAL_DECODE_OPTIONS),
  runtimeClassification: Schema.decodeUnknownOption(
    Schema.NullOr(RuntimeClassification),
    PUBLIC_EVAL_DECODE_OPTIONS,
  ),
};
const RAW_FIELDS: Readonly<Record<string, true>> = {
  activatedskills: true,
  availabletools: true,
  answer: true,
  finalanswer: true,
  toolcalls: true,
  toolarguments: true,
  arguments: true,
  result: true,
  results: true,
  toolresult: true,
  toolresults: true,
  raw: true,
  rawresult: true,
  rawresults: true,
  rawresponse: true,
  rawoutput: true,
  payload: true,
  prompt: true,
  request: true,
  response: true,
  transcript: true,
  transcripts: true,
  nativetranscript: true,
  nativetranscripts: true,
  messages: true,
  message: true,
  content: true,
  stderr: true,
  stdout: true,
  stack: true,
  thinking: true,
  reasoningcontent: true,
  providererror: true,
};
// Mirrors OMP_REASONING in packages/evals/src/omp-harness.ts.
const REASONING_LEVELS: Readonly<Record<string, true>> = {
  off: true,
  minimal: true,
  low: true,
  medium: true,
  high: true,
  xhigh: true,
  max: true,
  auto: true,
  none: true,
};
const DIGEST = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const CLAUDE_ID = /(?:^|[/-])claude(?:[/-]|$)/iu;
// Freeze the reviewed legacy projections, including their free-form source
// metadata. New paths or changed bytes require a new explicit privacy review.
const APPROVED_CLAUDE_ARTIFACTS: Readonly<Record<string, string>> = {
  // Numeric-only costs; user explicitly approved public inclusion on 2026-09-18.
  "src/results/2026-09-16/reasoning-sweep/native-cost-estimates.json":
    "ce34869373a72390ca458c721f201ebcb14180e789be9f19095ca301063d8c6a",
  "src/results/2026-09-14/claude-comparison/ask-gina-claude-comparison.json":
    "acf6b70af1dafe75b305326555244e3798f02bcce390dfde4d2ffa299e8bd573",
  "src/results/2026-09-14/claude-comparison/fable/manifest.json":
    "86febc02123b7cb943a3948501307da155c2322a6f18916cb02b6d31eace4ba3",
  "src/results/2026-09-14/claude-comparison/fable/perps/summary.json":
    "f7ce5a1b8465bc10a3e3598022e3c36a2ac6f625a4a4f7dd2de1abeac7df2bf8",
  "src/results/2026-09-14/claude-comparison/fable/predictions/summary.json":
    "64ca89edf23ed1082258447e4da21333cdf505b9f7d1014c40558a15f46e0918",
  "src/results/2026-09-14/claude-comparison/fable/spot/summary.json":
    "5cf51d5d122fce4bc6283b1f0b47875d3c4de2a5e30515fabe54869e7dafefe8",
  "src/results/2026-09-14/claude-comparison/fable/summary.json":
    "90ed9f5f7e4dc6ec03aeff63520f3ad1d3ac21e7132dbd5580d123b887b9bc0f",
  "src/results/2026-09-14/claude-comparison/opus/manifest.json":
    "a06a7b0e47c33d7f23d37fb9c19cb9d22243f090cea5e7b1c776cd6d9e14a24b",
  "src/results/2026-09-14/claude-comparison/opus/perps/summary.json":
    "9923741be37ac93e54e74fb008b2d7c6bf195cba53ce801edb42d7922f6fb5f5",
  "src/results/2026-09-14/claude-comparison/opus/predictions/summary.json":
    "ce176afdb2cdeac8afdbe4a04825b2ef2af71bc229984b3b86ffca47245ab21e",
  "src/results/2026-09-14/claude-comparison/opus/spot/summary.json":
    "a6ee7e2b16a5a50ed00fe6c07b5f3dfba1201b627bc90ca96a1e23ee0be44da9",
  "src/results/2026-09-14/claude-comparison/opus/summary.json":
    "fc51350994c62ef6cf5a66e01cf114663f8dc6924e4bfae8b8c6064c98ce762f",
  "src/results/2026-09-14/claude-comparison/reproduction/provenance.json":
    "678bb0a4a8bf78122bc47fa67d28a590eef97a2e41405bf6419112de4f658655",
  "src/results/2026-09-14/claude-comparison/verification.json":
    "2e94fc424fd8f5d113cc12eaf1652ed6543d752f1c0f0a8bdae6169cff49dabd",
  "src/results/2026-09-16/reasoning-sweep/ask-gina-reasoning-sweep-claude.json":
    "11ece4bed01869d5ffa527356f2ef238f6f7f5e4eb31e21a67587b405c7bf50e",
  "src/results/2026-09-16/reasoning-sweep/reproduction/provenance.json":
    "42c7b624e51243db81b3efd183f46391948285d3a5799c84a63d2dc731a67afd",
  "src/results/2026-09-16/reasoning-sweep/verification.json":
    "689cef4e22af910e1aa7ff76ff6dc837c16320fa993e9fd459d9ddffac595319",
  "src/results/2026-09-16/reasoning-sweep/rows/fable-high.json":
    "0d3f04d44dbf0e98bea6c5d7975505e39227f316b277b3f1509f4b4c91078218",
  "src/results/2026-09-16/reasoning-sweep/rows/fable-low.json":
    "b08aaa7655458f24443e655f9180fbe7ddb0aa95e2fde9814f818fd1211c7098",
  "src/results/2026-09-16/reasoning-sweep/rows/fable-max.json":
    "74c4b82bc921de30df0586eebe335f2ba6f79cc1dd5ebb64c25ebca2a650674b",
  "src/results/2026-09-16/reasoning-sweep/rows/fable-medium.json":
    "5591398e1c758018574b86f8f304ec51b07fc2a45eda23bdd8c188412906f2c8",
  "src/results/2026-09-16/reasoning-sweep/rows/opus-high.json":
    "fae1d2eefddcd092b63c8fa3e6d4b3330d5e0b0efdf8212145e38501ecd28873",
  "src/results/2026-09-16/reasoning-sweep/rows/opus-low.json":
    "a97890fb582e740437ec21edf5b9d156a9e8dd270a76f21b8355f86571e8053b",
  "src/results/2026-09-16/reasoning-sweep/rows/opus-max.json":
    "0b2f48588e105a01b997da02079e9454cd225659f89a1c7b12daa62d7700a8ba",
  "src/results/2026-09-16/reasoning-sweep/rows/opus-medium.json":
    "7e8c040a63aeb74248df73fd683deb0d0fb37f52fee58616b786a361c9aeb1d5",
};
const textDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const APPROVED_RECOVERY_ARTIFACTS: Readonly<Record<string, string>> = {
  "src/results/2026-09-21/recovery/results.json":
    "ee45efee5273f04f46146e2e0886afff7008b325211ccefb467b748e8d93eecc",
  "src/results/2026-09-21/recovery/snapshot.json":
    "a4e5b8a350e822d687e8cd85f7db64bdfb70c2776f11cf96e56a1a3d87ccf5fe",
};
const APPROVED_GROK47_ARTIFACTS: Readonly<Record<string, string>> = {
  "src/results/2026-09-22/grok-4.7/low-recovery.json":
    "f1b51cf3fea244e9928f70bbce37bcc5fa130c34c18fa119009b5f7b3ce4f1e5",
  "src/results/2026-09-22/grok-4.7/low-recovery-snapshot.json":
    "6c74ad1fd6f5d61605ce50593787b4fcd9d5ed44cf8f3f3c2b743680ca4b8b58",
  "src/results/2026-09-22/grok-4.7/results.json":
    "88d508cc4fa4b0a0c74e725bbabed8c50744ccd1ee91465666e845fca9cf91ef",
  "src/results/2026-09-22/grok-4.7/snapshot.json":
    "cdb01a1faf2db9b4f2806c042fc3f5831a3d1eb0d7237b56aa2a11697974bf4f",
};
// Numeric checks, public identifiers and evidence hashes only. Original result
// and transcript bytes stay pinned separately above.
const APPROVED_REGRADE_RECEIPT_SHA256 =
  "253072b330612f4d6e1f57e52d8b3e464ca743f893ed1146cecde41f78e76716";
const APPROVED_PERPS_REGRADE_RECEIPT_SHA256 =
  "da9a0c8201dcd24012d51961a4d5b32d0b8d8fd6129c5ecb04775d7f6e97c239";
const decodeArtifactJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

/** Fixed diagnostics never include provider values or schema issue excerpts. */
export class EvalPublicArtifactError extends Data.TaggedError("EvalPublicArtifactError")<{
  readonly file: string;
  readonly reason:
    | "invalid_json"
    | "private_payload"
    | "unapproved_artifact"
    | "unreadable_artifact"
    | "unsupported_entry";
}> {
  override get message(): string {
    return `Public eval artifact rejected (${this.reason}): ${this.file}`;
  }
}

const safeMetadata = (value: unknown): boolean => {
  if (typeof value === "string") return DIGEST.test(value) || isSafePublicEvalText(value);
  if (Array.isArray(value)) return value.every(safeMetadata);
  if (!isUnknownRecord(value)) return true;

  for (const [key, child] of Object.entries(value)) {
    if (!isSafePublicEvalText(key)) return false;
    if (Object.hasOwn(strictFields, key)) {
      if (Option.isNone(strictFields[key]!(child))) return false;
      // IDs use the shared privacy predicate; enums and withheld text are exact
      // schema literals, not arbitrary strings for the secret heuristic to guess.
      continue;
    }
    const normalized = key.replace(/[_-]/gu, "").toLowerCase();
    if (Object.hasOwn(RAW_FIELDS, normalized)) return false;
    if (normalized === "details") {
      if (!Array.isArray(child) || !child.every((detail) => detail === WITHHELD)) return false;
    } else if (normalized === "reason") {
      if (child !== null && child !== WITHHELD) return false;
    } else if (normalized === "reasoning") {
      if (typeof child !== "string" || !Object.hasOwn(REASONING_LEVELS, child)) return false;
    } else if (!safeMetadata(child)) {
      return false;
    }
  }
  return true;
};

const hasClaudeIdentity = (value: unknown, field = ""): boolean => {
  if (typeof value === "string") {
    return ["model", "models", "runId", "run_id"].includes(field) && CLAUDE_ID.test(value);
  }
  if (Array.isArray(value)) return value.some((child) => hasClaudeIdentity(child, field));
  return (
    isUnknownRecord(value) &&
    Object.entries(value).some(([key, child]) => hasClaudeIdentity(child, key))
  );
};

export const validateClaudePublicArtifact = Function.dual<
  (file: string) => (input: unknown) => Effect.Effect<void, EvalPublicArtifactError>,
  (input: unknown, file: string) => Effect.Effect<void, EvalPublicArtifactError>
>(2, (input, file) =>
  safeMetadata(input)
    ? Effect.void
    : Effect.fail(new EvalPublicArtifactError({ file, reason: "private_payload" })),
);

/** Scan source imports AND copied public assets, not a hand-maintained report list. */
export const checkEvalPublicArtifacts = (appRoot?: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const fail = (file: string, reason: EvalPublicArtifactError["reason"]) =>
      new EvalPublicArtifactError({ file, reason });
    const root =
      appRoot ??
      (yield* path
        .fromFileUrl(new URL("../apps/evals/", import.meta.url))
        .pipe(Effect.mapError(() => fail("apps/evals", "unreadable_artifact"))));
    const transcriptFiles = new Map<string, PublicTranscriptEntry>();
    const transcriptIndex = "public/transcripts/index.json";
    const hasTranscripts = yield* fs
      .exists(path.join(root, "public/transcripts"))
      .pipe(Effect.mapError(() => fail(transcriptIndex, "unreadable_artifact")));
    if (appRoot === undefined && !hasTranscripts)
      return yield* fail(transcriptIndex, "unreadable_artifact");
    if (hasTranscripts) {
      const bytes = yield* fs
        .readFile(path.join(root, transcriptIndex))
        .pipe(Effect.mapError(() => fail(transcriptIndex, "unreadable_artifact")));
      if (createHash("sha256").update(bytes).digest("hex") !== PUBLIC_TRANSCRIPTS_INDEX_SHA256)
        return yield* fail(transcriptIndex, "unapproved_artifact");
      const index = yield* Effect.try(() => textDecoder.decode(bytes)).pipe(
        Effect.flatMap(decodeArtifactJson),
        Effect.mapError(() => fail(transcriptIndex, "invalid_json")),
      );
      if (!isPublicTranscriptIndex(index) || index.conversationCount !== PUBLIC_TRANSCRIPTS_COUNT)
        return yield* fail(transcriptIndex, "unapproved_artifact");
      for (const entry of index.files)
        transcriptFiles.set(`public/transcripts/${entry.path}`, entry);
    }
    const seenTranscripts = new Set<string>();
    const visit = (relative: string): Effect.Effect<void, EvalPublicArtifactError> =>
      Effect.gen(function* () {
        const absolute = path.join(root, relative);
        const symlink = yield* fs
          .readLink(absolute)
          .pipe(Effect.match({ onFailure: () => false, onSuccess: () => true }));
        if (symlink) return yield* fail(relative, "unsupported_entry");
        const info = yield* fs
          .stat(absolute)
          .pipe(Effect.mapError(() => fail(relative, "unreadable_artifact")));
        if (info.type === "Directory") {
          const names = yield* fs
            .readDirectory(absolute)
            .pipe(Effect.mapError(() => fail(relative, "unreadable_artifact")));
          for (const name of names.sort()) yield* visit(`${relative}/${name}`);
          return;
        }
        if (info.type !== "File") return yield* fail(relative, "unsupported_entry");
        const publicTranscript = relative.startsWith("public/transcripts/");
        const grok47Artifact = relative.startsWith("src/results/2026-09-22/grok-4.7/");
        if (!relative.toLowerCase().endsWith(".json")) {
          if (publicTranscript || grok47Artifact)
            return yield* fail(relative, "unapproved_artifact");
          return;
        }
        const bytes = yield* fs
          .readFile(absolute)
          .pipe(Effect.mapError(() => fail(relative, "unreadable_artifact")));
        const input = yield* Effect.try(() => textDecoder.decode(bytes)).pipe(
          Effect.flatMap(decodeArtifactJson),
          Effect.mapError(() => fail(relative, "invalid_json")),
        );
        // Only the reviewed, immutable public projection can carry visible chat
        // content. Raw/native evidence remains forbidden everywhere else.
        if (publicTranscript) {
          if (relative === transcriptIndex) return;
          const entry = transcriptFiles.get(relative);
          if (
            entry === undefined ||
            bytes.byteLength !== entry.bytes ||
            createHash("sha256").update(bytes).digest("hex") !== entry.sha256 ||
            !isPublicTranscript(input) ||
            publicTranscriptPath(input.reference) !== entry.path
          )
            return yield* fail(relative, "unapproved_artifact");
          seenTranscripts.add(relative);
          return;
        }
        if (relative.startsWith("src/results/2026-09-21/regrade/")) {
          if (
            createHash("sha256").update(bytes).digest("hex") !==
            (relative === "src/results/2026-09-21/regrade/receipt.json"
              ? APPROVED_REGRADE_RECEIPT_SHA256
              : relative === "src/results/2026-09-21/regrade/perps-receipt.json"
                ? APPROVED_PERPS_REGRADE_RECEIPT_SHA256
                : undefined)
          ) {
            return yield* fail(relative, "unapproved_artifact");
          }
          return;
        }
        const claudeBearing = /claude/iu.test(relative) || hasClaudeIdentity(input);
        const sweepArtifact = relative.startsWith("src/results/2026-09-16/reasoning-sweep/");
        const recoveryArtifact = relative.startsWith("src/results/2026-09-21/recovery/");
        if (
          recoveryArtifact &&
          (!Object.hasOwn(APPROVED_RECOVERY_ARTIFACTS, relative) ||
            createHash("sha256").update(bytes).digest("hex") !==
              APPROVED_RECOVERY_ARTIFACTS[relative])
        )
          return yield* fail(relative, "unapproved_artifact");
        if (
          grok47Artifact &&
          (!Object.hasOwn(APPROVED_GROK47_ARTIFACTS, relative) ||
            createHash("sha256").update(bytes).digest("hex") !==
              APPROVED_GROK47_ARTIFACTS[relative])
        )
          return yield* fail(relative, "unapproved_artifact");
        if (claudeBearing || sweepArtifact || recoveryArtifact || grok47Artifact) {
          yield* validateClaudePublicArtifact(input, relative);
        }
        if (claudeBearing) {
          if (
            !Object.hasOwn(APPROVED_CLAUDE_ARTIFACTS, relative) ||
            createHash("sha256").update(bytes).digest("hex") !== APPROVED_CLAUDE_ARTIFACTS[relative]
          ) {
            return yield* fail(relative, "unapproved_artifact");
          }
        }
      });
    yield* visit("src");
    yield* visit("public");
    if (seenTranscripts.size !== transcriptFiles.size)
      return yield* fail(transcriptIndex, "unreadable_artifact");
  });

const services = Layer.merge(BunFileSystem.layer, BunPath.layer);
const main = (appRoot?: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const context = yield* Layer.build(services);
      return yield* checkEvalPublicArtifacts(appRoot).pipe(Effect.provide(context));
    }),
  );

/** Runs before Vite reads JSON imports, emits ?url assets, or copies public/. */
export const evalPublicArtifactsPlugin = (appRoot?: string): Plugin => ({
  name: "check-eval-public-artifacts",
  configResolved: () => Effect.runPromise(main(appRoot)),
});

if (import.meta.main) {
  BunRuntime.runMain(main());
}
