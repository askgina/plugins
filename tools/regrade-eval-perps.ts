#!/usr/bin/env bun
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunPath from "@effect/platform-bun/BunPath";
import { createHash } from "node:crypto";
import { Effect, FileSystem, Layer, Schema } from "effect";
import { originalCanonicalRuns } from "../apps/evals/src/canonical/canonical";
import {
  type GradingRevisionEntry,
  PERPS_GRADING_POLICY,
} from "../apps/evals/src/lib/grading-revisions";
import {
  isPublicTranscript,
  publicTranscriptPath,
} from "../apps/evals/src/lib/public-transcript-schema";
import {
  checkPriceAnswer,
  gradePerpsPriceCalls,
  type PriceCall,
  MARKETS,
  PRICE,
  PRICES,
  ASSET,
} from "../packages/evals/src/perps-price";
import { loadPluginEvalSuite } from "../packages/evals/src/load-suite";

const root = new URL("../", import.meta.url).pathname;
const outputPath = "apps/evals/src/results/2026-09-21/regrade/perps-receipt.json";
const suitePath = "plugins/ask-gina/evals/model/v1/families/perps.yaml";
const sourcePaths = [
  "apps/evals/src/results/2026-09-16/reasoning-sweep/ask-gina-reasoning-sweep.json",
  "apps/evals/src/results/2026-09-16/reasoning-sweep/ask-gina-reasoning-sweep-claude.json",
  "apps/evals/src/results/2026-09-21/recovery/results.json",
  "apps/evals/public/transcripts/index.json",
  "packages/evals/src/perps-price.ts",
  "packages/evals/src/price-claims.ts",
  "packages/evals/src/grading.ts",
  "apps/evals/src/canonical/canonical.ts",
  "apps/evals/src/lib/grading-revisions.ts",
  suitePath,
  "tools/regrade-eval-perps.ts",
];
const json = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const object = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown));
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
// This receipt audits retained historical transcripts. Later campaigns apply
// the price policy during execution and publish their own evidence.
const campaigns = new Set([
  "omp-2026-09-11",
  "muse-2026-09-14",
  "claude-2026-09-14",
  "reasoning-sweep-2026-09-16",
  "recovery-2026-09-21",
]);
const hostTools = new Set([
  "read",
  "read_skill",
  "read_file",
  "skill",
  "mcp_list_tools",
  "grep",
  "exec",
  "find_file_by_name",
]);
function canonicalName(name: string) {
  for (const canonical of [MARKETS, PRICE, PRICES, ASSET]) {
    if (
      name === canonical ||
      name.toLowerCase() ===
        "mcp__ai_sdk_harness_tools_" + canonical.replace(".", "_").toLowerCase() ||
      name.toLowerCase() === "mcp__gina__" + canonical.replace(".", "_").toLowerCase()
    )
      return canonical;
  }
  return name;
}

