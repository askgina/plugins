import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Function, Layer, Path, Schema } from "effect";
import { build } from "vite-plus";

import {
  checkEvalPublicArtifacts,
  evalPublicArtifactsPlugin,
  EvalPublicArtifactError,
  validateClaudePublicArtifact,
} from "../check-eval-public-artifacts";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const WITHHELD = "withheld: privacy_review";
const SENTINEL = "synthetic-private-provider-content";
const observation = {
  version: 1,
  run_id: "claude-synthetic-spot-1",
  case_id: "synthetic-case",
  target: "omp_harness",
  model: "anthropic/claude-synthetic",
  repetition: 1,
  started_at: "2026-09-14T12:00:00.000Z",
  status: "completed",
  duration_ms: 1234,
  token_usage: { input_tokens: 100, output_tokens: 25, total_tokens: 125 },
};
const score = {
  case_id: "synthetic-case",
  overall_pass: true,
  routing: { score: 1, details: [WITHHELD] },
  arguments: { score: 1, details: [] },
  completion: { score: 1, details: [WITHHELD] },
  latency_ms: 1234,
  total_result_bytes: 456,
};
const trial = {
  caseId: "synthetic-case",
  repetition: 1,
  dispatchedAt: "2026-09-14T12:00:00.000Z",
  outcome: "observed",
  observation,
  score,
  error: null,
  wallDurationMs: 1300,
};
const family = {
  runId: "claude-synthetic-spot-1",
  family: "spot",
  planned: 5,
  dispatched: 4,
  graded: 2,
  passed: 1,
  failed: 1,
  unscored: 2,
  latencyMs: { p50: 1234, p95: 2345, max: 2345 },
  tokenUsage: { observations: 2, input: 200, output: 50, total: 250 },
  trials: [
    trial,
    {
      ...trial,
      repetition: 2,
      observation: { ...observation, repetition: 2, status: "failed", duration_ms: 2345 },
      score: {
        ...score,
        overall_pass: false,
        completion: { score: 0, details: [WITHHELD] },
        latency_ms: 2345,
      },
    },
    {
      caseId: "synthetic-case",
      repetition: 3,
      dispatchedAt: "2026-09-14T12:00:00.000Z",
      outcome: "runtime_failure",
      observation: null,
      score: null,
      error: { tag: "PluginEvalOmpHarnessTimeoutError", reason: WITHHELD },
      wallDurationMs: 30000,
    },
    {
      caseId: "synthetic-case",
      repetition: 4,
      dispatchedAt: "2026-09-14T12:00:00.000Z",
      outcome: "runtime_failure",
      observation: null,
      score: null,
      error: { tag: "PluginEvalOmpHarnessProcessError", reason: null },
      wallDurationMs: 400,
    },
  ],
};
const report = {
  planned: 5,
  dispatched: 4,
  graded: 2,
  passed: 1,
  failed: 1,
  unscored: 2,
  models: [{ model: "anthropic/claude-synthetic", reasoning: "medium", runs: [family] }],
};

const unsafeTrials = [
  { ...trial, observation: { ...observation, final_answer: SENTINEL } },
  { ...trial, attestation: { requestedReasoning: "high" } },
  { ...trial, observation: { ...observation, token_usage: null, final_answer: SENTINEL } },
  {
    ...trial,
    observation: { ...observation, tool_calls: [{ arguments: { query: SENTINEL } }] },
  },
  { ...trial, observation: { ...observation, raw_result: { content: SENTINEL } } },
  { ...trial, observation: { ...observation, error: { message: SENTINEL } } },
  { ...trial, observation: { ...observation, native_transcript: SENTINEL } },
  { ...trial, observation: { ...observation, reasoning: SENTINEL } },
  {
    ...trial,
    score: { ...score, completion: { score: 0, details: [SENTINEL] } },
  },
  { ...trial, score: { ...score, tool_result: SENTINEL } },
  {
    ...trial,
    error: { tag: "PluginEvalOmpHarnessProcessError", reason: SENTINEL },
  },
  { ...trial, error: { tag: SENTINEL, reason: WITHHELD } },
  {
    ...trial,
    observation: { ...observation, model: `anthropic/${"1".repeat(32)}` },
  },
  {
    ...trial,
    observation: { ...observation, case_id: `0x${"1".repeat(40)}` },
  },
  { ...trial, checks: { completion: { details: SENTINEL } } },
  {
    ...trial,
    observation: {
      ...observation,
      token_usage: { ...observation.token_usage, provider_response: SENTINEL },
    },
  },
];

