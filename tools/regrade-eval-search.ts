#!/usr/bin/env bun
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunPath from "@effect/platform-bun/BunPath";
import { createHash } from "node:crypto";
import { Effect, FileSystem, Layer, Schema } from "effect";
import { originalCanonicalRuns } from "../apps/evals/src/canonical/canonical";
import {
  type GradingRevisionEntry,
  SEARCH_GRADING_POLICY,
} from "../apps/evals/src/lib/grading-revisions";
import {
  isPublicTranscript,
  publicTranscriptPath,
} from "../apps/evals/src/lib/public-transcript-schema";
import { gradeBoundedSearchCalls } from "../packages/evals/src/bounded-search";
import type { PluginEvalToolCall } from "../packages/evals/src/contracts";
import { loadPluginEvalSuite } from "../packages/evals/src/load-suite";

const root = new URL("../", import.meta.url).pathname;
const receiptPath = "apps/evals/src/results/2026-09-21/regrade/receipt.json";
const suitePath = "plugins/ask-gina/evals/model/v1/families/predictions.yaml";
const sourcePaths = [
  "apps/evals/src/results/2026-09-16/reasoning-sweep/ask-gina-reasoning-sweep.json",
  "apps/evals/src/results/2026-09-16/reasoning-sweep/ask-gina-reasoning-sweep-claude.json",
  "apps/evals/src/results/2026-09-21/recovery/results.json",
  "apps/evals/public/transcripts/index.json",
  "packages/evals/src/bounded-search.ts",
  "packages/evals/src/grading.ts",
  "apps/evals/src/canonical/canonical.ts",
  "apps/evals/src/lib/grading-revisions.ts",
  suitePath,
  "tools/regrade-eval-search.ts",
];
const campaigns = new Set(["reasoning-sweep-2026-09-16", "recovery-2026-09-21"]);
const ignored = new Set(["read", "read_skill", "read_file", "skill", "mcp_list_tools", "grep"]);
const aliases: Readonly<Record<string, string>> = {
  mcp__ai_sdk_harness_tools_predictions_searchpredictionmarkets:
    "predictions.searchPredictionMarkets",
  mcp__gina__predictions_searchPredictionMarkets: "predictions.searchPredictionMarkets",
};
const json = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const object = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json));
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const main = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const inputs = [];
  for (const path of sourcePaths)
    inputs.push({ path, sha256: hash(yield* fs.readFile(root + path)) });
  const suite = yield* loadPluginEvalSuite(root + suitePath);
  const cases = new Map(suite.cases.map((evalCase) => [evalCase.id, evalCase]));
  const entries: GradingRevisionEntry[] = [];
  const reviewed: {
    runId: string;
    caseId: string;
    repetition: number;
    transcriptSha256: string;
  }[] = [];
  const transcriptIndex = yield* Schema.decodeUnknownEffect(
    Schema.Struct({
      files: Schema.Array(
        Schema.Struct({ path: Schema.String, sha256: Schema.String, bytes: Schema.Finite }),
      ),
    }),
  )(json(yield* fs.readFileString(root + "apps/evals/public/transcripts/index.json")));
  const transcriptFiles = new Map(transcriptIndex.files.map((file) => [file.path, file]));
  for (const run of originalCanonicalRuns) {
    if (
      !campaigns.has(run.campaignId) ||
      run.family !== "Predictions" ||
      run.attempts.availability !== "available"
    )
      continue;
    for (const attempt of run.attempts.value) {
      const evalCase = cases.get(attempt.caseId);
      if (attempt.execution !== "completed" || evalCase?.expected.routing.kind !== "bounded_search")
        continue;
      if (attempt.checks.availability !== "available" || attempt.conversation === undefined)
        throw new Error("Missing original grading evidence");
      const path = publicTranscriptPath(attempt.conversation);
      if (path === undefined || path.length === 0) throw new Error("Missing transcript binding");
      const bytes = yield* fs.readFile(root + "apps/evals/public/transcripts/" + path);
      const transcriptSha256 = hash(bytes);
      const indexed = transcriptFiles.get(path);
      if (transcriptSha256 !== indexed?.sha256 || bytes.length !== indexed.bytes)
        throw new Error("Transcript digest mismatch");
      const document = json(new TextDecoder().decode(bytes));
      if (
        !isPublicTranscript(document) ||
        !document.conversation.completeness.transcriptCaptureComplete ||
        document.reference.sourceSummarySha256 !== attempt.conversation.sourceSummarySha256 ||
        publicTranscriptPath(document.reference) !== path
      )
        throw new Error("Incomplete or mismatched transcript");
      const calls: Pick<PluginEvalToolCall, "name" | "arguments">[] = [];
      for (const message of document.conversation.visibleMessages) {
        for (const block of message.content) {
          if (block.type !== "toolCall") continue;
          if (typeof block.name !== "string") throw new Error("Missing tool name");
          if (ignored.has(block.name)) continue;
          let name = block.name;
          let args = object(
            typeof block.arguments === "string" ? json(block.arguments) : block.arguments,
          );
          if (name === "mcp_call_tool") {
            if (args["server_name"] !== "gina" || typeof args["tool_name"] !== "string")
              throw new Error("Unknown MCP wrapper");
            name = args["tool_name"];
            args = object(args["arguments"]);
          }
          calls.push({ name: aliases[name] ?? name, arguments: args });
        }
      }
      reviewed.push({
        runId: run.runId,
        caseId: attempt.caseId,
        repetition: attempt.repetition,
        transcriptSha256,
      });
      const original = attempt.checks.value;
      // Audited native terminal 06f55a... contains only a provider configuration
      // error as its final answer. Keep the original source immutable; the public
      // projection omitted that error text. This is classification, not a pass.
      const providerError =
        attempt.conversation.sourceSummarySha256 ===
        "06f55ad41d38b8212f3d53ff2e385d06cc6cf3f7476f93e57e29224a77c7628f";
      if (
        providerError &&
        (calls.length > 0 ||
          run.runId !== "recovery-astra-xhigh-predictions-1" ||
          attempt.repetition !== 2 ||
          attempt.caseId !== "predictions-multi-series-no-render")
      )
        throw new Error("Provider-error binding mismatch");
      const routing =
        gradeBoundedSearchCalls(
          calls,
          evalCase.expected.routing.tool,
          evalCase.expected.routing.max_calls,
        ).score === 1
          ? "pass"
          : "fail";
      // Existing argument grading requires the original user query in the first
      // search. Independently verify that before changing any routing outcome.
      if (
        routing === "pass" &&
        original.arguments === "pass" &&
        calls[0]?.arguments["query"] !== evalCase.expected.arguments?.required?.["query"]
      )
        throw new Error("First query does not match the recorded argument pass");
      const verdict = providerError
        ? "not_graded"
        : Object.values({ ...original, routing }).some((check) => check === "fail")
          ? "fail"
          : "pass";
      if (!providerError && routing === original.routing && verdict === attempt.verdict) continue;
      entries.push({
        runId: run.runId,
        caseId: attempt.caseId,
        repetition: attempt.repetition,
        sourceSummarySha256: attempt.conversation.sourceSummarySha256,
        transcriptSha256,
        kind: providerError ? "provider_error" : "bounded_search",
        previousRouting: original.routing,
        routing: providerError ? "not_evaluated" : routing,
        previousVerdict: attempt.verdict,
        verdict,
        excludedCostUsd: providerError ? 0.019886 : 0,
      });
    }
  }
  const receipt = {
    schemaVersion: "ask-gina-search-regrade.v1",
    policyId: SEARCH_GRADING_POLICY,
    inputs,
    reviewedAttempts: reviewed.length,
    reviewed,
    entries,
  };
  const encoded =
    (yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown, { space: 2 }))(receipt)) +
    "\n";
  if (Bun.argv.includes("--check")) {
    if ((yield* fs.readFileString(root + receiptPath)) !== encoded)
      throw new Error("Regrade receipt is stale");
  } else yield* fs.writeFileString(root + receiptPath, encoded);
  yield* Effect.logInfo(
    `Reviewed ${reviewed.length} attempts; ${entries.filter((entry) => entry.kind === "bounded_search").length} routing changes; ${entries.filter((entry) => entry.kind === "provider_error").length} execution corrections.`,
  );
});

BunRuntime.runMain(
  Effect.scoped(
    Effect.gen(function* () {
      const context = yield* Layer.build(Layer.merge(BunFileSystem.layer, BunPath.layer));
      return yield* main.pipe(Effect.provide(context));
    }),
  ),
);
