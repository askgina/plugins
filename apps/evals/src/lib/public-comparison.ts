import type {
  PublicEvalDataOrigin,
  PublicEvalEvidenceAvailability,
  PublicEvalIndex,
  PublicEvalPublication,
  PublicEvalResult,
  PublicEvalUnrankedReason,
} from "@askgina/contracts";
import {
  assessPublicationAgainstIndex,
  parsePublicArtifact,
  publicArtifactSha256,
} from "./public-results";

export type PublicMetricId =
  | "passRate"
  | "latencyP50"
  | "latencyP95"
  | "latencyMax"
  | "tokenUsage"
  | "answerAccuracy"
  | "usdCost"
  | "uncertainty";

export type PublicMetricUnit = "ratio" | "milliseconds" | "tokens" | "unavailable";

export interface PublicMetricDefinition {
  id: PublicMetricId;
  label: string;
  description: string;
  unit: PublicMetricUnit;
}

export const PUBLIC_METRIC_DEFINITIONS = [
  {
    id: "passRate",
    label: "Pass rate",
    description: "Passed attempts divided by all observed attempts, with complete coverage.",
    unit: "ratio",
  },
  {
    id: "latencyP50",
    label: "p50 latency",
    description: "Nearest-rank median duration over observed attempts.",
    unit: "milliseconds",
  },
  {
    id: "latencyP95",
    label: "p95 latency",
    description: "Nearest-rank 95th percentile duration over observed attempts.",
    unit: "milliseconds",
  },
  {
    id: "latencyMax",
    label: "Maximum latency",
    description: "Longest observed attempt duration.",
    unit: "milliseconds",
  },
  {
    id: "tokenUsage",
    label: "Total tokens",
    description: "Input and output tokens over attempts that retained usage.",
    unit: "tokens",
  },
  {
    id: "answerAccuracy",
    label: "Answer accuracy",
    description: "Unavailable in the v1 public contract without a declared method.",
    unit: "unavailable",
  },
  {
    id: "usdCost",
    label: "USD cost",
    description: "Unavailable in the v1 public contract without a declared method.",
    unit: "unavailable",
  },
  {
    id: "uncertainty",
    label: "Uncertainty",
    description: "Unavailable in the v1 public contract without a declared method.",
    unit: "unavailable",
  },
] as const satisfies readonly PublicMetricDefinition[];

export const SUMMARY_METRIC_IDS = ["passRate", "latencyP50", "tokenUsage"] as const;

type UnavailableMetric = PublicEvalResult["metrics"]["answerAccuracy"];

export type PublicMetricValue =
  | {
      availability: "available";
      value: number;
      unit: Exclude<PublicMetricUnit, "unavailable">;
      numerator: number | null;
      denominator: number | null;
      sampleCount: number;
      detail: string;
    }
  | {
      availability: "not_evaluated" | "not_applicable" | "not_retained" | "withheld";
      reason: "no_declared_method" | "incomplete_coverage" | "not_captured" | "privacy_review";
      unit: "unavailable";
    };

export const PUBLIC_DIMENSION_DEFINITIONS = [
  { id: "routing", label: "Routing" },
  { id: "arguments", label: "Arguments" },
  { id: "safety", label: "Safety" },
  { id: "completion", label: "Completion" },
  { id: "skillActivation", label: "Skill activation" },
] as const;

export type PublicDimensionId = (typeof PUBLIC_DIMENSION_DEFINITIONS)[number]["id"];

export interface PublicComparisonRow {
  id: string;
  publicationId: string;
  revisionId: string;
  candidate: string;
  model: string;
  reasoning: string | null;
  dataOrigin: PublicEvalDataOrigin;
  startedAt: string;
  publishedAt: string;
  configuration: PublicEvalResult["configuration"];
  coverage: PublicEvalResult["coverage"];
  counts: PublicEvalResult["counts"];
  dimensions: PublicEvalResult["dimensions"];
  metrics: Readonly<Record<PublicMetricId, PublicMetricValue>>;
  evidence: PublicEvalEvidenceAvailability;
  unrankedReasons: readonly PublicEvalUnrankedReason[];
  result: PublicEvalResult;
  publication: PublicEvalPublication;
}

export interface PublicComparisonConditions {
  suiteId: string;
  suiteVersion: number;
  fixtureVersion: number;
  catalogSha: string;
  target: string;
  accountClass: string;
  cleanChat: true;
  repetitions: number;
}

export interface PublicComparisonCohort {
  id: string;
  conditions: PublicComparisonConditions;
  rows: readonly PublicComparisonRow[];
}

export interface PublicComparisonCatalog {
  generatedAt: string;
  dataOrigin: PublicEvalDataOrigin;
  cohorts: readonly PublicComparisonCohort[];
  withdrawnCount: number;
}

const unavailable = (
  metric:
    | PublicEvalResult["metrics"]["answerAccuracy"]
    | PublicEvalResult["metrics"]["passRate"]
    | PublicEvalResult["metrics"]["latencyMs"]
    | PublicEvalResult["metrics"]["tokenUsage"],
): PublicMetricValue => {
  if (metric.availability === "available") {
    throw new Error("Expected an unavailable metric");
  }
  const missing = metric as UnavailableMetric;
  return { availability: missing.availability, reason: missing.reason, unit: "unavailable" };
};

const available = (
  value: number,
  unit: Exclude<PublicMetricUnit, "unavailable">,
  sampleCount: number,
  detail: string,
  numerator: number | null = null,
  denominator: number | null = null,
): PublicMetricValue => ({
  availability: "available",
  value,
  unit,
  numerator,
  denominator,
  sampleCount,
  detail,
});

