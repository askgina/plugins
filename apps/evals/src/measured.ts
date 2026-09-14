import type { TaskFamily } from "./data";
import { museReport, perpsPredictionsReport, spotBundleManifest, spotComparison } from "./results";

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
  sourceCommit: string;
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
  campaign: MeasuredCampaign;
  families: Partial<Record<TaskFamily, MeasuredFamilyResult>>;
}

export interface MeasuredCampaign {
  id: "omp-2026-09-11" | "muse-2026-09-14";
  date: string;
  harness: string;
  repetitions: number;
  timeoutMs: number;
  sourceCommit: string;
  executableSourceCommit?: string;
  prUrl?: string;
  prLabel?: string;
  abortedRun?: typeof perpsPredictionsReport.abortedRun;
  limitations: readonly string[];
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
    passRateSortKey: (result.passed / (result.total - result.unscoredTimeouts)) * 100,
  };
}

function spotSourceCommit(runId: string): string {
  const sourceCommit = spotBundleManifest.runs.find((run) => run.runId === runId)?.sourceCommit;
  if (!sourceCommit) throw new Error(`Missing spot source commit for ${runId}`);
  return sourceCommit;
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
    sourceCommit: spotSourceCommit(run.report.runId),
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
    sourceCommit: perpsPredictionsReport.sourceCommit,
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

function museCases(
  family: (typeof museReport.families)[number]["family"],
  run: (typeof museReport.families)[number]["muse"],
): readonly MeasuredCase[] {
  const cases = new Map<string, MeasuredAttempt[]>();
  for (const trial of run.trials) {
    const attempts = cases.get(trial.caseId) ?? [];
    attempts.push({
      modelId: "muse-spark-1.3",
      repetition: trial.repetition,
      verdict: trial.outcome,
      checks: trial.checks ?? {},
      failureCategories: trial.categories,
      durationMs: trial.durationMs ?? 0,
      tokenUsage: trial.tokenUsage ?? {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
    });
    cases.set(trial.caseId, attempts);
  }
  return Array.from(cases, ([id, attempts]) => ({
    id,
    ...(family === "spot"
      ? {
          prompt: spotComparison.casePrompts[id as keyof typeof spotComparison.casePrompts],
        }
      : {}),
    results: attempts.map((attempt) => attempt.verdict),
    passed: attempts.filter((attempt) => attempt.verdict === "pass").length,
    graded: attempts.filter((attempt) => attempt.verdict !== "timeout").length,
    attempts,
  }));
}

function museResult(entry: (typeof museReport.families)[number]): MeasuredFamilyResult {
  const run = entry.muse;
  const family =
    entry.family === "spot" ? "Spot" : entry.family === "perps" ? "Perps" : "Predictions";
  return familyResult({
    family,
    runId: run.runId,
    sourceCommit: museReport.provenance.runPlan.sourceCommit,
    startedAt: run.startedAt,
    passed: run.counts.passed,
    failed: run.counts.failed,
    unscoredTimeouts: run.counts.unscoredTimeouts,
    total: run.counts.dispatched,
    dimensions: dimensionsFrom(run.dimensions),
    latencyMs: run.latencyMs,
    tokenUsage: {
      input: run.tokenUsage.inputTokens,
      output: run.tokenUsage.outputTokens,
      total: run.tokenUsage.totalTokens,
      observations: run.tokenUsage.observations,
    },
    cases: museCases(entry.family, run),
  });
}

const perpsResults = perpsPredictionsReport.runs.map(perpsResult);

export const ompCampaign = {
  id: "omp-2026-09-11",
  date: perpsPredictionsReport.date,
  repetitions: perpsPredictionsReport.repetitions,
  timeoutMs: perpsPredictionsReport.timeoutMs,
  harness: "OMP harness · native OpenAI OAuth (Gina tools:read)",
  sourceCommit: perpsPredictionsReport.sourceCommit,
  executableSourceCommit: perpsPredictionsReport.executableSourceCommit,
  prUrl: perpsPredictionsReport.prUrl,
  prLabel: "GitHub PR #85",
  abortedRun: perpsPredictionsReport.abortedRun,
  limitations: perpsPredictionsReport.limitations,
} satisfies MeasuredCampaign;

export const museCampaign = {
  id: "muse-2026-09-14",
  date: "2026-09-14",
  harness: "Native Muse client (muse_cli) · medium reasoning",
  repetitions: museReport.repetitions,
  timeoutMs: museReport.timeoutMs,
  sourceCommit: museReport.provenance.runPlan.sourceCommit,
  limitations: museReport.methodology,
} satisfies MeasuredCampaign;

export const measuredCampaigns: readonly MeasuredCampaign[] = [ompCampaign, museCampaign];

const museResults = museReport.families.map(museResult);

export const measuredModels: readonly MeasuredModel[] = [
  {
    id: "gpt-5-5",
    name: "GPT-5.5",
    provider: "OpenAI",
    mark: "◎",
    color: "#3b6f5e",
    source: "measured",
    modelId: "openai-codex/gpt-5.5",
    campaign: ompCampaign,
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
    campaign: ompCampaign,
    families: {
      Spot: spotResult(spotComparison.runs[1]!),
      Perps: perpsResults.find((result) => result.family === "Perps"),
      Predictions: perpsResults.find((result) => result.family === "Predictions"),
    },
  },
  {
    id: "muse-spark-1-3",
    name: "Muse Spark 1.3",
    provider: "Muse",
    mark: "◎",
    color: "#8a4b2f",
    source: "measured",
    modelId: "muse-spark-1.3",
    campaign: museCampaign,
    families: {
      Spot: museResults.find((result) => result.family === "Spot"),
      Perps: museResults.find((result) => result.family === "Perps"),
      Predictions: museResults.find((result) => result.family === "Predictions"),
    },
  },
];

export function getMeasuredModel(id: string): MeasuredModel | undefined {
  return measuredModels.find((model) => model.id === id);
}
