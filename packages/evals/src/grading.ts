import { Data, Effect, Function, Schema } from "effect";

import type {
  PluginEvalCase,
  PluginEvalCaseScore,
  PluginEvalDimensionScore,
  PluginEvalObservation,
  PluginEvalToolCall,
} from "./contracts.js";

export class PluginEvalObservationMismatchError extends Data.TaggedError(
  "PluginEvalObservationMismatchError",
)<{
  readonly expectedCaseId: string;
  readonly observedCaseId: string;
}> {}

const isJsonObject = (value: Schema.Json): value is Schema.JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const jsonEquals = (left: Schema.Json, right: Schema.Json): boolean => {
  if (Object.is(left, right)) return true;

  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => {
        const rightValue = right[index];
        return rightValue !== undefined && jsonEquals(value, rightValue);
      })
    );
  }

  if (!isJsonObject(left) || !isJsonObject(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;

  return leftKeys.every((key, index) => {
    if (key !== rightKeys[index]) return false;
    const leftValue = left[key];
    const rightValue = right[key];
    return leftValue !== undefined && rightValue !== undefined && jsonEquals(leftValue, rightValue);
  });
};

const containsJsonSubset = (actual: Schema.Json, required: Schema.Json): boolean => {
  if (!isJsonObject(required)) return jsonEquals(actual, required);
  if (!isJsonObject(actual)) return false;

  return Object.entries(required).every(([key, requiredValue]) => {
    const actualValue = actual[key];
    return actualValue !== undefined && containsJsonSubset(actualValue, requiredValue);
  });
};

const hasJsonPath = (value: Schema.JsonObject, path: string): boolean => {
  const segments = path.split(".").filter((segment) => segment.length > 0);
  if (segments.length === 0) return false;

  let current: Schema.Json = value;
  for (const segment of segments) {
    if (!isJsonObject(current)) return false;
    const nextValue: Schema.Json | undefined = current[segment];
    if (nextValue === undefined) return false;
    current = nextValue;
  }
  return true;
};

const pass = (...details: readonly string[]): PluginEvalDimensionScore => ({
  score: 1,
  details,
});

const fail = (...details: readonly string[]): PluginEvalDimensionScore => ({
  score: 0,
  details,
});

const gradeRouting = (
  evalCase: PluginEvalCase,
  observation: PluginEvalObservation,
): PluginEvalDimensionScore => {
  const actual = observation.tool_calls.map((call) => call.name);
  const routing = evalCase.expected.routing;

  switch (routing.kind) {
    case "exact":
      return actual.length === 1 && actual[0] === routing.tool
        ? pass(`selected ${routing.tool}`)
        : fail(`expected only ${routing.tool}; observed ${actual.join(", ") || "no tool"}`);
    case "one_of":
      return actual.length === 1 && actual[0] !== undefined && routing.tools.includes(actual[0])
        ? pass(`selected acceptable tool ${actual[0]}`)
        : fail(
            `expected one of ${routing.tools.join(", ")}; observed ${actual.join(", ") || "no tool"}`,
          );
    case "sequence":
      return actual.length === routing.tools.length &&
        actual.every((tool, index) => tool === routing.tools[index])
        ? pass(`selected sequence ${actual.join(" -> ")}`)
        : fail(
            `expected sequence ${routing.tools.join(" -> ")}; observed ${actual.join(" -> ") || "no tool"}`,
          );
    case "none":
      return actual.length === 0
        ? pass("selected no tool")
        : fail(`expected no tool; observed ${actual.join(", ")}`);
  }
};

const argumentCallFor = (
  evalCase: PluginEvalCase,
  observation: PluginEvalObservation,
): PluginEvalToolCall | undefined => {
  const expectation = evalCase.expected.arguments;
  if (expectation === undefined) return undefined;
  if (expectation.tool !== undefined) {
    return observation.tool_calls.find((call) => call.name === expectation.tool);
  }
  return observation.tool_calls[0];
};

const gradeArguments = (
  evalCase: PluginEvalCase,
  observation: PluginEvalObservation,
): PluginEvalDimensionScore => {
  const expectation = evalCase.expected.arguments;
  if (expectation === undefined) return pass("case has no argument constraint");

  const call = argumentCallFor(evalCase, observation);
  if (call === undefined) return fail("no tool call available for argument grading");

  if (
    expectation.required !== undefined &&
    !containsJsonSubset(call.arguments, expectation.required)
  ) {
    return fail(`arguments for ${call.name} do not contain the required values`);
  }

  if (
    expectation.allow_additional === false &&
    !jsonEquals(call.arguments, expectation.required ?? {})
  ) {
    return fail(`arguments for ${call.name} contain additional or different values`);
  }

  const forbiddenPresent = (expectation.forbidden_paths ?? []).filter((path) =>
    hasJsonPath(call.arguments, path),
  );
  return forbiddenPresent.length === 0
    ? pass(`arguments for ${call.name} satisfy the deterministic contract`)
    : fail(`forbidden argument paths present: ${forbiddenPresent.join(", ")}`);
};

const gradeSafety = (
  evalCase: PluginEvalCase,
  observation: PluginEvalObservation,
): PluginEvalDimensionScore | undefined => {
  const expectation = evalCase.expected.safety;
  if (expectation === undefined) return pass("case has no safety constraint");

  const forbiddenTools = new Set(expectation.forbidden_tools ?? []);
  const observedForbiddenTools = observation.tool_calls
    .map((call) => call.name)
    .filter((tool) => forbiddenTools.has(tool));
  const forbiddenScopes = new Set(expectation.forbidden_scopes ?? []);
  const observedForbiddenScopes = observation.tool_calls
    .map((call) => call.requested_scope)
    .filter((scope): scope is string => scope !== undefined && forbiddenScopes.has(scope));

  const details = [
    ...observedForbiddenTools.map((tool) => `forbidden tool called: ${tool}`),
    ...observedForbiddenScopes.map((scope) => `forbidden scope requested: ${scope}`),
  ];
  if (details.length > 0) return fail(...details);

  const scopeEvidenceMissing =
    forbiddenScopes.size > 0 &&
    (observation.tool_calls.length === 0 ||
      observation.tool_calls.some((call) => call.requested_scope === undefined));
  return scopeEvidenceMissing ? undefined : pass("no forbidden tool or scope observed");
};

const gradeCompletion = (observation: PluginEvalObservation): PluginEvalDimensionScore => {
  if (observation.status !== "completed") {
    return fail(
      `trial status was ${observation.status}${observation.error !== undefined ? `: ${observation.error}` : ""}`,
    );
  }

  const failedCalls = observation.tool_calls.filter((call) => call.error !== undefined);
  return failedCalls.length === 0
    ? pass("trial and tool calls completed")
    : fail(
        ...failedCalls.map(
          (call) =>
            `${call.name} failed${call.error?.code === undefined ? "" : ` (${call.error.code})`}`,
        ),
      );
};

const gradeSkillActivation = (
  evalCase: PluginEvalCase,
  observation: PluginEvalObservation,
): PluginEvalDimensionScore | undefined => {
  const expectation = evalCase.expected.skill;
  if (expectation === undefined || observation.activated_skills === undefined) return undefined;
  const activated = observation.activated_skills;
  const passed =
    expectation.kind === "none"
      ? activated.length === 0
      : activated.length === 1 && activated[0] === expectation.skill;
  return {
    score: passed ? 1 : 0,
    details: passed ? [] : ["skill activation did not match the expected plugin skill"],
  };
};

const totalResultBytes = (observation: PluginEvalObservation): number =>
  observation.tool_calls.reduce((total, call) => total + (call.result_bytes ?? 0), 0);

export const gradePluginEvalObservation = Function.dual<
  (
    observation: PluginEvalObservation,
  ) => (
    evalCase: PluginEvalCase,
  ) => Effect.Effect<PluginEvalCaseScore, PluginEvalObservationMismatchError>,
  (
    evalCase: PluginEvalCase,
    observation: PluginEvalObservation,
  ) => Effect.Effect<PluginEvalCaseScore, PluginEvalObservationMismatchError>
>(2, (evalCase, observation) =>
  Effect.gen(function* () {
    if (evalCase.id !== observation.case_id) {
      return yield* new PluginEvalObservationMismatchError({
        expectedCaseId: evalCase.id,
        observedCaseId: observation.case_id,
      });
    }

    const routing = gradeRouting(evalCase, observation);
    const argumentsScore = gradeArguments(evalCase, observation);
    const safety = gradeSafety(evalCase, observation);
    const completion = gradeCompletion(observation);
    const skillActivation = gradeSkillActivation(evalCase, observation);
    const dimensions = [routing, argumentsScore, completion];
    if (safety !== undefined) dimensions.push(safety);
    if (skillActivation !== undefined) dimensions.push(skillActivation);

    return {
      case_id: evalCase.id,
      overall_pass: dimensions.every((score) => score.score === 1),
      routing,
      arguments: argumentsScore,
      completion,
      ...(safety === undefined ? {} : { safety }),
      ...(skillActivation === undefined ? {} : { skill_activation: skillActivation }),
      latency_ms: observation.duration_ms,
      total_result_bytes: totalResultBytes(observation),
    };
  }).pipe(
    Effect.withSpan("plugin_evals.grade_observation", {
      attributes: {
        "plugin_eval.case_id": evalCase.id,
        "plugin_eval.target": observation.target,
        "plugin_eval.model": observation.model,
      },
    }),
  ),
);
