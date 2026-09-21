import type { PluginEvalDimensionScore, PluginEvalToolCall } from "./contracts";

/** Routing only: relevance, answer grounding and retry necessity are not scored. */
export function gradeBoundedSearchCalls(
  calls: readonly Pick<PluginEvalToolCall, "name" | "arguments">[],
  tool: string,
  maxCalls: number,
): PluginEvalDimensionScore {
  const queries = calls.map((call) => call.arguments["query"]);
  const valid =
    calls.length >= 1 &&
    calls.length <= maxCalls &&
    calls.every((call) => call.name === tool) &&
    queries.every((query) => typeof query === "string" && query.trim().length > 0) &&
    new Set(
      queries.map((query) => (typeof query === "string" ? query.trim().toLowerCase() : query)),
    ).size === calls.length;
  return {
    score: valid ? 1 : 0,
    details: [
      valid
        ? `selected ${calls.length} distinct searches with ${tool}`
        : `expected 1–${maxCalls} distinct nonempty queries using only ${tool}`,
    ],
  };
}
