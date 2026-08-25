import { Schema } from "effect";

const NonNegativeIntSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const PositiveIntSchema = Schema.Int.check(Schema.isGreaterThan(0));
const NonEmptyStringArraySchema = Schema.Array(Schema.NonEmptyString).check(Schema.isMinLength(1));
const JsonObjectSchema = Schema.Record(Schema.String, Schema.Json);

export const PluginEvalCategorySchema = Schema.Literals([
  "direct",
  "indirect",
  "negative",
  "confusion_pair",
  "follow_up",
  "boundary",
  "safety",
  "ui",
  "grounding",
]);

export const PluginEvalTargetSchema = Schema.Literals([
  "fixture",
  "responses_api",
  "chatgpt_developer",
  "chatgpt_plugin",
  "browser_replay",
  "codex_cli",
]);

export const PluginEvalTurnSchema = Schema.Struct({
  role: Schema.Literals(["system", "user", "assistant"]),
  content: Schema.NonEmptyString,
});

const ExactRoutingExpectationSchema = Schema.Struct({
  kind: Schema.Literal("exact"),
  tool: Schema.NonEmptyString,
});

const OneOfRoutingExpectationSchema = Schema.Struct({
  kind: Schema.Literal("one_of"),
  tools: NonEmptyStringArraySchema,
});

const SequenceRoutingExpectationSchema = Schema.Struct({
  kind: Schema.Literal("sequence"),
  tools: NonEmptyStringArraySchema,
});

const NoToolRoutingExpectationSchema = Schema.Struct({
  kind: Schema.Literal("none"),
});

export const PluginEvalRoutingExpectationSchema = Schema.Union([
  ExactRoutingExpectationSchema,
  OneOfRoutingExpectationSchema,
  SequenceRoutingExpectationSchema,
  NoToolRoutingExpectationSchema,
]);

export const PluginEvalSkillExpectationSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("exact"), skill: Schema.NonEmptyString }),
  Schema.Struct({ kind: Schema.Literal("none") }),
]);

export const PluginEvalArgumentExpectationSchema = Schema.Struct({
  tool: Schema.optional(Schema.NonEmptyString),
  required: Schema.optional(JsonObjectSchema),
  forbidden_paths: Schema.optional(Schema.Array(Schema.NonEmptyString)),
  allow_additional: Schema.optional(Schema.Boolean),
});

export const PluginEvalSafetyExpectationSchema = Schema.Struct({
  forbidden_tools: Schema.optional(Schema.Array(Schema.NonEmptyString)),
  forbidden_scopes: Schema.optional(Schema.Array(Schema.NonEmptyString)),
});

export const PluginEvalPerformanceExpectationSchema = Schema.Struct({
  max_latency_ms: Schema.optional(PositiveIntSchema),
  max_total_result_bytes: Schema.optional(PositiveIntSchema),
});

export const PluginEvalAnswerExpectationSchema = Schema.Struct({
  kind: Schema.Literals(["not_scored", "grounded", "manual"]),
});

export const PluginEvalExpectationSchema = Schema.Struct({
  skill: Schema.optional(PluginEvalSkillExpectationSchema),
  routing: PluginEvalRoutingExpectationSchema,
  arguments: Schema.optional(PluginEvalArgumentExpectationSchema),
  safety: Schema.optional(PluginEvalSafetyExpectationSchema),
  performance: Schema.optional(PluginEvalPerformanceExpectationSchema),
  answer: Schema.optional(PluginEvalAnswerExpectationSchema),
});

export const PluginEvalCaseSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  category: PluginEvalCategorySchema,
  tags: Schema.Array(Schema.NonEmptyString),
  manual_priority: Schema.Literals(["required", "candidate", "exclude"]),
  turns: Schema.Array(PluginEvalTurnSchema).check(Schema.isMinLength(1)),
  expected: PluginEvalExpectationSchema,
});

export const PluginEvalSuiteSchema = Schema.Struct({
  version: Schema.Literal(1),
  suite: Schema.Struct({
    id: Schema.NonEmptyString,
    plugin: Schema.NonEmptyString,
    catalog_version: Schema.NonEmptyString,
    description: Schema.NonEmptyString,
  }),
  cases: Schema.Array(PluginEvalCaseSchema).check(Schema.isMinLength(1)),
});

export const PluginEvalRunManifestSchema = Schema.Struct({
  version: Schema.Literal(1),
  run_id: Schema.NonEmptyString,
  suite_id: Schema.NonEmptyString,
  suite_version: PositiveIntSchema,
  catalog_version: Schema.NonEmptyString,
  allowed_tools: Schema.optional(NonEmptyStringArraySchema),
  candidate: Schema.NonEmptyString,
  target: PluginEvalTargetSchema,
  model: Schema.NonEmptyString,
  displayed_model: Schema.optional(Schema.NonEmptyString),
  reasoning: Schema.optional(Schema.NonEmptyString),
  started_at: Schema.NonEmptyString,
  repetitions: PositiveIntSchema,
  clean_chat: Schema.Boolean,
  account_class: Schema.NonEmptyString,
  artifact_policy: Schema.Literals(["sanitized", "local_sensitive"]),
});

export const PluginEvalTokenUsageSchema = Schema.Struct({
  input_tokens: NonNegativeIntSchema,
  output_tokens: NonNegativeIntSchema,
  total_tokens: NonNegativeIntSchema,
});