describe("Claude static public artifact boundary", () => {
  it.effect(
    "accepts measured projections without changing grades, failures, counts or metrics",
    () =>
      Effect.gen(function* () {
        const original = structuredClone(report);
        yield* validateClaudePublicArtifact(report, "comparison.json");
        yield* Function.pipe(family, validateClaudePublicArtifact("family/summary.json"));
        assert.deepStrictEqual(report, original);
      }),
  );

  it.effect(
    "accepts unavailable token evidence and exact route failure tags without weakening trials",
    () =>
      Effect.gen(function* () {
        const withoutUsage = {
          ...trial,
          observation: { ...observation, token_usage: null },
        };
        yield* validateClaudePublicArtifact({ trials: [withoutUsage] }, "sweep.json");
        assert.isNull(withoutUsage.observation.token_usage);
        for (const tag of [
          "PluginEvalOmpHarnessSpawnError",
          "PluginEvalMuseCliProcessError",
          "PluginEvalDevinTimeoutError",
          "PluginEvalDevinProcessError",
        ]) {
          yield* validateClaudePublicArtifact(
            {
              trials: [
                {
                  ...trial,
                  outcome: "runtime_failure",
                  observation: null,
                  score: null,
                  error: { tag, reason: WITHHELD },
                },
              ],
            },
            "sweep.json",
          );
        }
      }),
  );

  it.effect("admits numeric post-run classification evidence without admitting raw payloads", () =>
    Effect.gen(function* () {
      const counts = {
        planned: 3,
        terminal: 2,
        graded: 2,
        passed: 1,
        failed: 1,
        unscored: 0,
        timeouts: 0,
        pending: 1,
      };
      const runtimeClassification = {
        schemaVersion: "ask-gina-runtime-classification.v1",
        receipt: "classification-receipt.json",
        receiptAvailability: "withheld",
        receiptSha256: "a".repeat(64),
        classifierSha256: "b".repeat(64),
        derived: true,
        scope: "post-run-runtime-classification",
        noAnswerRegrade: true,
        noOutcomeSelectiveRerun: true,
        rawEvidenceUnchanged: true,
        observationFiles: "raw-unchanged",
        counts: {
          raw: counts,
          corrected: { ...counts, graded: 1, failed: 0, unscored: 1 },
          changed: 1,
        },
      };
      yield* validateClaudePublicArtifact({ runtimeClassification }, "sweep.json");
      const failure = yield* Effect.flip(
        validateClaudePublicArtifact(
          {
            runtimeClassification: {
              ...runtimeClassification,
              counts: {
                ...runtimeClassification.counts,
                raw: { ...counts, final_answer: SENTINEL },
              },
            },
          },
          "sweep.json",
        ),
      );
      assert.strictEqual(failure.reason, "private_payload");
      assert.notInclude(encodeJson(failure), SENTINEL);
    }),
  );

  it.effect("rejects provider payloads at every trial boundary without echoing their values", () =>
    Effect.gen(function* () {
      for (const unsafe of unsafeTrials) {
        const input = { envelope: { models: [{ runs: [{ ...family, trials: [unsafe] }] }] } };
        const failure = yield* Effect.flip(validateClaudePublicArtifact(input, "comparison.json"));
        assert.strictEqual(failure.reason, "private_payload");
        assert.notInclude(encodeJson(failure), SENTINEL);
      }
      const relocated = { ...family, nested: [{ final_answer: SENTINEL }] };
      const failure = yield* Function.pipe(
        relocated,
        validateClaudePublicArtifact("summary.json"),
        Effect.flip,
      );
      assert.strictEqual(failure.reason, "private_payload");
    }),
  );

  it.layer(Layer.merge(BunFileSystem.layer, BunPath.layer))((it) => {
    it.effect("rejects unreviewed transcript indexes before publishing chat content", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const root = yield* fs.makeTempDirectoryScoped();
          yield* fs.makeDirectory(path.join(root, "src"));
          yield* fs.makeDirectory(path.join(root, "public/transcripts"), { recursive: true });
          yield* fs.writeFileString(
            path.join(root, "public/transcripts/index.json"),
            encodeJson({ visibleMessages: [SENTINEL] }),
          );
          const failure = yield* Effect.flip(checkEvalPublicArtifacts(root));
          assert.strictEqual(failure.reason, "unapproved_artifact");
          assert.notInclude(failure.message, SENTINEL);
        }),
      ),
    );

    it.effect("checks non-Claude sweep artifacts before allowing them into the bundle", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const root = yield* fs.makeTempDirectoryScoped({ prefix: "eval-public-sweep-" });
          const directory = "src/results/2026-09-16/reasoning-sweep";
          yield* fs.makeDirectory(path.join(root, directory), { recursive: true });
          yield* fs.makeDirectory(path.join(root, "public"));
          const filename = path.join(directory, "ask-gina-reasoning-sweep.json");
          yield* fs.writeFileString(
            path.join(root, filename),
            encodeJson({
              model: "openai-codex/synthetic",
              final_answer: SENTINEL,
            }),
          );
          const failure = yield* Effect.flip(checkEvalPublicArtifacts(root));
          assert.strictEqual(failure.reason, "private_payload");
          assert.strictEqual(failure.file, filename);
          assert.notInclude(encodeJson(failure), SENTINEL);
        }),
      ),
    );

    it.effect("finds renamed family duplicates in source and directly copied public assets", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const root = yield* fs.makeTempDirectoryScoped({ prefix: "eval-public-artifacts-" });
          yield* fs.makeDirectory(path.join(root, "src"));
          yield* fs.makeDirectory(path.join(root, "public"));
          yield* fs.writeFileString(path.join(root, "src", "report.json"), encodeJson(report));
          const unapproved = yield* Effect.flip(checkEvalPublicArtifacts(root));
          assert.strictEqual(unapproved.reason, "unapproved_artifact");
          yield* fs.remove(path.join(root, "src", "report.json"));

          for (const directory of ["src/new/nesting", "public/downloads"]) {
            yield* fs.makeDirectory(path.join(root, directory), { recursive: true });
            const filename = path.join(directory, "renamed.json");
            yield* fs.writeFileString(
              path.join(root, filename),
              encodeJson({ envelope: [{ ...family, trials: [unsafeTrials[0]] }] }),
            );
            const failure = yield* Effect.flip(checkEvalPublicArtifacts(root));
            assert.strictEqual(failure.reason, "private_payload");
            assert.strictEqual(failure.file, filename);
            yield* fs.remove(path.join(root, filename));
          }
        }),
      ),
    );

    it.effect(
      "rejects outer provider prose and altered metric bytes at approved publication paths",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const path = yield* Path.Path;
            const root = yield* fs.makeTempDirectoryScoped({ prefix: "eval-public-unapproved-" });
            yield* fs.makeDirectory(path.join(root, "src"));
            yield* fs.makeDirectory(path.join(root, "public"));
            const changedArtifacts = [
              {
                file: "src/results/2026-09-14/claude-comparison/ask-gina-claude-comparison.json",
                value: { ...report, providerText: SENTINEL },
              },
              {
                file: "src/results/2026-09-14/claude-comparison/fable/spot/summary.json",
                value: { ...family, latencyMs: { ...family.latencyMs, p50: SENTINEL } },
              },
            ];
            for (const artifact of changedArtifacts) {
              const filename = path.join(root, artifact.file);
              yield* fs.makeDirectory(path.dirname(filename), { recursive: true });
              yield* fs.writeFileString(filename, encodeJson(artifact.value));
              const failure = yield* Effect.flip(checkEvalPublicArtifacts(root));
              assert.strictEqual(failure.reason, "unapproved_artifact");
              assert.strictEqual(failure.file, artifact.file);
              assert.notInclude(failure.message, SENTINEL);
              yield* fs.remove(filename);
            }
          }),
        ),
    );

    it.effect("rejects malformed JSON without putting parser excerpts in diagnostics", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const root = yield* fs.makeTempDirectoryScoped({ prefix: "eval-public-invalid-" });
          yield* fs.makeDirectory(path.join(root, "src"));
          yield* fs.makeDirectory(path.join(root, "public"));
          yield* fs.writeFileString(path.join(root, "src", "claude.json"), `{${SENTINEL}`);
          const failure = yield* Effect.flip(checkEvalPublicArtifacts(root));
          assert.strictEqual(failure.reason, "invalid_json");
          assert.notInclude(encodeJson(failure), SENTINEL);
        }),
      ),
    );

    it.effect(
      "stops Vite before JSON imports, raw URL downloads or public copies can be emitted",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const path = yield* Path.Path;
            const root = yield* fs.makeTempDirectoryScoped({ prefix: "eval-public-build-" });
            yield* fs.makeDirectory(path.join(root, "src"));
            yield* fs.makeDirectory(path.join(root, "public"));
            yield* fs.writeFileString(
              path.join(root, "index.html"),
              '<script type="module" src="/src/main.js"></script>',
            );
            yield* fs.writeFileString(
              path.join(root, "src", "main.js"),
              'import data from "./claude.json"; import url from "./claude.json?url"; document.body.textContent = JSON.stringify({data, url});',
            );
            yield* fs.writeFileString(
              path.join(root, "src", "claude.json"),
              encodeJson({ ...family, trials: [unsafeTrials[0]] }),
            );
            const rejected = yield* Effect.tryPromise(() =>
              build({
                configFile: false,
                root,
                plugins: [evalPublicArtifactsPlugin(root)],
                logLevel: "silent",
                build: { outDir: "dist" },
              }),
            ).pipe(
              Effect.match({
                onFailure: (failure) => {
                  assert.instanceOf(failure.cause, EvalPublicArtifactError);
                  assert.notInclude(String(failure.cause), SENTINEL);
                  return true;
                },
                onSuccess: () => false,
              }),
            );
            assert.isTrue(rejected, "Unsafe Claude JSON must abort the public build");
            assert.isFalse(yield* fs.exists(path.join(root, "dist")));
          }),
        ),
    );
  });
});
