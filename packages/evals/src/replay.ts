import { Data, Effect, Function } from "effect";
import { listCatalogToolNames } from "@askgina/contracts";

import type {
  PluginEvalCaseScore,
  PluginEvalDimensionScore,
  PluginEvalDimensionSummary,
  PluginEvalDistributionSummary,
  PluginEvalObservationSet,
  PluginEvalReplayReport,
  PluginEvalTokenUsageSummary,
  PluginEvalSuite,
} from "./contracts.js";
import { gradePluginEvalObservation, type PluginEvalObservationMismatchError } from "./grading.js";

export class PluginEvalReplayContractError extends Data.TaggedError(
  "PluginEvalReplayContractError",
)<{
  readonly reasons: readonly string[];
}> {}

const catalogsMatch = (left: readonly string[], right: readonly string[]): boolean => {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return (
    sortedLeft.every((tool, index) => index === 0 || tool !== sortedLeft[index - 1]) &&
    sortedLeft.every((tool, index) => tool === sortedRight[index])
  );
};

const summarizeDimensions = (
  scores: readonly PluginEvalDimensionScore[],
): PluginEvalDimensionSummary => {
  const passed = scores.filter((score) => score.score === 1).length;
  const failed = scores.length - passed;
  return {
    passed,
    failed,
    pass_rate: scores.length === 0 ? null : passed / scores.length,
  };
};

const summarizeOverall = (scores: readonly PluginEvalCaseScore[]): PluginEvalDimensionSummary => {
  const passed = scores.filter((score) => score.overall_pass).length;
  const failed = scores.length - passed;
  return {
    passed,
    failed,
    pass_rate: passed / scores.length,
  };
};

const nearestRank = (sortedValues: readonly number[], percentile: number): number => {
  const index = Math.max(0, Math.ceil(percentile * sortedValues.length) - 1);
  return sortedValues[index] ?? 0;
};

const summarizeDistribution = (values: readonly number[]): PluginEvalDistributionSummary => {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    p50: nearestRank(sorted, 0.5),
    p95: nearestRank(sorted, 0.95),
    max: sorted.at(-1) ?? 0,
  };
};

const summarizeTokenUsage = (
  observationSet: PluginEvalObservationSet,
): PluginEvalTokenUsageSummary => {
  let observations = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  for (const observation of observationSet.observations) {
    if (observation.token_usage === undefined) continue;
    observations += 1;
    inputTokens += observation.token_usage.input_tokens;
    outputTokens += observation.token_usage.output_tokens;
    totalTokens += observation.token_usage.total_tokens;
  }
  return {
    observations,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
  };
};

const buildReplayReport = (
  suite: PluginEvalSuite,
  observationSet: PluginEvalObservationSet,
  scores: readonly PluginEvalCaseScore[],
): PluginEvalReplayReport => {
  const expectedObservations = suite.cases.length * observationSet.manifest.repetitions;
  const availableTools = observationSet.observations.find(
    (observation) => observation.available_tools !== undefined,
  )?.available_tools;
  return {
    version: 1,
    run_id: observationSet.manifest.run_id,
    suite_id: suite.suite.id,
    catalog_version: suite.suite.catalog_version,
    allowed_tools: observationSet.manifest.allowed_tools,
    available_tools: availableTools,
    candidate: observationSet.manifest.candidate,
    target: observationSet.manifest.target,
    model: observationSet.manifest.model,
    displayed_model: observationSet.manifest.displayed_model,
    expected_observations: expectedObservations,
    observed: scores.length,
    coverage_rate: scores.length / expectedObservations,
    overall: summarizeOverall(scores),
    routing: summarizeDimensions(scores.map((score) => score.routing)),
    arguments: summarizeDimensions(scores.map((score) => score.arguments)),
    safety: summarizeDimensions(
      scores.flatMap((score) => (score.safety === undefined ? [] : [score.safety])),
    ),
    completion: summarizeDimensions(scores.map((score) => score.completion)),
    skill_activation: summarizeDimensions(
      scores.flatMap((score) =>
        score.skill_activation === undefined ? [] : [score.skill_activation],
      ),
    ),
    latency_ms: summarizeDistribution(scores.map((score) => score.latency_ms)),
    total_result_bytes: summarizeDistribution(scores.map((score) => score.total_result_bytes)),
    token_usage: summarizeTokenUsage(observationSet),
    scores,
  };
};

