import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { isGinaReadToolName, listCatalogToolNames } from "@askgina/contracts";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Path } from "effect";

import {
  decodePluginEvalObservationSet,
  decodePluginEvalSuite,
  gradePluginEvalObservation,
  loadPluginEvalSuite,
  LiveEvalSelectionError,
  PluginEvalReplayContractError,
  replayPluginEvalObservationSet,
  runLiveEvalSuite,
  runHermeticEvalReplay,
} from "../src/index";
import { makeSanitizedEvalRunReport } from "../src/report";

const collectPublicStrings = (value: unknown): readonly string[] => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectPublicStrings);
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, nested]) => [key, ...collectPublicStrings(nested)]);
  }
  return [];
};

const TestPlatformLayer = Layer.merge(BunFileSystem.layer, BunPath.layer);

const fixturePaths = Effect.gen(function* () {
  const path = yield* Path.Path;
  const root = path.join(process.cwd(), "packages/evals/src/fixtures");
  return {
    liveSuite: path.join(root, "ask-gina-routing-smoke.yaml"),
    observations: path.join(root, "synthetic-observations.yaml"),
    suite: path.join(root, "model-smoke.yaml"),
  };
});

describe("hermetic eval replay", () => {
  it.layer(TestPlatformLayer)((it) => {
    it.effect("replays the packaged synthetic fixtures with optional evidence dimensions", () =>
      Effect.gen(function* () {
        const paths = yield* fixturePaths;
        const result = yield* runHermeticEvalReplay({
          suitePath: paths.suite,
          observationsPath: paths.observations,
        });

        assert.strictEqual(result.suiteId, "synthetic-model-smoke-v1");
        assert.strictEqual(result.suiteVersion, 1);
        assert.strictEqual(result.fixtureVersion, 1);
        assert.strictEqual(result.report.observed, 3);
        assert.deepStrictEqual(result.report.overall, {
          passed: 2,
          failed: 1,
          pass_rate: 2 / 3,
        });
        assert.deepStrictEqual(result.report.routing, {
          passed: 2,
          failed: 1,
          pass_rate: 2 / 3,
        });
        assert.deepStrictEqual(result.report.arguments, {
          passed: 2,
          failed: 1,
          pass_rate: 2 / 3,
        });
        assert.deepStrictEqual(result.report.safety, {
          passed: 2,
          failed: 0,
          pass_rate: 1,
        });
        assert.deepStrictEqual(result.report.completion, {
          passed: 3,
          failed: 0,
          pass_rate: 1,
        });
        assert.deepStrictEqual(result.report.latency_ms, { p50: 1, p95: 1, max: 1 });
        assert.deepStrictEqual(result.report.total_result_bytes, { p50: 0, p95: 0, max: 0 });
        assert.deepStrictEqual(result.report.token_usage, {
          observations: 0,
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
        });
        assert.deepStrictEqual(
          result.report.scores.map((score) => ({
            arguments: score.arguments.score,
            completion: score.completion.score,
            overall: score.overall_pass,
            routing: score.routing.score,
            safety: score.safety?.score,
          })),
          [
            { arguments: 1, completion: 1, overall: true, routing: 1, safety: 1 },
            { arguments: 1, completion: 1, overall: true, routing: 1, safety: undefined },
            { arguments: 0, completion: 1, overall: false, routing: 0, safety: 1 },
          ],
        );
        assert.isFalse(Object.hasOwn(result.report, "skill"));
        assert.isFalse(Object.hasOwn(result.report, "performance"));
        assert.isFalse(Object.hasOwn(result.report, "answer"));
      }),
    );
    it.effect("keeps the live smoke suite within the canonical read-tool catalog", () =>
      Effect.gen(function* () {
        const paths = yield* fixturePaths;
        const suite = yield* loadPluginEvalSuite(paths.liveSuite);
        const expectedTools = suite.cases.flatMap((evalCase) => {
          switch (evalCase.expected.routing.kind) {
            case "exact":
              return [evalCase.expected.routing.tool];
            case "one_of":
            case "sequence":
              return evalCase.expected.routing.tools;
            case "none":
              return [];
          }
        });

        assert.strictEqual(suite.suite.id, "ask-gina-read-routing-smoke-v1");
        assert.strictEqual(suite.cases.length, 4);
        assert.isTrue(expectedTools.every(isGinaReadToolName));
      }),
    );
    it.effect("requires canonical catalog evidence for both completed live targets", () =>
      Effect.gen(function* () {
        const paths = yield* fixturePaths;
        const suite = yield* loadPluginEvalSuite(paths.liveSuite);
        const evalCase = suite.cases[0];
        if (evalCase === undefined) return yield* Effect.die("missing fixture case");
        const canonicalTools = listCatalogToolNames();

        for (const target of ["responses_api", "codex_cli"] as const) {
          for (const availableTools of [undefined, canonicalTools.slice(1)] as const) {
            const result = yield* Effect.result(
              replayPluginEvalObservationSet(suite, {
                version: 1,
                manifest: {
                  version: 1,
                  run_id: `catalog-${target}`,
                  suite_id: suite.suite.id,
                  suite_version: suite.version,
                  catalog_version: suite.suite.catalog_version,
                  allowed_tools: canonicalTools,
                  candidate: "test-candidate",
                  target: "fixture",
                  model: "test-model",
                  started_at: "2026-08-25T00:00:00.000Z",
                  repetitions: 1,
                  clean_chat: true,
                  account_class: "synthetic",
                  artifact_policy: "sanitized",
                },
                observations: [
                  {
                    version: 1,
                    run_id: `catalog-${target}`,
                    case_id: evalCase.id,
                    target,
                    model: "test-model",
                    repetition: 1,
                    started_at: "2026-08-25T00:00:01.000Z",
                    status: "completed",
                    duration_ms: 1,
                    tool_calls: [],
                    ...(availableTools === undefined ? {} : { available_tools: availableTools }),
                  },
                ],
              }),
            );
            assert.strictEqual(result._tag, "Failure");
            if (result._tag === "Failure") {
              assert.instanceOf(result.failure, PluginEvalReplayContractError);
            }
          }
        }
      }),
    );
    it.effect("rejects out-of-catalog expectation tools before invoking a transport", () =>
      Effect.gen(function* () {
        const paths = yield* fixturePaths;
        const suite = yield* loadPluginEvalSuite(paths.liveSuite);
        const baseCase = suite.cases[0];
        if (baseCase === undefined) return yield* Effect.die("missing fixture case");
        const invalidSuites = [
          {
            name: "routing",
            suite: {
              ...suite,
              cases: [
                {
                  ...baseCase,
                  expected: {
                    ...baseCase.expected,
                    routing: { kind: "exact" as const, tool: "perps.placeOrder" },
                  },
                },
              ],
            },
          },
          {
            name: "arguments",
            suite: {
              ...suite,
              cases: [
                {
                  ...baseCase,
                  expected: {
                    ...baseCase.expected,
                    arguments: {
                      ...baseCase.expected.arguments,
                      tool: "perps.placeOrder",
                    },
                  },
                },
              ],
            },
          },
        ];

        for (const invalid of invalidSuites) {
          let trialInvocations = 0;
          const result = yield* Effect.result(
            runLiveEvalSuite(
              {
                suite: invalid.suite,
                runId: `out-of-catalog-${invalid.name}`,
                candidate: "test-candidate",
                target: "responses_api",
                model: "test-model",
                displayedModel: "test-model",
                reasoning: "test",
                repetitions: 3,
                accountClass: "synthetic",
              },
              () => {
                trialInvocations += 1;
                return Effect.die("trial should not run");
              },
            ),
          );

          assert.strictEqual(trialInvocations, 0);
          assert.strictEqual(result._tag, "Failure");
          if (result._tag === "Failure") {
            assert.instanceOf(result.failure, LiveEvalSelectionError);
            if (result.failure instanceof LiveEvalSelectionError) {
              assert.strictEqual(result.failure.reason, "out-of-catalog-tool");
            }
          }
        }
      }),
    );
    it.effect("applies one rubric across every requested live repetition", () =>
      Effect.gen(function* () {
        const paths = yield* fixturePaths;
        const suite = yield* loadPluginEvalSuite(paths.liveSuite);
        const report = yield* runLiveEvalSuite(
          {
            suite,
            caseIds: ["list-scheduled-prompts"],
            runId: "shared-rubric-test",
            candidate: "test-candidate",
            target: "responses_api",
            model: "test-model",
            displayedModel: "test-model",
            reasoning: "test",
            repetitions: 3,
            accountClass: "synthetic",
          },
          (input) =>
            Effect.succeed({
              version: 1,
              run_id: input.runId,
              case_id: input.evalCase.id,
              target: "responses_api" as const,
              model: input.model,
              displayed_model: input.displayedModel,
              repetition: input.repetition,
              started_at: input.startedAt,
              status: "completed" as const,
              duration_ms: input.repetition,
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
            }),
        );

        assert.strictEqual(report.repetitions, 3);
        assert.deepStrictEqual(report.aggregate.overall, { passed: 3, total: 3 });
        assert.deepStrictEqual(report.aggregate.dimensions.routing, { passed: 3, failed: 0 });
      }),
    );
    it.effect("scores skill activation only when observation evidence is present", () =>
      Effect.gen(function* () {
        const paths = yield* fixturePaths;
        const suite = yield* loadPluginEvalSuite(paths.liveSuite);
        const evalCase = suite.cases[0];
        if (evalCase === undefined) return yield* Effect.die("missing fixture case");
        const observation = {
          version: 1,
          run_id: "skill-evidence",
          case_id: evalCase.id,
          target: "responses_api",
          model: "test-model",
          repetition: 1,
          started_at: "2026-08-25T00:00:01.000Z",
          status: "completed",
          duration_ms: 1,
          tool_calls: [
            {
              sequence: 0,
              name: "gina.listScheduledPrompts",
              arguments: {},
            },
          ],
        } as const;

        const unobserved = yield* gradePluginEvalObservation(evalCase, observation);
        assert.isFalse(Object.hasOwn(unobserved, "skill_activation"));
        assert.isTrue(unobserved.overall_pass);

        const mismatch = yield* gradePluginEvalObservation(evalCase, {
          ...observation,
          activated_skills: ["research-spot-tokens"],
        });
        assert.strictEqual(mismatch.skill_activation?.score, 0);
        assert.isFalse(mismatch.overall_pass);
      }),
    );
    it.effect("leaves scope safety unscored without explicit observation evidence", () =>
      Effect.gen(function* () {
        const paths = yield* fixturePaths;
        const suite = yield* loadPluginEvalSuite(paths.liveSuite);
        const evalCase = suite.cases.find((candidate) => candidate.id === "reject-write-request");
        if (evalCase === undefined) return yield* Effect.die("missing safety fixture case");
        const observation = {
          version: 1,
          run_id: "scope-evidence",
          case_id: evalCase.id,
          target: "responses_api",
          model: "test-model",
          repetition: 1,
          started_at: "2026-08-25T00:00:01.000Z",
          status: "completed",
          duration_ms: 1,
          tool_calls: [],
        } as const;

        const unobserved = yield* gradePluginEvalObservation(evalCase, observation);
        assert.isFalse(Object.hasOwn(unobserved, "safety"));
        assert.isTrue(unobserved.overall_pass);

        const forbidden = yield* gradePluginEvalObservation(evalCase, {
          ...observation,
          tool_calls: [
            {
              sequence: 0,
              name: "spot.getSimplePrice",
              arguments: {},
              requested_scope: "tools:execute",
            },
          ],
        });
        assert.strictEqual(forbidden.safety?.score, 0);
        assert.isFalse(forbidden.overall_pass);
      }),
    );
    it.effect("rejects cases that the two live transports cannot present identically", () =>
      Effect.gen(function* () {
        const paths = yield* fixturePaths;
        const suite = yield* loadPluginEvalSuite(paths.liveSuite);
        const baseCase = suite.cases[0];
        if (baseCase === undefined) return yield* Effect.die("missing fixture case");
        let invoked = false;
        const result = yield* Effect.result(
          runLiveEvalSuite(
            {
              suite: {
                ...suite,
                cases: [
                  {
                    ...baseCase,
                    turns: [
                      { role: "system" as const, content: "Use the tool." },
                      ...baseCase.turns,
                    ],
                  },
                ],
              },
              runId: "unsupported-turns",
              candidate: "test-candidate",
              target: "responses_api",
              model: "test-model",
              displayedModel: "test-model",
              reasoning: "test",
              repetitions: 3,
              accountClass: "synthetic",
            },
            () => {
              invoked = true;
              return Effect.die("trial should not run");
            },
          ),
        );

        assert.isFalse(invoked);
        assert.strictEqual(result._tag, "Failure");
        if (result._tag === "Failure") {
          assert.strictEqual(result.failure._tag, "LiveEvalSelectionError");
          if (result.failure._tag === "LiveEvalSelectionError") {
            assert.strictEqual(result.failure.reason, "unsupported-turns");
          }
        }
      }),
    );
    it.effect("bounds live repetitions before invoking a transport", () =>
      Effect.gen(function* () {
        const paths = yield* fixturePaths;
        const suite = yield* loadPluginEvalSuite(paths.liveSuite);
        let invoked = false;
        const result = yield* Effect.result(
          runLiveEvalSuite(
            {
              suite,
              runId: "too-many-repetitions",
              candidate: "test-candidate",
              target: "responses_api",
              model: "test-model",
              displayedModel: "test-model",
              reasoning: "test",
              repetitions: 6,
              accountClass: "synthetic",
            },
            () => {
              invoked = true;
              return Effect.die("trial should not run");
            },
          ),
        );

        assert.isFalse(invoked);
        assert.strictEqual(result._tag, "Failure");
        if (result._tag === "Failure") {
          assert.strictEqual(result.failure._tag, "LiveEvalSelectionError");
          if (result.failure._tag === "LiveEvalSelectionError") {
            assert.strictEqual(result.failure.reason, "invalid-repetitions");
          }
        }
      }),
    );

    it.effect("rejects unsafe run metadata before invoking a transport", () =>
      Effect.gen(function* () {
        const paths = yield* fixturePaths;
        const suite = yield* loadPluginEvalSuite(paths.liveSuite);
        let invoked = false;
        const result = yield* Effect.result(
          runLiveEvalSuite(
            {
              suite,
              runId: "unsafe-candidate",
              candidate: "feature/foo",
              target: "responses_api",
              model: "test-model",
              displayedModel: "test-model",
              reasoning: "test",
              repetitions: 3,
              accountClass: "synthetic",
            },
            () => {
              invoked = true;
              return Effect.die("trial should not run");
            },
          ),
        );

        assert.isFalse(invoked);
        assert.strictEqual(result._tag, "Failure");
        if (result._tag === "Failure") {
          assert.strictEqual(result.failure._tag, "SanitizedEvalRunReportError");
        }
      }),
    );

    it.effect("emits only bounded aggregate evidence with safe run metadata", () =>
      Effect.gen(function* () {
        const paths = yield* fixturePaths;
        const replay = yield* runHermeticEvalReplay({
          suitePath: paths.suite,
          observationsPath: paths.observations,
        });
        const report = yield* makeSanitizedEvalRunReport({
          ...replay,
        });

        assert.strictEqual(report.runId, "synthetic-model-smoke-run-v1");
        assert.strictEqual(report.model, "fixture-model");
        assert.strictEqual(report.reasoning, "deterministic");
        assert.strictEqual(report.startedAt, "2026-08-25T00:00:00.000Z");
        assert.strictEqual(report.accountClass, "synthetic");
        assert.strictEqual(report.aggregate.overall.total, 3);
        assert.deepStrictEqual(report.aggregate.tokenUsage, {
          observations: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        });
        assert.deepStrictEqual(report.aggregate.dimensions.routing, { passed: 2, failed: 1 });
        assert.isFalse(Object.hasOwn(report.aggregate, "scores"));
        assert.notInclude(collectPublicStrings(report).join("\n"), "Look up the synthetic label");

        const unsafe = yield* Effect.result(
          makeSanitizedEvalRunReport({
            ...replay,
            manifest: {
              ...replay.manifest,
              candidate: ["gh", "p_0123456789abcdefghijklmnopqrstuvwxyz"].join(""),
            },
          }),
        );
        assert.strictEqual(unsafe._tag, "Failure");
        if (unsafe._tag === "Failure") {
          assert.strictEqual(unsafe.failure._tag, "SanitizedEvalRunReportError");
        }
      }),
    );

    it.effect("accepts a sanitized report when reasoning is omitted from the manifest", () =>
      Effect.gen(function* () {
        const paths = yield* fixturePaths;
        const replay = yield* runHermeticEvalReplay({
          suitePath: paths.suite,
          observationsPath: paths.observations,
        });
        const { reasoning: _reasoning, ...manifest } = replay.manifest;
        const report = yield* makeSanitizedEvalRunReport({
          ...replay,
          manifest,
        });

        assert.isFalse(Object.hasOwn(report, "reasoning"));
      }),
    );
    it.effect("rejects sanitized reports with incomplete replay coverage", () =>
      Effect.gen(function* () {
        const paths = yield* fixturePaths;
        const replay = yield* runHermeticEvalReplay({
          suitePath: paths.suite,
          observationsPath: paths.observations,
        });
        const expectedObservations = replay.report.expected_observations + 1;
        const result = yield* Effect.result(
          makeSanitizedEvalRunReport({
            ...replay,
            report: {
              ...replay.report,
              expected_observations: expectedObservations,
              coverage_rate: replay.report.observed / expectedObservations,
            },
          }),
        );

        assert.strictEqual(result._tag, "Failure");
        if (result._tag === "Failure") {
          assert.include(result.failure.reasons, "eval replay coverage must be complete");
        }
      }),
    );

    it.effect("rejects schema and observation invariant drift before replay", () =>
      Effect.gen(function* () {
        const invalidSuite = yield* Effect.result(
          decodePluginEvalSuite(
            {
              version: 1,
              suite: {
                id: "synthetic-suite",
                plugin: "synthetic-fixture",
                catalog_version: "synthetic-catalog",
                description: "Synthetic invalid suite.",
              },
              cases: [],
              unexpected: true,
            },
            "inline-suite",
          ),
        );
        assert.strictEqual(invalidSuite._tag, "Failure");
        if (invalidSuite._tag === "Failure") {
          assert.strictEqual(invalidSuite.failure._tag, "PluginEvalSuiteValidationError");
        }

        const invalidObservations = yield* Effect.result(
          decodePluginEvalObservationSet(
            {
              version: 1,
              manifest: {
                version: 1,
                run_id: "synthetic-run",
                suite_id: "synthetic-suite",
                suite_version: 1,
                catalog_version: "synthetic-catalog",
                candidate: "synthetic-candidate",
                target: "fixture",
                model: "synthetic-model",
                started_at: "2026-08-25T00:00:00.000Z",
                repetitions: 1,
                clean_chat: true,
                account_class: "synthetic",
                artifact_policy: "sanitized",
              },
              observations: [
                {
                  version: 1,
                  run_id: "wrong-run",
                  case_id: "synthetic-case",
                  target: "fixture",
                  model: "synthetic-model",
                  repetition: 1,
                  started_at: "2026-08-25T00:00:01.000Z",
                  status: "completed",
                  duration_ms: 1,
                  tool_calls: [],
                },
              ],
            },
            "inline-observations",
          ),
        );
        assert.strictEqual(invalidObservations._tag, "Failure");
        if (invalidObservations._tag === "Failure") {
          assert.strictEqual(
            invalidObservations.failure._tag,
            "PluginEvalObservationSetValidationError",
          );
          assert.include(invalidObservations.failure.reasons.join("\n"), "run_id");
        }
      }),
    );

    it.effect("grades a mismatched case id as a typed Effect failure", () =>
      Effect.gen(function* () {
        const paths = yield* fixturePaths;
        const result = yield* runHermeticEvalReplay({
          suitePath: paths.suite,
          observationsPath: paths.observations,
        });
        const score = result.report.scores[0];
        if (score === undefined) return yield* Effect.die("packaged replay returned no scores");

        const mismatch = yield* Effect.result(
          gradePluginEvalObservation(
            {
              id: "different-case",
              category: "direct",
              tags: ["synthetic"],
              manual_priority: "required",
              turns: [{ role: "user", content: "Look up the synthetic label amber." }],
              expected: { routing: { kind: "none" } },
            },
            {
              version: 1,
              run_id: "synthetic-run",
              case_id: score.case_id,
              target: "fixture",
              model: "synthetic-model",
              repetition: 1,
              started_at: "2026-08-25T00:00:00.000Z",
              status: "completed",
              duration_ms: 1,
              tool_calls: [],
            },
          ),
        );
        assert.strictEqual(mismatch._tag, "Failure");
        if (mismatch._tag === "Failure") {
          assert.strictEqual(mismatch.failure._tag, "PluginEvalObservationMismatchError");
        }
      }),
    );
  });
});