function comparisonMetrics(
  result: PublicEvalResult,
): Readonly<Record<PublicMetricId, PublicMetricValue>> {
  const { metrics } = result;
  const passRate =
    metrics.passRate.availability === "available"
      ? available(
          metrics.passRate.value,
          "ratio",
          metrics.passRate.denominator,
          `${metrics.passRate.numerator} of ${metrics.passRate.denominator} attempts passed`,
          metrics.passRate.numerator,
          metrics.passRate.denominator,
        )
      : unavailable(metrics.passRate);
  const latency = metrics.latencyMs;
  const latencyMetric = (field: "p50" | "p95" | "max"): PublicMetricValue =>
    latency.availability === "available"
      ? available(
          latency[field],
          "milliseconds",
          latency.sampleCount,
          `${latency.sampleCount} observed attempts`,
        )
      : unavailable(latency);
  const tokenUsage =
    metrics.tokenUsage.availability === "available"
      ? available(
          metrics.tokenUsage.totalTokens,
          "tokens",
          metrics.tokenUsage.sampleCount,
          `${metrics.tokenUsage.inputTokens} input + ${metrics.tokenUsage.outputTokens} output tokens`,
        )
      : unavailable(metrics.tokenUsage);

  return {
    passRate,
    latencyP50: latencyMetric("p50"),
    latencyP95: latencyMetric("p95"),
    latencyMax: latencyMetric("max"),
    tokenUsage,
    answerAccuracy: unavailable(metrics.answerAccuracy),
    usdCost: unavailable(metrics.usdCost),
    uncertainty: unavailable(metrics.uncertainty),
  };
}

const cohortConditions = (result: PublicEvalResult): PublicComparisonConditions => ({
  suiteId: result.benchmark.suiteId,
  suiteVersion: result.benchmark.suiteVersion,
  fixtureVersion: result.benchmark.fixtureVersion,
  catalogSha: result.benchmark.catalogSha,
  target: result.benchmark.target,
  accountClass: result.benchmark.accountClass,
  cleanChat: result.benchmark.cleanChat,
  repetitions: result.benchmark.repetitions,
});

const cohortId = (conditions: PublicComparisonConditions): string =>
  [
    conditions.suiteId,
    conditions.suiteVersion,
    conditions.fixtureVersion,
    conditions.catalogSha,
    conditions.target,
    conditions.accountClass,
    conditions.cleanChat,
    conditions.repetitions,
  ].join(":");

export function buildPublicComparisonCatalog(
  publications: readonly PublicEvalPublication[],
  index: PublicEvalIndex,
): PublicComparisonCatalog {
  const grouped = new Map<
    string,
    { conditions: PublicComparisonConditions; rows: PublicComparisonRow[] }
  >();

  for (const publication of publications) {
    if (publication.content.kind !== "result") continue;
    const result = publication.content.result;
    const conditions = cohortConditions(result);
    const id = cohortId(conditions);
    const group = grouped.get(id) ?? { conditions, rows: [] };
    group.rows.push({
      id: result.configuration.candidate,
      publicationId: publication.publicationId,
      revisionId: publication.revisionId,
      candidate: result.configuration.candidate,
      model: result.configuration.model,
      reasoning: result.configuration.reasoning,
      dataOrigin: result.dataOrigin,
      startedAt: result.run.startedAt,
      publishedAt: publication.publishedAt,
      configuration: result.configuration,
      coverage: result.coverage,
      counts: result.counts,
      dimensions: result.dimensions,
      metrics: comparisonMetrics(result),
      evidence: result.evidence.attemptDetail,
      unrankedReasons: result.ranking.reasons,
      result,
      publication,
    });
    grouped.set(id, group);
  }

  return {
    generatedAt: index.generatedAt,
    dataOrigin: index.dataOrigin,
    cohorts: [...grouped.entries()].map(([id, group]) => ({ id, ...group })),
    withdrawnCount: index.publications.filter((entry) => entry.status === "withdrawn").length,
  };
}

export interface PublicArtifactSource {
  publicationRaw: string;
  indexRaw: string;
}

const bytes = (value: string): ArrayBuffer => new TextEncoder().encode(value).buffer;

export function loadPublicComparisonCatalog({
  publicationRaw,
  indexRaw,
}: PublicArtifactSource): Promise<PublicComparisonCatalog> {
  const publicationBytes = bytes(publicationRaw);
  const parsedPublication = parsePublicArtifact(publicationBytes);
  const parsedIndex = parsePublicArtifact(bytes(indexRaw));
  if (parsedPublication.kind !== "publication") {
    return Promise.reject(
      new Error(
        parsedPublication.kind === "unsupported"
          ? parsedPublication.message
          : "The bundled public result is not a publication.",
      ),
    );
  }
  if (parsedIndex.kind !== "index") {
    return Promise.reject(
      new Error(
        parsedIndex.kind === "unsupported"
          ? parsedIndex.message
          : "The bundled public result index is unavailable.",
      ),
    );
  }
  return publicArtifactSha256(publicationBytes).then((hash) => {
    const assessment = assessPublicationAgainstIndex(
      parsedPublication.publication,
      parsedIndex.index,
      hash,
    );
    if (assessment.status !== "current") {
      throw new Error(assessment.message ?? "The bundled publication is not current.");
    }
    return buildPublicComparisonCatalog([parsedPublication.publication], parsedIndex.index);
  });
}

export function findComparisonRow(
  catalog: PublicComparisonCatalog,
  candidateId?: string,
): PublicComparisonRow | undefined {
  const rows = catalog.cohorts.flatMap((cohort) => cohort.rows);
  if (candidateId === undefined) return rows[0];
  return rows.find((row) => row.id === candidateId);
}

export const metricValue = (row: PublicComparisonRow, id: PublicMetricId): PublicMetricValue =>
  row.metrics[id];
