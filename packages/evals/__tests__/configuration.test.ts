import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";

import {
  LiveEvalConfigurationCaptureError,
  LiveEvalConfigurationEvidenceSchema,
  captureOpenRouterConfiguration,
  makeLiveEvalConfigurationEvidence,
  writeLiveEvalConfigurationEvidence,
  type LiveEvalConfigurationCaptureType,
} from "../src/configuration";
import { sha256Hex, type LiveEvalRequestedRouting } from "../src/profile-identity";
import type { SanitizedEvalRunReport } from "../src/report";
import aggregateFixture from "../src/fixtures/sanitized-aggregate.json";
import { SanitizedEvalAggregateSchema } from "../src/sanitize";
const aggregate = Schema.decodeUnknownSync(SanitizedEvalAggregateSchema)(aggregateFixture);

const TestPlatformLayer = Layer.merge(BunFileSystem.layer, BunPath.layer);
const decodeEvidence = Schema.decodeEffect(
  Schema.fromJsonString(LiveEvalConfigurationEvidenceSchema),
);
const decodeUnknownEvidence = Schema.decodeUnknownEffect(LiveEvalConfigurationEvidenceSchema, {
  errors: "all",
  onExcessProperty: "error",
});
const reportBytes = (value: SanitizedEvalRunReport): string => `${JSON.stringify(value)}\n`;

const digest = (label: string): string => label.repeat(64).slice(0, 64);

const routing = (endpoint: string): LiveEvalRequestedRouting => ({
  kind: "openrouter-endpoint",
  endpoint,
  allow_fallbacks: false,
  require_parameters: true,
});

const capture: LiveEvalConfigurationCaptureType = {
  evaluatorSha256: digest("a"),
  skillsSha256: digest("b"),
  toolchainSha256: digest("c"),
  runtime: {
    bun: { version: "1.4.0", executableSha256: digest("d") },
    lockSha256: digest("e"),
    packages: [
      {
        name: "ai",
        version: "7.0.93",
        metadataSha256: digest("1"),
        sourceSha256: digest("2"),
        sourceScope: "entrypoint",
      },
      {
        name: "@openrouter/ai-sdk-provider",
        version: "3.0.0",
        metadataSha256: digest("3"),
        sourceSha256: digest("4"),
        sourceScope: "entrypoint",
      },
      {
        name: "@ai-sdk/mcp",
        version: "2.0.45",
        metadataSha256: digest("5"),
        sourceSha256: digest("6"),
        sourceScope: "entrypoint",
      },
    ],
  },
};

const report = (overrides: Partial<SanitizedEvalRunReport> = {}): SanitizedEvalRunReport => ({
  schemaVersion: "v1",
  runId: "run-1",
  candidate: "cand-1",
  target: "openrouter_api",
  model: "openai/gpt-5.6-sol",
  reasoning: "medium",
  repetitions: 3,
  startedAt: "2026-09-09T00:00:00.000Z",
  cleanChat: true,
  accountClass: "local",
  aggregate,
  ...overrides,
});

const evidenceFor = (
  overrides: {
    readonly report?: SanitizedEvalRunReport;
    readonly reportContent?: string;
    readonly requestedRouting?: LiveEvalRequestedRouting;
    readonly maxSteps?: number;
    readonly timeoutMs?: number;
    readonly maxToolCalls?: number;
    readonly capture?: LiveEvalConfigurationCaptureType;
  } = {},
) =>
  makeLiveEvalConfigurationEvidence({
    report: overrides.report ?? report(),
    reportContent: overrides.reportContent ?? "{}\n",
    requestedRouting: overrides.requestedRouting ?? routing("openai"),
    maxSteps: overrides.maxSteps ?? 8,
    timeoutMs: overrides.timeoutMs ?? 120_000,
    capture: overrides.capture ?? capture,
    ...(overrides.maxToolCalls === undefined ? {} : { maxToolCalls: overrides.maxToolCalls }),
  });