const main = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const inputs = [];
  for (const path of sourcePaths)
    inputs.push({ path, sha256: hash(yield* fs.readFile(root + path)) });
  const suite = yield* loadPluginEvalSuite(root + suitePath);
  const cases = new Map(suite.cases.map((c) => [c.id, c]));
  const index = yield* Schema.decodeUnknownEffect(
    Schema.Struct({
      files: Schema.Array(
        Schema.Struct({ path: Schema.String, sha256: Schema.String, bytes: Schema.Finite }),
      ),
    }),
  )(json(yield* fs.readFileString(root + "apps/evals/public/transcripts/index.json")));
  const indexed = new Map(index.files.map((f) => [f.path, f]));
  const entries: GradingRevisionEntry[] = [];
  const skipped: { runId: string; caseId: string; repetition: number; reason: string }[] = [];
  for (const run of originalCanonicalRuns) {
    if (
      !campaigns.has(run.campaignId) ||
      run.family !== "Perps" ||
      run.attempts.availability !== "available"
    )
      continue;
    for (const attempt of run.attempts.value) {
      const evalCase = cases.get(attempt.caseId);
      if (evalCase?.expected.routing.kind !== "perps_price") continue;
      const skip = (reason: string) =>
        skipped.push({
          runId: run.runId,
          caseId: attempt.caseId,
          repetition: attempt.repetition,
          reason,
        });
      if (attempt.execution !== "completed") {
        skip("execution_incomplete");
        continue;
      }
      const path =
        attempt.conversation === undefined ? undefined : publicTranscriptPath(attempt.conversation);
      if (path === undefined || path.length === 0 || attempt.checks.availability !== "available") {
        skip("retained_evidence_unavailable");
        continue;
      }
      const bytes = yield* fs.readFile(root + "apps/evals/public/transcripts/" + path);
      const transcriptSha256 = hash(bytes);
      const file = indexed.get(path);
      if (transcriptSha256 !== file?.sha256 || bytes.length !== file.bytes)
        throw new Error("Transcript digest mismatch");
      const document = json(new TextDecoder().decode(bytes));
      if (
        !isPublicTranscript(document) ||
        document.reference.sourceSummarySha256 !== attempt.conversation?.sourceSummarySha256 ||
        publicTranscriptPath(document.reference) !== path
      )
        throw new Error("Transcript binding mismatch");
      if (!document.conversation.completeness.transcriptCaptureComplete) {
        skip("capture_incomplete");
        continue;
      }
      if (
        document.conversation.frozenUserTurns.map((t) => t.content).join("\n\n") !==
        evalCase.turns
          .filter((t) => t.role === "user")
          .map((t) => t.content)
          .join("\n\n")
      ) {
        skip("different_task_prompt");
        continue;
      }
      const calls: (PriceCall & { id: string })[] = [];
      const results = new Map<string, { value: unknown; sequence: number }>();
      let answer = "";
      let answerSequence = -1;
      for (const message of document.conversation.visibleMessages) {
        const text: string[] = [];
        for (const block of message.content) {
          if (
            block.type === "text" &&
            message.role === "assistant" &&
            typeof block.text === "string"
          )
            text.push(block.text);
          if (block.type === "toolResult" && typeof block.toolCallId === "string") {
            if (results.has(block.toolCallId)) throw new Error("Duplicate tool-result identity");
            results.set(block.toolCallId, {
              value: block.isError === true ? { isError: true } : block.text,
              sequence: message.sequence,
            });
          }
          if (block.type !== "toolCall") continue;
          if (typeof block.name !== "string") throw new Error("Missing tool name");
          if (hostTools.has(block.name)) continue;
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
          const callId = block.call_id ?? block.id;
          if (typeof callId !== "string" || calls.some((c) => c.id === callId))
            throw new Error("Invalid tool-call identity");
          calls.push({ name: canonicalName(name), arguments: args, id: callId });
        }
        if (text.length > 0) {
          answer = text.join("\n");
          answerSequence = message.sequence;
        }
      }
      const evidenceCalls = calls.map((c) => {
        const result = results.get(c.id);
        return {
          ...c,
          result:
            result !== undefined && result.sequence < answerSequence ? result.value : undefined,
        };
      });
      const graded = gradePerpsPriceCalls(evidenceCalls, evalCase.expected.routing.mode);
      const grounding = checkPriceAnswer(evidenceCalls, evalCase.expected.routing.mode, answer);
      const original = attempt.checks.value;
      const routing = graded.routing.score === 1 ? "pass" : "fail";
      const argumentsOutcome = graded.arguments.score === 1 ? "pass" : "fail";
      const verdict =
        grounding.score === 1 &&
        !Object.values({ ...original, routing, arguments: argumentsOutcome }).includes("fail")
          ? "pass"
          : "fail";
      entries.push({
        runId: run.runId,
        caseId: attempt.caseId,
        repetition: attempt.repetition,
        sourceSummarySha256: document.reference.sourceSummarySha256,
        transcriptSha256,
        kind: "perps_price",
        previousRouting: original.routing,
        routing,
        previousArguments: original.arguments,
        arguments: argumentsOutcome,
        priceGrounding: {
          outcome: grounding.score === 1 ? "pass" : "fail",
          detail: grounding.details.join(" "),
        },
        previousVerdict: attempt.verdict,
        verdict,
        excludedCostUsd: 0,
      });
    }
  }
  const receipt = {
    schemaVersion: "ask-gina-perps-regrade.v1",
    policyId: PERPS_GRADING_POLICY,
    inputs,
    reviewedAttempts: entries.length,
    entries,
    skipped,
  };
  const encoded =
    (yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown, { space: 2 }))(receipt)) +
    "\n";
  if (Bun.argv.includes("--check")) {
    if ((yield* fs.readFileString(root + outputPath)) !== encoded)
      throw new Error("Perps regrade receipt is stale");
  } else yield* fs.writeFileString(root + outputPath, encoded);
  yield* Effect.logInfo(
    `Reviewed ${entries.length}; skipped ${skipped.length}; fail→pass ${entries.filter((e) => e.previousVerdict === "fail" && e.verdict === "pass").length}; pass→fail ${entries.filter((e) => e.previousVerdict === "pass" && e.verdict === "fail").length}.`,
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
