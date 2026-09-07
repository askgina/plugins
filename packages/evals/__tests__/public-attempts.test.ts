import { createHash } from "node:crypto";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";

import {
  PUBLIC_EVAL_DECODE_OPTIONS,
  PublicEvalAttemptCaptureSchema,
  PublicEvalAttemptSummarySchema,
} from "@askgina/contracts";
import type {
  PluginEvalCaseScore,
  PluginEvalObservation,
  PluginEvalObservationSet,
} from "../src/contracts";
import {
  makePublicEvalAttemptCapture,
  makePublicEvalAttemptSummaries,
  PublicEvalAttemptCaptureError,
  PublicEvalAttemptWriteError,
  type PublicEvalGradedAttempt,
  writePublicEvalAttemptCapture,
} from "../src/public-attempts";
import { SanitizedEvalRunReportSchema, type SanitizedEvalRunReport } from "../src/report";

const encodeUnknownJson = Schema.encodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const encodeJsonString = Schema.encodeUnknownEffect(Schema.fromJsonString(Schema.String));
const encodeReportJson = Schema.encodeEffect(Schema.fromJsonString(SanitizedEvalRunReportSchema));
const encodePrettyReportJson = Schema.encodeEffect(
  Schema.fromJsonString(SanitizedEvalRunReportSchema, { space: 2 }),
);
const encodeSummariesJson = Schema.encodeEffect(
  Schema.fromJsonString(Schema.Array(PublicEvalAttemptSummarySchema)),
);
const decodeAttemptCaptureJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(PublicEvalAttemptCaptureSchema),
  PUBLIC_EVAL_DECODE_OPTIONS,
);

const observation = (
  repetition = 1,
  overrides: Partial<PluginEvalObservation> = {},
): PluginEvalObservation => ({
  version: 1,
  run_id: "synthetic-capture-run",
  case_id: "exact-routing",
  target: "fixture",
  model: "synthetic-model",
  repetition,
  started_at: "2026-08-25T00:00:00.000Z",
  status: "completed",
  duration_ms: repetition === 1 ? 5 : 7,
  tool_calls: [],
  ...overrides,
});

const observationSet = (
  observations: readonly PluginEvalObservation[] = [observation(1), observation(2)],
): PluginEvalObservationSet => ({
  version: 1,
  manifest: {
    version: 1,
    run_id: "synthetic-capture-run",
    suite_id: "synthetic-suite",
    suite_version: 1,
    catalog_version: "synthetic-catalog",
    candidate: "synthetic-candidate",
    target: "fixture",
    model: "synthetic-model",
    started_at: "2026-08-25T00:00:00.000Z",
    repetitions: 2,
    clean_chat: true,
    account_class: "synthetic",
    artifact_policy: "sanitized",
  },
  observations,
});

const graded = (
  repetition = 1,
  overrides: Partial<PluginEvalCaseScore> = {},
): PublicEvalGradedAttempt => ({
  runId: "synthetic-capture-run",
  caseId: "exact-routing",
  repetition,
  score: {
    case_id: "exact-routing",
    overall_pass: true,
    routing: { score: 1, details: [] },
    arguments: { score: 1, details: [] },
    completion: { score: 1, details: [] },
    latency_ms: repetition === 1 ? 5 : 7,
    total_result_bytes: 0,
    ...overrides,
  },
});

