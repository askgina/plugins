import { describe, expect, test } from "vitest";
import { Effect } from "effect";
import { gradeBoundedSearchCalls } from "../src/bounded-search";
import { gradePluginEvalObservation } from "../src/grading";
import type { PluginEvalCase, PluginEvalObservation } from "../src/contracts";

const tool = "predictions.searchPredictionMarkets";
const calls = (...queries: string[]) =>
  queries.map((query, sequence) => ({ sequence, name: tool, arguments: { query } }));
const evalCase: PluginEvalCase = {
  id: "search-contract",
  category: "direct",
  tags: [],
  manual_priority: "required",
  turns: [{ role: "user", content: "Find NBA markets" }],
  expected: {
    routing: { kind: "bounded_search", tool, max_calls: 3 },
    arguments: { tool, required: { query: "Find NBA markets" }, allow_additional: true },
    safety: { forbidden_tools: ["predictions.getPredictionMarketDetails"] },
  },
};
const observation: PluginEvalObservation = {
  version: 1,
  run_id: "test",
  case_id: evalCase.id,
  target: "fixture",
  model: "fixture",
  repetition: 1,
  started_at: "2026-09-21T00:00:00Z",
  status: "completed",
  duration_ms: 1,
  tool_calls: calls("Find NBA markets", "NBA champion 2027"),
};

describe("bounded search routing", () => {
  test("accepts one to three searches and rejects empty, duplicate, excess, and unrelated calls", () => {
    for (const sequence of [calls("one"), calls("one", "two"), calls("one", "two", "three")]) {
      expect(gradeBoundedSearchCalls(sequence, tool, 3).score).toBe(1);
    }
    for (const sequence of [
      calls(),
      calls(""),
      calls("one", " ONE "),
      calls("one", "two", "three", "four"),
      [...calls("one"), { sequence: 2, name: "predictions.getSeriesMarket", arguments: {} }],
    ]) {
      expect(gradeBoundedSearchCalls(sequence, tool, 3).score).toBe(0);
    }
  });
  test("keeps first-query, completion and forbidden-tool failures", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        expect((yield* gradePluginEvalObservation(evalCase, observation)).overall_pass).toBe(true);
        const wrongFirst = yield* gradePluginEvalObservation(evalCase, {
          ...observation,
          tool_calls: calls("NBA", "Find NBA markets"),
        });
        expect(wrongFirst.arguments.score).toBe(0);
        expect(wrongFirst.overall_pass).toBe(false);
        const error = yield* gradePluginEvalObservation(evalCase, {
          ...observation,
          tool_calls: [
            {
              ...observation.tool_calls[0]!,
              error: { code: "UPSTREAM_FAILURE", message: "unavailable" },
            },
            ...observation.tool_calls.slice(1),
          ],
        });
        expect(error.completion.score).toBe(0);
        expect(error.overall_pass).toBe(false);
        const forbidden = yield* gradePluginEvalObservation(evalCase, {
          ...observation,
          tool_calls: [
            ...observation.tool_calls,
            { sequence: 3, name: "predictions.getPredictionMarketDetails", arguments: {} },
          ],
        });
        expect(forbidden.safety?.score).toBe(0);
        expect(forbidden.overall_pass).toBe(false);
      }),
    ));
  test("leaves exact-call expectations strict", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const score = yield* gradePluginEvalObservation(
          { ...evalCase, expected: { ...evalCase.expected, routing: { kind: "exact", tool } } },
          observation,
        );
        expect(score.routing.score).toBe(0);
        expect(score.overall_pass).toBe(false);
      }),
    ));
});
