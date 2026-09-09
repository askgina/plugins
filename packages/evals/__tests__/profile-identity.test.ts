import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { listCatalogToolNames } from "@askgina/contracts";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";

import {
  LiveEvalRequestedRoutingEvidenceSchema,
  LiveEvalSelectionError,
  loadPluginEvalSuite,
  makeLiveEvalRequestedRoutingEvidence,
  runLiveEvalSuite,
  sha256Hex,
  writeLiveEvalRequestedRoutingEvidence,
  type LiveEvalTrialInput,
} from "../src/index";

const TestPlatformLayer = Layer.merge(BunFileSystem.layer, BunPath.layer);

const openRouterRouting = (endpoint: string) => ({
  kind: "openrouter-endpoint" as const,
  endpoint,
  allow_fallbacks: false as const,
  require_parameters: true as const,
});

const completedTrial = (input: LiveEvalTrialInput) =>
  Effect.succeed({
    version: 1 as const,
    run_id: input.runId,
    case_id: input.evalCase.id,
    target: input.target,
    model: input.model,
    repetition: input.repetition,
    started_at: input.startedAt,
    status: "completed" as const,
    duration_ms: 1,
    tool_calls: [
      {
        sequence: 0,
        name: "gina.listScheduledPrompts",
        arguments: {},
        result_bytes: 0,
        requested_scope: "tools:read",
      },
    ],
    available_tools: listCatalogToolNames(),
  });

describe("requested routing evidence", () => {
  it.layer(TestPlatformLayer)((it) => {
    it.effect("keeps v1 reports free of routing while persisting distinct endpoint evidence", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const fs = yield* FileSystem.FileSystem;
        const suite = yield* loadPluginEvalSuite(
          path.join(process.cwd(), "packages/evals/src/fixtures/ask-gina-routing-smoke.yaml"),
        );
        const evalCase = suite.cases[0];
        if (evalCase === undefined) return yield* Effect.die("missing fixture case");

        const openai = yield* runLiveEvalSuite(
          {
            suite,
            caseIds: [evalCase.id],
            runId: "routing-openai",
            candidate: "test-candidate",
            target: "openrouter_api",
            model: "openai/gpt-5.6-sol",
            reasoning: "medium",
            repetitions: 3,
            accountClass: "synthetic",
            requestedRouting: openRouterRouting("openai"),
          },
          completedTrial,
        );
        const flex = yield* runLiveEvalSuite(
          {
            suite,
            caseIds: [evalCase.id],
            runId: "routing-flex",
            candidate: "test-candidate",
            target: "openrouter_api",
            model: "openai/gpt-5.6-sol",
            reasoning: "medium",
            repetitions: 3,
            accountClass: "synthetic",
            requestedRouting: openRouterRouting("openai/flex"),
          },
          completedTrial,
        );

        assert.notProperty(openai.report, "requested_routing");
        assert.notProperty(openai.report, "requestedRouting");
        assert.strictEqual(openai.report.schemaVersion, "v1");
        assert.strictEqual(openai.report.model, "openai/gpt-5.6-sol");
        assert.strictEqual(openai.requestedRouting?.endpoint, "openai");
        assert.strictEqual(flex.requestedRouting?.endpoint, "openai/flex");

        const missing = yield* Effect.result(
          runLiveEvalSuite(
            {
              suite,
              caseIds: [evalCase.id],
              runId: "routing-missing",
              candidate: "test-candidate",
              target: "openrouter_api",
              model: "openai/gpt-5.6-sol",
              reasoning: "medium",
              repetitions: 3,
              accountClass: "synthetic",
            },
            () => Effect.die("trial should not run"),
          ),
        );
        assert.strictEqual(missing._tag, "Failure");
        if (missing._tag === "Failure") {
          assert.instanceOf(missing.failure, LiveEvalSelectionError);
          assert.strictEqual(missing.failure.reason, "missing-requested-routing");
        }

        const invalidRequestedRoutings: ReadonlyArray<readonly [string, unknown]> = [
          ["allows fallbacks", { ...openRouterRouting("openai"), allow_fallbacks: true }],
          ["uses the wrong kind", { ...openRouterRouting("openai"), kind: "openrouter-model" }],
          ["matches the model", openRouterRouting("openai/gpt-5.6-sol")],
          ["matches the model basename", openRouterRouting("gpt-5.6-sol")],
          ["uses a malformed slug", openRouterRouting("openai//flex")],
        ];
        for (const [name, requestedRouting] of invalidRequestedRoutings) {
          let trialInvocations = 0;
          const invalid = yield* Effect.result(
            runLiveEvalSuite(
              {
                suite,
                caseIds: [evalCase.id],
                runId: `routing-invalid-${name}`,
                candidate: "test-candidate",
                target: "openrouter_api",
                model: "openai/gpt-5.6-sol",
                reasoning: "medium",
                repetitions: 3,
                accountClass: "synthetic",
                requestedRouting,
              },
              () => {
                trialInvocations += 1;
                return Effect.die(`trial should not run for ${name}`);
              },
            ),
          );
          assert.strictEqual(invalid._tag, "Failure", name);
          if (invalid._tag === "Failure") {
            assert.instanceOf(invalid.failure, LiveEvalSelectionError, name);
            assert.strictEqual(invalid.failure.reason, "invalid-requested-routing", name);
          }
          assert.strictEqual(trialInvocations, 0, name);
        }

        const directory = yield* fs.makeTempDirectory(undefined);
        const openaiReportPath = path.join(directory, "openai.json");
        const flexReportPath = path.join(directory, "flex.json");
        const openaiEvidencePath = path.join(directory, "openai.requested-routing-v1.json");
        const flexEvidencePath = path.join(directory, "flex.requested-routing-v1.json");
        const encodeReport = Schema.encodeEffect(
          Schema.fromJsonString(Schema.Unknown, { space: 0 }),
        );
        const openaiContent = `${yield* encodeReport(openai.report)}\n`;
        const flexContent = `${yield* encodeReport(flex.report)}\n`;
        yield* writeLiveEvalRequestedRoutingEvidence({
          outputPath: openaiEvidencePath,
          reportPath: openaiReportPath,
          reportContent: openaiContent,
          evidence: makeLiveEvalRequestedRoutingEvidence({
            reportContent: openaiContent,
            requestedRouting: openRouterRouting("openai"),
          }),
        });
        yield* writeLiveEvalRequestedRoutingEvidence({
          outputPath: flexEvidencePath,
          reportPath: flexReportPath,
          reportContent: flexContent,
          evidence: makeLiveEvalRequestedRoutingEvidence({
            reportContent: flexContent,
            requestedRouting: openRouterRouting("openai/flex"),
          }),
        });
        const decodeEvidence = Schema.decodeEffect(
          Schema.fromJsonString(LiveEvalRequestedRoutingEvidenceSchema),
        );
        const openaiEvidence = yield* decodeEvidence(yield* fs.readFileString(openaiEvidencePath));
        const flexEvidence = yield* decodeEvidence(yield* fs.readFileString(flexEvidencePath));
        assert.strictEqual(openaiEvidence.requested_routing.endpoint, "openai");
        assert.strictEqual(flexEvidence.requested_routing.endpoint, "openai/flex");
        assert.strictEqual(openaiEvidence.sourceReportSha256, sha256Hex(openaiContent));
        assert.notStrictEqual(openaiEvidence.sourceReportSha256, flexEvidence.sourceReportSha256);
      }),
    );
  });
});
