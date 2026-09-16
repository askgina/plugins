#!/usr/bin/env bun

import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import { createHash } from "node:crypto";
import { Data, Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import type { Plugin } from "vite-plus";

import {
  PUBLIC_EVAL_DECODE_OPTIONS,
  PublicEvalIdentifierSchema,
  PublicEvalModelSchema,
  PublicEvalTimestampSchema,
} from "../packages/contracts/src/eval-results";
import { isSafePublicEvalText } from "../packages/evals/src/sanitize";
import { isUnknownRecord } from "../packages/evals/src/type-guards";

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
  token_usage: TokenUsage,
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
  tag: Schema.Literals(["PluginEvalOmpHarnessProcessError", "PluginEvalOmpHarnessTimeoutError"]),
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

// Schema.is is a type guard, not the exporter's excess-property decoder.
// Decode strictly, discard the decoded value, and leave public bytes unchanged.
const strictFields: Readonly<Record<string, (value: unknown) => Option.Option<unknown>>> = {
  observation: Schema.decodeUnknownOption(Schema.NullOr(Observation), PUBLIC_EVAL_DECODE_OPTIONS),
  trials: Schema.decodeUnknownOption(Schema.Array(Trial), PUBLIC_EVAL_DECODE_OPTIONS),
  score: Schema.decodeUnknownOption(Schema.NullOr(Score), PUBLIC_EVAL_DECODE_OPTIONS),
  error: Schema.decodeUnknownOption(Schema.NullOr(TrialError), PUBLIC_EVAL_DECODE_OPTIONS),
  dimensions: Schema.decodeUnknownOption(Dimensions, PUBLIC_EVAL_DECODE_OPTIONS),
  token_usage: Schema.decodeUnknownOption(TokenUsage, PUBLIC_EVAL_DECODE_OPTIONS),
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
const REASONING_LEVELS: Readonly<Record<string, true>> = {
  none: true,
  minimal: true,
  low: true,
  medium: true,
  high: true,
  xhigh: true,
};
const DIGEST = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const CLAUDE_ID = /(?:^|[/-])claude(?:[/-]|$)/iu;
// Freeze the reviewed legacy projections, including their free-form source
// metadata. New paths or changed bytes require a new explicit privacy review.
const APPROVED_CLAUDE_ARTIFACTS: Readonly<Record<string, string>> = {
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
};
const textDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
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

export const validateClaudePublicArtifact = (input: unknown, file: string) =>
  safeMetadata(input)
    ? Effect.void
    : Effect.fail(new EvalPublicArtifactError({ file, reason: "private_payload" }));

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
        if (!relative.toLowerCase().endsWith(".json")) return;
        const bytes = yield* fs
          .readFile(absolute)
          .pipe(Effect.mapError(() => fail(relative, "unreadable_artifact")));
        const input = yield* Effect.try(() => textDecoder.decode(bytes)).pipe(
          Effect.flatMap(decodeArtifactJson),
          Effect.mapError(() => fail(relative, "invalid_json")),
        );
        if (/claude/iu.test(relative) || hasClaudeIdentity(input)) {
          yield* validateClaudePublicArtifact(input, relative);
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
  });

const services = Layer.merge(BunFileSystem.layer, BunPath.layer);

/** Runs before Vite reads JSON imports, emits ?url assets, or copies public/. */
export const evalPublicArtifactsPlugin = (appRoot?: string): Plugin => ({
  name: "check-eval-public-artifacts",
  configResolved: () =>
    Effect.runPromise(checkEvalPublicArtifacts(appRoot).pipe(Effect.provide(services))),
});

if (import.meta.main) {
  BunRuntime.runMain(checkEvalPublicArtifacts().pipe(Effect.provide(services)));
}