describe("configuration-v1 evidence", () => {
  it.effect("keeps a run-id-independent digest and records unknown observations", () =>
    Effect.sync(() => {
      const first = evidenceFor({
        report: report({ runId: "run-a" }),
        reportContent: "run-a\n",
      });
      const second = evidenceFor({
        report: report({ runId: "run-b" }),
        reportContent: "run-b\n",
      });
      assert.strictEqual(first.configurationSha256, second.configurationSha256);
      assert.notStrictEqual(first.sourceReportSha256, second.sourceReportSha256);
      assert.strictEqual(first.sourceReportSha256, sha256Hex("run-a\n"));
      assert.strictEqual(second.sourceReportSha256, sha256Hex("run-b\n"));
      assert.strictEqual(first.observed.model.availability, "unknown");
      assert.strictEqual(first.observed.endpoint.availability, "unknown");
      assert.strictEqual(first.observed.reasoning.availability, "unknown");
      assert.strictEqual(first.observed.effectiveSettings.availability, "unknown");
      assert.strictEqual(first.budgets.taskToolCalls, null);
      assert.strictEqual(first.requested.generationSteps, 8);
      assert.strictEqual(first.budgets.generationSteps, 8);
      assert.strictEqual(first.authentication.class, "openrouter-api-key");
      assert.deepStrictEqual(first.requested.injections, {
        usageInclude: true,
        maxRetries: 0,
      });
      assert.strictEqual(first.runtime.packages[0].sourceScope, "entrypoint");
      assert.strictEqual(first.schemaVersion, "configuration-v1");
      assert.strictEqual(
        evidenceFor({
          report: report({ runId: "run-a", startedAt: "2026-09-09T12:00:00.000Z" }),
          reportContent: "run-a\n",
        }).configurationSha256,
        first.configurationSha256,
      );
      const otherAccount = evidenceFor({
        report: report({ runId: "run-a", accountClass: "other" }),
        reportContent: "run-a\n",
      });
      assert.strictEqual(otherAccount.authentication.class, "openrouter-api-key");
      assert.notStrictEqual(otherAccount.configurationSha256, first.configurationSha256);
    }),
  );

  it.effect("is stable under requested object key order and changes with material inputs", () =>
    Effect.sync(() => {
      const ordered = evidenceFor({
        requestedRouting: {
          kind: "openrouter-endpoint",
          endpoint: "openai",
          allow_fallbacks: false,
          require_parameters: true,
        },
      });
      const reordered = evidenceFor({
        requestedRouting: {
          require_parameters: true,
          allow_fallbacks: false,
          endpoint: "openai",
          kind: "openrouter-endpoint",
        },
      });
      assert.strictEqual(ordered.configurationSha256, reordered.configurationSha256);
      assert.notStrictEqual(
        evidenceFor({ requestedRouting: routing("openai/flex") }).configurationSha256,
        ordered.configurationSha256,
      );
      assert.notStrictEqual(
        evidenceFor({ report: report({ model: "google/gemini-3.8-flash" }) }).configurationSha256,
        ordered.configurationSha256,
      );
      assert.notStrictEqual(
        evidenceFor({ maxSteps: 4 }).configurationSha256,
        ordered.configurationSha256,
      );
      assert.notStrictEqual(
        evidenceFor({ timeoutMs: 60_000 }).configurationSha256,
        ordered.configurationSha256,
      );
      const withToolBudget = evidenceFor({ maxToolCalls: 8 });
      assert.strictEqual(withToolBudget.budgets.taskToolCalls, 8);
      assert.strictEqual(withToolBudget.requested.generationSteps, 8);
      assert.notStrictEqual(withToolBudget.configurationSha256, ordered.configurationSha256);
      const splitBudgets = evidenceFor({ maxSteps: 4, maxToolCalls: 8 });
      assert.strictEqual(splitBudgets.requested.generationSteps, 4);
      assert.strictEqual(splitBudgets.budgets.generationSteps, 4);
      assert.strictEqual(splitBudgets.budgets.taskToolCalls, 8);
      assert.notStrictEqual(splitBudgets.configurationSha256, withToolBudget.configurationSha256);
    }),
  );

  it.effect("rejects malformed requested routing", () =>
    Effect.gen(function* () {
      const evidence = evidenceFor();
      const invalid = yield* Effect.result(
        decodeUnknownEvidence({
          ...evidence,
          requested: {
            ...evidence.requested,
            routing: {
              kind: "openrouter-endpoint",
              endpoint: "openai",
              allow_fallbacks: true,
              require_parameters: true,
            },
          },
        }),
      );
      assert.strictEqual(invalid._tag, "Failure");
    }),
  );

  it.layer(TestPlatformLayer)((it) => {
    it.effect("writes exclusive mode-0600 evidence bound to exact report bytes", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "configuration-write-" });
        const reportPath = path.join(directory, "openrouter_api-cand-run.json");
        const outputPath = path.join(directory, "openrouter_api-cand-run.configuration-v1.json");
        const fixtureReport = report();
        const reportContent = reportBytes(fixtureReport);
        const evidence = evidenceFor({ report: fixtureReport, reportContent });
        yield* writeLiveEvalConfigurationEvidence({
          outputPath,
          reportPath,
          reportContent,
          evidence,
        });
        const saved = yield* fs.readFileString(outputPath);
        const metadata = yield* fs.stat(outputPath);
        const parsed = yield* decodeEvidence(saved);
        assert.strictEqual(metadata.mode & 0o777, 0o600);
        assert.strictEqual(saved.at(-1), "\n");
        assert.strictEqual(parsed.configurationSha256, evidence.configurationSha256);
        assert.strictEqual(parsed.sourceReportSha256, evidence.sourceReportSha256);
      }),
    );

    it.effect("rejects existing output, path collision, and tampered digests", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "configuration-conflict-" });
        const reportPath = path.join(directory, "report.json");
        const outputPath = path.join(directory, "report.configuration-v1.json");
        const fixtureReport = report();
        const reportContent = reportBytes(fixtureReport);
        const evidence = evidenceFor({ report: fixtureReport, reportContent });
        yield* fs.writeFileString(outputPath, "occupied\n", { flag: "wx", mode: 0o600 });
        const exists = yield* Effect.result(
          writeLiveEvalConfigurationEvidence({ outputPath, reportPath, reportContent, evidence }),
        );
        assert.strictEqual(exists._tag, "Failure");
        if (exists._tag === "Failure") {
          assert.instanceOf(exists.failure, LiveEvalConfigurationCaptureError);
          assert.strictEqual(exists.failure.reason, "output-exists");
        }
        assert.strictEqual(yield* fs.readFileString(outputPath), "occupied\n");

        const collision = yield* Effect.result(
          writeLiveEvalConfigurationEvidence({
            outputPath: reportPath,
            reportPath,
            reportContent,
            evidence,
          }),
        );
        assert.strictEqual(collision._tag, "Failure");
        if (collision._tag === "Failure") {
          assert.strictEqual(collision.failure.reason, "output-conflict");
        }

        const tampered = yield* Effect.result(
          writeLiveEvalConfigurationEvidence({
            outputPath: path.join(directory, "tampered.configuration-v1.json"),
            reportPath,
            reportContent,
            evidence: { ...evidence, configurationSha256: digest("f") },
          }),
        );
        assert.strictEqual(tampered._tag, "Failure");
        if (tampered._tag === "Failure") {
          assert.strictEqual(tampered.failure.reason, "output-conflict");
        }
      }),
    );

    it.effect("rejects a different report bound after recomputing the source hash", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "configuration-mismatch-" });
        const reportPath = path.join(directory, "report.json");
        const outputPath = path.join(directory, "report.configuration-v1.json");
        const claimed = report();
        const bound = report({ model: "google/gemini-3.8-flash" });
        const reportContent = reportBytes(bound);
        const evidence = evidenceFor({ report: claimed, reportContent });
        assert.strictEqual(evidence.model, claimed.model);
        assert.strictEqual(evidence.sourceReportSha256, sha256Hex(reportContent));
        const result = yield* Effect.result(
          writeLiveEvalConfigurationEvidence({ outputPath, reportPath, reportContent, evidence }),
        );
        assert.strictEqual(result._tag, "Failure");
        if (result._tag === "Failure") {
          assert.instanceOf(result.failure, LiveEvalConfigurationCaptureError);
          assert.strictEqual(result.failure.reason, "output-conflict");
        }
        assert.isFalse(yield* fs.exists(outputPath));
      }),
    );

    it.effect("rejects non-Bun capture before filesystem work", () =>
      Effect.gen(function* () {
        const result = yield* Effect.result(
          captureOpenRouterConfiguration({
            evaluatorEntrypointUrl: import.meta.url,
          }),
        );
        assert.strictEqual(result._tag, "Failure");
        if (result._tag === "Failure") {
          assert.instanceOf(result.failure, LiveEvalConfigurationCaptureError);
          assert.strictEqual(result.failure.reason, "invalid-input");
        }
      }),
    );
  });
});