const report: SanitizedEvalRunReport = {
  schemaVersion: "v1",
  runId: "synthetic-capture-run",
  candidate: "synthetic-candidate",
  target: "fixture",
  model: "synthetic-model",
  repetitions: 2,
  startedAt: "2026-08-25T00:00:00.000Z",
  cleanChat: true,
  accountClass: "synthetic",
  aggregate: {
    schemaVersion: "v1",
    suiteId: "synthetic-suite",
    suiteVersion: 1,
    fixtureVersion: 1,
    catalogSha: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    overall: { passed: 1, total: 2 },
    dimensions: {
      routing: { passed: 1, failed: 1 },
      arguments: { passed: 2, failed: 0 },
      safety: { passed: 0, failed: 0 },
      completion: { passed: 2, failed: 0 },
    },
    skillActivation: { passed: 0, failed: 0 },
    latencyMs: { p50: 5, p95: 7, max: 7 },
    totalResultBytes: { p50: 0, p95: 0, max: 0 },
    tokenUsage: { observations: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    artifactPolicy: "sanitized",
  },
};

const repeatedGrades = [
  graded(1),
  graded(2, { overall_pass: false, routing: { score: 0, details: [] } }),
] as const;

const TestPlatformLayer = Layer.merge(BunFileSystem.layer, BunPath.layer);

describe("public eval attempt summaries", () => {
  it.effect(
    "excludes private observations and grader details from summaries and safe failures",
    () =>
      Effect.gen(function* () {
        const markers = [
          "private-tool-argument-marker",
          "private-final-answer-marker",
          "private-trial-error-marker",
          "private-tool-error-marker",
          "private-grader-detail-marker",
        ] as const;
        const observed = observation(1, {
          status: "failed",
          tool_calls: [
            {
              sequence: 0,
              name: "fixture.lookupLabel",
              arguments: { nested: { raw: markers[0] } },
              error: { message: markers[3] },
            },
          ],
          final_answer: markers[1],
          error: markers[2],
          token_usage: { input_tokens: 3, output_tokens: 4, total_tokens: 9 },
        });
        const failed = { score: 0, details: [markers[4]] } as const;
        const score = graded(1, {
          overall_pass: false,
          routing: failed,
          arguments: failed,
          safety: failed,
          completion: failed,
          skill_activation: failed,
        });
        const summaries = yield* makePublicEvalAttemptSummaries(observationSet([observed]), [
          score,
        ]);
        assert.deepStrictEqual(summaries, [
          {
            // SHA-256 of the literal UTF-8 tuple ["synthetic-capture-run","exact-routing",1].
            id: "attempt-c46e9a2b9ed9765cffb4896c79df276f88dfbcef247cba38e2d44c94d6843a77",
            runId: "synthetic-capture-run",
            caseId: "exact-routing",
            repetition: 1,
            verdict: "fail",
            validity: "valid",
            evidenceAvailability: "available",
            checks: {
              routing: "fail",
              arguments: "fail",
              safety: "fail",
              completion: "fail",
              skillActivation: "fail",
            },
            failureCategories: [
              "routing_mismatch",
              "argument_mismatch",
              "safety_violation",
              "trial_or_tool_failure",
              "skill_activation_mismatch",
            ],
            durationMs: 5,
            tokenUsage: { inputTokens: 3, outputTokens: 4, totalTokens: 9 },
            replacementOf: null,
          },
        ]);

        const rejected = yield* Effect.result(
          makePublicEvalAttemptSummaries(
            observationSet([
              { ...observed, token_usage: { input_tokens: -1, output_tokens: 4, total_tokens: 9 } },
            ]),
            [score],
          ),
        );
        assert.strictEqual(rejected._tag, "Failure");
        if (rejected._tag === "Failure") {
          assert.instanceOf(rejected.failure, PublicEvalAttemptCaptureError);
          const summariesJson = yield* encodeSummariesJson(summaries);
          const failureJson = yield* encodeUnknownJson(rejected.failure);
          for (const marker of markers) {
            assert.notInclude(summariesJson, marker);
            assert.notInclude(failureJson, marker);
            assert.notInclude(String(rejected.failure), marker);
          }
        }
      }),
  );

  it.effect("pairs reordered explicit identities without merging repeated case observations", () =>
    Effect.gen(function* () {
      const summaries = yield* makePublicEvalAttemptSummaries(observationSet(), [
        repeatedGrades[1],
        repeatedGrades[0],
      ]);
      assert.deepStrictEqual(
        [...summaries]
          .sort((left, right) => left.repetition - right.repetition)
          .map((attempt) => ({
            id: attempt.id,
            repetition: attempt.repetition,
            verdict: attempt.verdict,
            durationMs: attempt.durationMs,
            routing: attempt.checks.routing,
            failureCategories: attempt.failureCategories,
            tokenUsage: attempt.tokenUsage,
          })),
        [
          {
            id: "attempt-c46e9a2b9ed9765cffb4896c79df276f88dfbcef247cba38e2d44c94d6843a77",
            repetition: 1,
            verdict: "pass",
            durationMs: 5,
            routing: "pass",
            failureCategories: [],
            tokenUsage: null,
          },
          {
            id: "attempt-e6c8306deade4846f581756a8af33a16938583fe2ac1bf574c2d1198477cc19b",
            repetition: 2,
            verdict: "fail",
            durationMs: 7,
            routing: "fail",
            failureCategories: ["routing_mismatch"],
            tokenUsage: null,
          },
        ],
      );
    }),
  );

  it.effect("uses graded dimensions rather than status or error wording to classify failures", () =>
    Effect.gen(function* () {
      const summaries = yield* makePublicEvalAttemptSummaries(
        observationSet([
          observation(1, { status: "failed", error: "safety violation and routing mismatch" }),
          observation(2, {
            status: "blocked",
            error: "skill activation mismatch and tool failure",
          }),
        ]),
        [
          graded(1),
          graded(2, {
            overall_pass: false,
            arguments: { score: 0, details: ["safety violation"] },
          }),
        ],
      );
      assert.deepStrictEqual(
        summaries.map((attempt) => ({
          verdict: attempt.verdict,
          checks: attempt.checks,
          categories: attempt.failureCategories,
          validity: attempt.validity,
          replacementOf: attempt.replacementOf,
        })),
        [
          {
            verdict: "pass",
            checks: {
              routing: "pass",
              arguments: "pass",
              safety: "not_applicable",
              completion: "pass",
              skillActivation: "not_applicable",
            },
            categories: [],
            validity: "valid",
            replacementOf: null,
          },
          {
            verdict: "fail",
            checks: {
              routing: "pass",
              arguments: "fail",
              safety: "not_applicable",
              completion: "pass",
              skillActivation: "not_applicable",
            },
            categories: ["argument_mismatch"],
            validity: "valid",
            replacementOf: null,
          },
        ],
      );
    }),
  );

  it.effect("rejects incomplete, foreign, out-of-range and duplicate attempt pairings", () =>
    Effect.gen(function* () {
      const invalid = [
        {
          name: "ungraded observation",
          observations: [observation(1), observation(2)],
          grades: [graded(1)],
        },
        { name: "orphan grade", observations: [observation(1)], grades: [graded(1), graded(2)] },
        {
          name: "observation from another run",
          observations: [observation(1, { run_id: "foreign-run" })],
          grades: [{ ...graded(1), runId: "foreign-run" }],
        },
        {
          name: "grade from another run",
          observations: [observation(1)],
          grades: [{ ...graded(1), runId: "foreign-run" }],
        },
        {
          name: "grade from another case",
          observations: [observation(1)],
          grades: [{ ...graded(1, { case_id: "foreign-case" }), caseId: "foreign-case" }],
        },
        {
          name: "score disagrees with its identity",
          observations: [observation(1)],
          grades: [graded(1, { case_id: "foreign-case" })],
        },
        {
          name: "grade for another repetition",
          observations: [observation(1)],
          grades: [{ ...graded(1), repetition: 2 }],
        },
        {
          name: "repetition exceeds manifest",
          observations: [observation(3)],
          grades: [graded(3)],
        },
        {
          name: "duplicate observations",
          observations: [observation(1), observation(1)],
          grades: [graded(1), graded(2)],
        },
        {
          name: "duplicate grades",
          observations: [observation(1), observation(2)],
          grades: [graded(1), graded(1)],
        },
      ];
      for (const row of invalid) {
        const result = yield* Effect.result(
          makePublicEvalAttemptSummaries(observationSet(row.observations), row.grades),
        );
        assert.strictEqual(result._tag, "Failure", row.name);
        if (result._tag === "Failure")
          assert.instanceOf(result.failure, PublicEvalAttemptCaptureError, row.name);
      }
    }),
  );

  it.effect("rejects invalid measurements before they can enter a public capture", () =>
    Effect.gen(function* () {
      const invalid: readonly Partial<PluginEvalObservation>[] = [
        { duration_ms: -1 },
        { duration_ms: 0.5 },
        { duration_ms: Number.POSITIVE_INFINITY },
        { token_usage: { input_tokens: -1, output_tokens: 2, total_tokens: 2 } },
        { token_usage: { input_tokens: 1, output_tokens: 0.5, total_tokens: 2 } },
        { token_usage: { input_tokens: 1, output_tokens: 2, total_tokens: Number.NaN } },
      ];
      for (const measurement of invalid) {
        const observed = observation(1, measurement);
        const result = yield* Effect.result(
          makePublicEvalAttemptSummaries(observationSet([observed]), [
            graded(1, { latency_ms: observed.duration_ms }),
          ]),
        );
        assert.strictEqual(result._tag, "Failure");
        if (result._tag === "Failure")
          assert.instanceOf(result.failure, PublicEvalAttemptCaptureError);
      }
    }),
  );

  it.effect("rejects unsafe identifiers without echoing them in failure output", () =>
    Effect.gen(function* () {
      const unsafeIdentifiers = [
        "../private-case",
        "private-case\nmarker",
        `0x${"a".repeat(40)}`,
        "127.0.0.1",
        ["gh", "p_0123456789abcdefghijklmnopqrstuvwxyz"].join(""),
      ];
      for (const unsafe of unsafeIdentifiers) {
        for (const field of ["run", "case"] as const) {
          const set = observationSet([
            observation(1, field === "run" ? { run_id: unsafe } : { case_id: unsafe }),
          ]);
          const result = yield* Effect.result(
            makePublicEvalAttemptSummaries(
              field === "run" ? { ...set, manifest: { ...set.manifest, run_id: unsafe } } : set,
              [
                field === "run"
                  ? { ...graded(1), runId: unsafe }
                  : { ...graded(1, { case_id: unsafe }), caseId: unsafe },
              ],
            ),
          );
          assert.strictEqual(result._tag, "Failure", `${field} identifier`);
          if (result._tag === "Failure") {
            assert.instanceOf(result.failure, PublicEvalAttemptCaptureError);
            const failureJson = yield* encodeUnknownJson(result.failure);
            const unsafeJson = yield* encodeJsonString(unsafe);
            assert.notInclude(failureJson, unsafeJson.slice(1, -1));
            assert.notInclude(String(result.failure), unsafe);
          }
        }
      }
    }),
  );
});

describe("public eval attempt writer", () => {
  it.layer(TestPlatformLayer)((it) => {
    it.effect(
      "saves a private companion bound to the exact sanitized report bytes and refuses overwrite",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const root = yield* fs.makeTempDirectoryScoped({ prefix: "public-attempts-" });
          const reportPath = path.join(root, "report.json");
          const outputPath = path.join(root, "attempts.json");
          const reportContent = `${yield* encodePrettyReportJson(report)}\n`;
          yield* fs.writeFileString(reportPath, reportContent);
          const attempts = yield* makePublicEvalAttemptSummaries(observationSet(), repeatedGrades);
          const capture = yield* makePublicEvalAttemptCapture({
            runId: report.runId,
            reportContent,
            attempts,
          });
          yield* writePublicEvalAttemptCapture({ outputPath, reportPath, capture });

          const savedReport = yield* fs.readFile(reportPath);
          const savedContent = yield* fs.readFileString(outputPath);
          const saved = yield* decodeAttemptCaptureJson(savedContent);
          const metadata = yield* fs.stat(outputPath);
          assert.strictEqual(metadata.mode & 0o777, 0o600);
          assert.deepStrictEqual(saved, {
            schemaVersion: "eval-attempts.v1",
            runId: "synthetic-capture-run",
            sourceReportSha256: createHash("sha256").update(savedReport).digest("hex"),
            attempts,
          });
          assert.strictEqual(savedReport[savedReport.length - 1], 10);
          assert.notStrictEqual(
            saved.sourceReportSha256,
            createHash("sha256").update(savedReport.subarray(0, -1)).digest("hex"),
          );

          const overwrite = yield* Effect.result(
            writePublicEvalAttemptCapture({ outputPath, reportPath, capture }),
          );
          assert.strictEqual(overwrite._tag, "Failure");
          if (overwrite._tag === "Failure") {
            assert.instanceOf(overwrite.failure, PublicEvalAttemptWriteError);
            if (overwrite.failure instanceof PublicEvalAttemptWriteError)
              assert.strictEqual(overwrite.failure.reason, "output-exists");
          }
          assert.strictEqual(yield* fs.readFileString(outputPath), savedContent);
          assert.strictEqual(yield* fs.readFileString(reportPath), reportContent);
        }),
    );

    it.effect("does not clobber a companion created after preflight", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "public-attempts-exclusive-" });
        const reportPath = path.join(root, "report.json");
        const outputPath = path.join(root, "attempts.json");
        const reportContent = `${yield* encodeReportJson(report)}\n`;
        yield* fs.writeFileString(reportPath, reportContent);
        const attempts = yield* makePublicEvalAttemptSummaries(observationSet(), repeatedGrades);
        const capture = yield* makePublicEvalAttemptCapture({
          runId: report.runId,
          reportContent,
          attempts,
        });
        const existingContent = "another writer owns these bytes\n";
        const competingFileSystem: FileSystem.FileSystem = {
          ...fs,
          writeFileString: (file, content, options) =>
            Effect.gen(function* () {
              if (file === outputPath) {
                yield* fs.writeFileString(file, existingContent, { flag: "wx", mode: 0o600 });
              }
              yield* fs.writeFileString(file, content, options);
            }),
        };
        const result = yield* Effect.result(
          writePublicEvalAttemptCapture({ outputPath, reportPath, capture }).pipe(
            Effect.provideService(FileSystem.FileSystem, competingFileSystem),
          ),
        );
        assert.strictEqual(result._tag, "Failure");
        if (result._tag === "Failure")
          assert.instanceOf(result.failure, PublicEvalAttemptWriteError);
        assert.strictEqual(yield* fs.readFileString(outputPath), existingContent);
        assert.strictEqual(yield* fs.readFileString(reportPath), reportContent);
      }),
    );

    it.effect("refuses report-path aliases without changing the report", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "public-attempts-collision-" });
        const source = path.join(root, "source");
        const alias = path.join(root, "alias");
        yield* fs.makeDirectory(source);
        yield* fs.symlink(source, alias);
        const reportPath = path.join(source, "report.json");
        const reportContent = `${yield* encodeReportJson(report)}\n`;
        yield* fs.writeFileString(reportPath, reportContent);
        const attempts = yield* makePublicEvalAttemptSummaries(observationSet(), repeatedGrades);
        const capture = yield* makePublicEvalAttemptCapture({
          runId: report.runId,
          reportContent,
          attempts,
        });
        for (const outputPath of [reportPath, path.join(alias, "report.json")]) {
          const result = yield* Effect.result(
            writePublicEvalAttemptCapture({ outputPath, reportPath, capture }),
          );
          assert.strictEqual(result._tag, "Failure");
          if (result._tag === "Failure") {
            assert.instanceOf(result.failure, PublicEvalAttemptWriteError);
            if (result.failure instanceof PublicEvalAttemptWriteError)
              assert.strictEqual(result.failure.reason, "output-conflict");
          }
          assert.strictEqual(yield* fs.readFileString(reportPath), reportContent);
        }
      }),
    );

    it.effect("refuses differing saved report bytes even when the parsed report is identical", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "public-attempts-digest-" });
        const reportPath = path.join(root, "report.json");
        const outputPath = path.join(root, "attempts.json");
        const reportContent = `${yield* encodeReportJson(report)}\n`;
        const attempts = yield* makePublicEvalAttemptSummaries(observationSet(), repeatedGrades);
        const capture = yield* makePublicEvalAttemptCapture({
          runId: report.runId,
          reportContent,
          attempts,
        });
        const changedContent = reportContent.trimEnd();
        yield* fs.writeFileString(reportPath, changedContent);
        const result = yield* Effect.result(
          writePublicEvalAttemptCapture({ outputPath, reportPath, capture }),
        );
        assert.strictEqual(result._tag, "Failure");
        if (result._tag === "Failure")
          assert.instanceOf(result.failure, PublicEvalAttemptCaptureError);
        assert.isFalse(yield* fs.exists(outputPath));
        assert.strictEqual(yield* fs.readFileString(reportPath), changedContent);
      }),
    );

    it.effect("rejects a saved report whose bytes gained a UTF-8 BOM and writes no companion", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "public-attempts-bom-" });
        const reportPath = path.join(root, "report.json");
        const controlPath = path.join(root, "control.json");
        const outputPath = path.join(root, "attempts.json");
        const reportContent = `${yield* encodeReportJson(report)}\n`;
        yield* fs.writeFileString(reportPath, reportContent);
        const attempts = yield* makePublicEvalAttemptSummaries(observationSet(), repeatedGrades);
        const capture = yield* makePublicEvalAttemptCapture({
          runId: report.runId,
          reportContent,
          attempts,
        });
        yield* writePublicEvalAttemptCapture({ outputPath: controlPath, reportPath, capture });
        assert.isTrue(yield* fs.exists(controlPath));

        yield* fs.writeFileString(reportPath, `\uFEFF${reportContent}`);
        const savedReport = yield* fs.readFile(reportPath);
        assert.deepStrictEqual([...savedReport.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
        const result = yield* Effect.result(
          writePublicEvalAttemptCapture({ outputPath, reportPath, capture }),
        );
        assert.strictEqual(result._tag, "Failure");
        if (result._tag === "Failure")
          assert.instanceOf(result.failure, PublicEvalAttemptCaptureError);
        assert.isFalse(yield* fs.exists(outputPath));
      }),
    );
  });
});
