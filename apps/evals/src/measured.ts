import type { TaskFamily } from "./data";
import { perpsPredictionsReport, spotComparison } from "./results";

export type MeasuredVerdict = "pass" | "fail" | "timeout";

export interface MeasuredDimension {
  passed: number;
  failed: number;
}

export interface MeasuredAttempt {
  modelId: string;
  repetition: number;
  verdict: string;
  checks: Record<string, string>;
  failureCategories: readonly string[];
  durationMs: number;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

export interface MeasuredCase {
  id: string;
  prompt?: string;
  results: readonly string[];
  passed: number;
  graded: number;
  notes?: string;
  attempts?: readonly MeasuredAttempt[];
}

export interface MeasuredFamilyResult {
  family: TaskFamily;
  runId: string;
  startedAt?: string;
  passed: number;
  failed: number;
  unscoredTimeouts: number;
  total: number;
  dimensions: Record<"routing" | "arguments" | "completion" | "safety", MeasuredDimension>;
  latencyMs: { p50: number; p95: number; max: number };
  tokenUsage: { input: number; output: number; total: number; observations: number };
  cases: readonly MeasuredCase[];
  passRateSortKey: number;
}

export interface MeasuredModel {
  id: string;
  name: string;
  provider: string;
  mark: string;
  color: string;
  source: "measured";
  modelId: string;
  families: Partial<Record<TaskFamily, MeasuredFamilyResult>>;
}

const dimensionNames = ["routing", "arguments", "completion", "safety"] as const;

function dimensionsFrom(dimensions: {
  routing: { passed: number; failed: number };
  arguments: { passed: number; failed: number };
  completion: { passed: number; failed: number };
  safety: { passed: number; failed: number };
}): MeasuredFamilyResult["dimensions"] {
  return Object.fromEntries(
    dimensionNames.map((name) => [name, dimensions[name]]),
  ) as MeasuredFamilyResult["dimensions"];
}

function familyResult(result: Omit<MeasuredFamilyResult, "passRateSortKey">): MeasuredFamilyResult {
  return {
    ...result,
    passRateSortKey: (result.passed / result.total) * 100,
  };
}

function spotCases(run: (typeof spotComparison.runs)[number]): readonly MeasuredCase[] {
  const cases = new Map<string, { attempts: MeasuredAttempt[]; prompt?: string }>();
  for (const attempt of run.attempts.attempts) {
    const entry = cases.get(attempt.caseId) ?? {
      attempts: [],
      prompt: spotComparison.casePrompts[attempt.caseId as keyof typeof spotComparison.casePrompts],
    };
    entry.attempts.push({
      modelId: run.report.model,
      repetition: attempt.repetition,
      verdict: attempt.verdict,
      checks: attempt.checks,
      failureCategories: attempt.failureCategories,
      durationMs: attempt.durationMs,
      tokenUsage: attempt.tokenUsage,
    });
    cases.set(attempt.caseId, entry);
  }
  return Array.from(cases, ([id, entry]) => ({
    id,
    ...(entry.prompt === undefined ? {} : { prompt: entry.prompt }),
    results: entry.attempts.map((attempt) => attempt.verdict),
    passed: entry.attempts.filter((attempt) => attempt.verdict === "pass").length,
    graded: entry.attempts.filter((attempt) => attempt.verdict !== "timeout").length,
    attempts: entry.attempts,
  }));
}

function spotResult(run: (typeof spotComparison.runs)[number]): MeasuredFamilyResult {
  const aggregate = run.report.aggregate;
  return familyResult({
    family: "Spot",
    runId: run.report.runId,
    startedAt: run.report.startedAt,
    passed: aggregate.overall.passed,
    failed: aggregate.overall.total - aggregate.overall.passed,
    unscoredTimeouts: 0,
    total: aggregate.overall.total,
    dimensions: dimensionsFrom(aggregate.dimensions),
    latencyMs: aggregate.latencyMs,
    tokenUsage: {
      input: aggregate.tokenUsage.inputTokens,
      output: aggregate.tokenUsage.outputTokens,
      total: aggregate.tokenUsage.totalTokens,
      observations: aggregate.tokenUsage.observations,
    },
    cases: spotCases(run),
  });
}

function perpsResult(run: (typeof perpsPredictionsReport.runs)[number]): MeasuredFamilyResult {
  const family = run.family === "perps" ? "Perps" : "Predictions";
  return familyResult({
    family,
    runId: run.runId,
    passed: run.passed,
    failed: run.failed,
    unscoredTimeouts: run.unscoredTimeouts,
    total: run.dispatched,
    dimensions: dimensionsFrom(run.dimensions),
    latencyMs: run.latencyMs,
    tokenUsage: run.tokenUsage,
    cases: run.cases,
  });
}

const perpsResults = perpsPredictionsReport.runs.map(perpsResult);

export const measuredRun = {
  date: perpsPredictionsReport.date,
  generatedAt: perpsPredictionsReport.generatedAt,
  repetitions: perpsPredictionsReport.repetitions,
  timeoutMs: perpsPredictionsReport.timeoutMs,
  prUrl: perpsPredictionsReport.prUrl,
  sourceCommit: perpsPredictionsReport.sourceCommit,
  executableSourceCommit: perpsPredictionsReport.executableSourceCommit,
  harness: "OMP harness · native OpenAI OAuth (Gina tools:read)",
  abortedRun: perpsPredictionsReport.abortedRun,
  limitations: perpsPredictionsReport.limitations,
} as const;

export const measuredModels: readonly MeasuredModel[] = [
  {
    id: "gpt-5-5",
    name: "GPT-5.5",
    provider: "OpenAI",
    mark: "◎",
    color: "#3b6f5e",
    source: "measured",
    modelId: "openai-codex/gpt-5.5",
    families: {
      Spot: spotResult(spotComparison.runs[0]!),
    },
  },
  {
    id: "gpt-5-6-sol",
    name: "GPT-5.6 Sol",
    provider: "OpenAI",
    mark: "◎",
    color: "#2f5d8a",
    source: "measured",
    modelId: "openai-codex/gpt-5.6-sol",
    families: {
      Spot: spotResult(spotComparison.runs[1]!),
      Perps: perpsResults.find((result) => result.family === "Perps"),
      Predictions: perpsResults.find((result) => result.family === "Predictions"),
    },
  },
];

export function getMeasuredModel(id: string): MeasuredModel | undefined {
  return measuredModels.find((model) => model.id === id);
}