export const PluginEvalToolCallSchema = Schema.Struct({
  sequence: NonNegativeIntSchema,
  name: Schema.NonEmptyString,
  arguments: JsonObjectSchema,
  duration_ms: Schema.optional(NonNegativeIntSchema),
  result_bytes: Schema.optional(NonNegativeIntSchema),
  requested_scope: Schema.optional(Schema.NonEmptyString),
  error: Schema.optional(
    Schema.Struct({
      code: Schema.optional(Schema.NonEmptyString),
      message: Schema.NonEmptyString,
    }),
  ),
});

export const PluginEvalObservationSchema = Schema.Struct({
  version: Schema.Literal(1),
  run_id: Schema.NonEmptyString,
  case_id: Schema.NonEmptyString,
  target: PluginEvalTargetSchema,
  model: Schema.NonEmptyString,
  displayed_model: Schema.optional(Schema.NonEmptyString),
  repetition: PositiveIntSchema,
  started_at: Schema.NonEmptyString,
  status: Schema.Literals(["completed", "failed", "blocked"]),
  duration_ms: NonNegativeIntSchema,
  activated_skills: Schema.optional(Schema.Array(Schema.NonEmptyString)),
  tool_calls: Schema.Array(PluginEvalToolCallSchema),
  available_tools: Schema.optional(Schema.Array(Schema.NonEmptyString)),
  token_usage: Schema.optional(PluginEvalTokenUsageSchema),
  final_answer: Schema.optional(Schema.String),
  error: Schema.optional(Schema.NonEmptyString),
});

export const PluginEvalObservationSetSchema = Schema.Struct({
  version: Schema.Literal(1),
  manifest: PluginEvalRunManifestSchema,
  observations: Schema.Array(PluginEvalObservationSchema).check(Schema.isMinLength(1)),
});

export const PluginEvalDimensionScoreSchema = Schema.Struct({
  score: Schema.Literals([0, 1]),
  details: Schema.Array(Schema.String),
});

export const PluginEvalCaseScoreSchema = Schema.Struct({
  case_id: Schema.NonEmptyString,
  overall_pass: Schema.Boolean,
  routing: PluginEvalDimensionScoreSchema,
  arguments: PluginEvalDimensionScoreSchema,
  safety: PluginEvalDimensionScoreSchema,
  completion: PluginEvalDimensionScoreSchema,
  skill_activation: Schema.optional(PluginEvalDimensionScoreSchema),
  latency_ms: NonNegativeIntSchema,
  total_result_bytes: NonNegativeIntSchema,
});

export const PluginEvalDimensionSummarySchema = Schema.Struct({
  passed: NonNegativeIntSchema,
  failed: NonNegativeIntSchema,
  pass_rate: Schema.NullOr(Schema.Finite),
});

export const PluginEvalDistributionSummarySchema = Schema.Struct({
  p50: NonNegativeIntSchema,
  p95: NonNegativeIntSchema,
  max: NonNegativeIntSchema,
});
export const PluginEvalTokenUsageSummarySchema = Schema.Struct({
  observations: NonNegativeIntSchema,
  input_tokens: NonNegativeIntSchema,
  output_tokens: NonNegativeIntSchema,
  total_tokens: NonNegativeIntSchema,
});

export const PluginEvalReplayReportSchema = Schema.Struct({
  version: Schema.Literal(1),
  run_id: Schema.NonEmptyString,
  suite_id: Schema.NonEmptyString,
  catalog_version: Schema.NonEmptyString,
  allowed_tools: Schema.optional(NonEmptyStringArraySchema),
  available_tools: Schema.optional(Schema.Array(Schema.NonEmptyString)),
  candidate: Schema.NonEmptyString,
  target: PluginEvalTargetSchema,
  model: Schema.NonEmptyString,
  displayed_model: Schema.optional(Schema.NonEmptyString),
  expected_observations: PositiveIntSchema,
  observed: PositiveIntSchema,
  coverage_rate: Schema.Finite,
  overall: PluginEvalDimensionSummarySchema,
  routing: PluginEvalDimensionSummarySchema,
  arguments: PluginEvalDimensionSummarySchema,
  safety: PluginEvalDimensionSummarySchema,
  completion: PluginEvalDimensionSummarySchema,
  skill_activation: PluginEvalDimensionSummarySchema,
  latency_ms: PluginEvalDistributionSummarySchema,
  total_result_bytes: PluginEvalDistributionSummarySchema,
  token_usage: PluginEvalTokenUsageSummarySchema,
  scores: Schema.Array(PluginEvalCaseScoreSchema).check(Schema.isMinLength(1)),
});

export type PluginEvalCase = typeof PluginEvalCaseSchema.Type;
export type PluginEvalSuite = typeof PluginEvalSuiteSchema.Type;
export type PluginEvalRunManifest = typeof PluginEvalRunManifestSchema.Type;
export type PluginEvalTokenUsage = typeof PluginEvalTokenUsageSchema.Type;
export type PluginEvalToolCall = typeof PluginEvalToolCallSchema.Type;
export type PluginEvalObservation = typeof PluginEvalObservationSchema.Type;
export type PluginEvalObservationSet = typeof PluginEvalObservationSetSchema.Type;
export type PluginEvalDimensionScore = typeof PluginEvalDimensionScoreSchema.Type;
export type PluginEvalCaseScore = typeof PluginEvalCaseScoreSchema.Type;
export type PluginEvalDimensionSummary = typeof PluginEvalDimensionSummarySchema.Type;
export type PluginEvalDistributionSummary = typeof PluginEvalDistributionSummarySchema.Type;
export type PluginEvalTokenUsageSummary = typeof PluginEvalTokenUsageSummarySchema.Type;
export type PluginEvalReplayReport = typeof PluginEvalReplayReportSchema.Type;