const validateReplayContract = (
  suite: PluginEvalSuite,
  observationSet: PluginEvalObservationSet,
): Effect.Effect<void, PluginEvalReplayContractError> => {
  const reasons: string[] = [];
  if (observationSet.manifest.suite_id !== suite.suite.id) {
    reasons.push("manifest suite_id does not match the loaded suite");
  }
  if (observationSet.manifest.suite_version !== suite.version) {
    reasons.push("manifest suite_version does not match the loaded suite");
  }
  if (observationSet.manifest.catalog_version !== suite.suite.catalog_version) {
    reasons.push("manifest catalog_version does not match the loaded suite");
  }

  const caseIds = new Set(suite.cases.map((evalCase) => evalCase.id));
  const allowedTools = observationSet.manifest.allowed_tools;
  const sortedAllowedTools = allowedTools === undefined ? undefined : [...allowedTools].sort();
  let observedAvailableTools: readonly string[] | undefined;
  if (allowedTools !== undefined && new Set(allowedTools).size !== allowedTools.length) {
    reasons.push("manifest allowed_tools contains duplicates");
  }
  for (const observation of observationSet.observations) {
    if (!caseIds.has(observation.case_id)) {
      reasons.push(`observation references unknown case ${observation.case_id}`);
    }
    const requiresCanonicalCatalog =
      observation.status === "completed" &&
      (observation.target === "responses_api" || observation.target === "codex_cli");
    if (requiresCanonicalCatalog && observation.available_tools === undefined) {
      reasons.push(`${observation.case_id} completed without an imported MCP tool catalog`);
    }
    if (
      requiresCanonicalCatalog &&
      (allowedTools === undefined || !catalogsMatch(allowedTools, listCatalogToolNames()))
    ) {
      reasons.push(`${observation.case_id} completed without canonical manifest allowed_tools`);
    }
    if (
      requiresCanonicalCatalog &&
      observation.available_tools !== undefined &&
      !catalogsMatch(observation.available_tools, listCatalogToolNames())
    ) {
      reasons.push(`${observation.case_id} imported tools do not match the canonical catalog`);
    }
    if (observation.available_tools === undefined) continue;

    const sortedAvailableTools = [...observation.available_tools].sort();
    if (new Set(sortedAvailableTools).size !== sortedAvailableTools.length) {
      reasons.push(`${observation.case_id} imported duplicate MCP tool names`);
    }
    if (
      sortedAllowedTools !== undefined &&
      (sortedAllowedTools.length !== sortedAvailableTools.length ||
        sortedAllowedTools.some((tool, index) => tool !== sortedAvailableTools[index]))
    ) {
      reasons.push(`${observation.case_id} imported tools do not match manifest allowed_tools`);
    }
    if (observedAvailableTools === undefined) {
      observedAvailableTools = sortedAvailableTools;
    } else if (
      observedAvailableTools.length !== sortedAvailableTools.length ||
      observedAvailableTools.some((tool, index) => tool !== sortedAvailableTools[index])
    ) {
      reasons.push(`${observation.case_id} imported a different MCP tool catalog`);
    }
  }

  return reasons.length === 0
    ? Effect.void
    : Effect.fail(new PluginEvalReplayContractError({ reasons }));
};

export const replayPluginEvalObservationSet = Function.dual<
  (
    observationSet: PluginEvalObservationSet,
  ) => (
    suite: PluginEvalSuite,
  ) => Effect.Effect<
    PluginEvalReplayReport,
    PluginEvalReplayContractError | PluginEvalObservationMismatchError
  >,
  (
    suite: PluginEvalSuite,
    observationSet: PluginEvalObservationSet,
  ) => Effect.Effect<
    PluginEvalReplayReport,
    PluginEvalReplayContractError | PluginEvalObservationMismatchError
  >
>(2, (suite, observationSet) =>
  Effect.gen(function* () {
    yield* validateReplayContract(suite, observationSet);
    const casesById = new Map(suite.cases.map((evalCase) => [evalCase.id, evalCase]));
    const scores = yield* Effect.forEach(
      observationSet.observations,
      (
        observation,
      ): Effect.Effect<
        PluginEvalCaseScore,
        PluginEvalReplayContractError | PluginEvalObservationMismatchError
      > => {
        const evalCase = casesById.get(observation.case_id);
        return evalCase === undefined
          ? Effect.fail(
              new PluginEvalReplayContractError({
                reasons: [`observation references unknown case ${observation.case_id}`],
              }),
            )
          : gradePluginEvalObservation(evalCase, observation);
      },
    );
    return buildReplayReport(suite, observationSet, scores);
  }).pipe(
    Effect.withSpan("plugin_evals.replay", {
      attributes: {
        "plugin_eval.run_id": observationSet.manifest.run_id,
        "plugin_eval.suite_id": suite.suite.id,
        "plugin_eval.target": observationSet.manifest.target,
        "plugin_eval.model": observationSet.manifest.model,
      },
    }),
  ),
);
