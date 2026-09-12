import publicationRaw from "../../../../ai_docs/evals-handoff/planning/fixtures/synthetic-publication-correction-rev2.json?raw";
import indexRaw from "../../../../ai_docs/evals-handoff/planning/fixtures/synthetic-index.json?raw";
import {
  buildPublicComparisonCatalog,
  type PublicComparisonCatalog,
  type PublicDimensionId,
  type PublicComparisonRow,
} from "../lib/public-comparison";
import { parsePublicArtifact } from "../lib/public-results";

const encoded = (value: string): ArrayBuffer => new TextEncoder().encode(value).buffer;
const publicationArtifact = parsePublicArtifact(encoded(publicationRaw));
const indexArtifact = parsePublicArtifact(encoded(indexRaw));

if (publicationArtifact.kind !== "publication" || indexArtifact.kind !== "index") {
  throw new Error("Canonical public comparison fixtures are invalid");
}

export const verifiedSyntheticCatalog = buildPublicComparisonCatalog(
  [publicationArtifact.publication],
  indexArtifact.index,
);

interface SyntheticCandidateSpec {
  id: string;
  model: string;
  reasoning: string;
  passed: number;
  latency: { p50: number; p95: number; max: number };
  tokens: { input: number; output: number };
  dimensions: Record<PublicDimensionId, { passed: number; failed: number; notApplicable: number }>;
}

const syntheticCandidateSpecs: readonly SyntheticCandidateSpec[] = [
  {
    id: "synthetic-candidate-a",
    model: "synthetic-model-a",
    reasoning: "synthetic-reasoning-medium",
    passed: 7,
    latency: { p50: 1200, p95: 2400, max: 2400 },
    tokens: { input: 7440, output: 1840 },
    dimensions: {
      routing: { passed: 8, failed: 0, notApplicable: 0 },
      arguments: { passed: 7, failed: 1, notApplicable: 0 },
      safety: { passed: 6, failed: 0, notApplicable: 2 },
      completion: { passed: 7, failed: 1, notApplicable: 0 },
      skillActivation: { passed: 6, failed: 0, notApplicable: 2 },
    },
  },
  {
    id: "synthetic-candidate-b",
    model: "synthetic-model-b",
    reasoning: "synthetic-reasoning-high",
    passed: 8,
    latency: { p50: 1860, p95: 3100, max: 3420 },
    tokens: { input: 10_940, output: 2860 },
    dimensions: {
      routing: { passed: 8, failed: 0, notApplicable: 0 },
      arguments: { passed: 8, failed: 0, notApplicable: 0 },
      safety: { passed: 7, failed: 0, notApplicable: 1 },
      completion: { passed: 8, failed: 0, notApplicable: 0 },
      skillActivation: { passed: 7, failed: 0, notApplicable: 1 },
    },
  },
  {
    id: "synthetic-candidate-c",
    model: "synthetic-model-c",
    reasoning: "synthetic-reasoning-low",
    passed: 6,
    latency: { p50: 720, p95: 1410, max: 1680 },
    tokens: { input: 6020, output: 1390 },
    dimensions: {
      routing: { passed: 7, failed: 1, notApplicable: 0 },
      arguments: { passed: 6, failed: 2, notApplicable: 0 },
      safety: { passed: 5, failed: 1, notApplicable: 2 },
      completion: { passed: 6, failed: 2, notApplicable: 0 },
      skillActivation: { passed: 5, failed: 1, notApplicable: 2 },
    },
  },
  {
    id: "synthetic-candidate-d",
    model: "synthetic-model-d",
    reasoning: "synthetic-reasoning-medium",
    passed: 5,
    latency: { p50: 960, p95: 1780, max: 2050 },
    tokens: { input: 4880, output: 1120 },
    dimensions: {
      routing: { passed: 7, failed: 1, notApplicable: 0 },
      arguments: { passed: 5, failed: 3, notApplicable: 0 },
      safety: { passed: 4, failed: 2, notApplicable: 2 },
      completion: { passed: 5, failed: 3, notApplicable: 0 },
      skillActivation: { passed: 4, failed: 2, notApplicable: 2 },
    },
  },
  {
    id: "synthetic-candidate-e",
    model: "synthetic-model-e",
    reasoning: "synthetic-reasoning-high",
    passed: 7,
    latency: { p50: 2260, p95: 3940, max: 4280 },
    tokens: { input: 12_260, output: 3180 },
    dimensions: {
      routing: { passed: 8, failed: 0, notApplicable: 0 },
      arguments: { passed: 7, failed: 1, notApplicable: 0 },
      safety: { passed: 7, failed: 0, notApplicable: 1 },
      completion: { passed: 7, failed: 1, notApplicable: 0 },
      skillActivation: { passed: 7, failed: 0, notApplicable: 1 },
    },
  },
];

const syntheticRow = (
  base: PublicComparisonRow,
  spec: SyntheticCandidateSpec,
  index: number,
): PublicComparisonRow => {
  const totalTokens = spec.tokens.input + spec.tokens.output;
  const counts = {
    attempts: { total: 8, passed: spec.passed, failed: 8 - spec.passed },
    cases: {
      total: 4,
      passedEveryAttempt: Math.max(0, spec.passed - 4),
      failedAnyAttempt: Math.min(4, 8 - spec.passed),
    },
  };
  const configuration = {
    ...base.configuration,
    candidate: spec.id,
    model: spec.model,
    reasoning: spec.reasoning,
    pinnedSha256: `${String(index + 1).repeat(64)}`,
  };
  return {
    ...base,
    id: spec.id,
    publicationId: `synthetic-publication-story-${index + 1}`,
    revisionId: `synthetic-publication-story-${index + 1}-rev1`,
    candidate: spec.id,
    model: spec.model,
    reasoning: spec.reasoning,
    configuration,
    counts,
    dimensions: spec.dimensions,
    metrics: {
      ...base.metrics,
      passRate: {
        availability: "available",
        value: spec.passed / 8,
        unit: "ratio",
        numerator: spec.passed,
        denominator: 8,
        sampleCount: 8,
        detail: `${spec.passed} of 8 attempts passed`,
      },
      latencyP50: {
        availability: "available",
        value: spec.latency.p50,
        unit: "milliseconds",
        numerator: null,
        denominator: null,
        sampleCount: 8,
        detail: "8 observed attempts",
      },
      latencyP95: {
        availability: "available",
        value: spec.latency.p95,
        unit: "milliseconds",
        numerator: null,
        denominator: null,
        sampleCount: 8,
        detail: "8 observed attempts",
      },
      latencyMax: {
        availability: "available",
        value: spec.latency.max,
        unit: "milliseconds",
        numerator: null,
        denominator: null,
        sampleCount: 8,
        detail: "8 observed attempts",
      },
      tokenUsage: {
        availability: "available",
        value: totalTokens,
        unit: "tokens",
        numerator: null,
        denominator: null,
        sampleCount: 8,
        detail: `${spec.tokens.input} input + ${spec.tokens.output} output tokens`,
      },
    },
  };
};

export const syntheticFieldCatalog: PublicComparisonCatalog = {
  ...verifiedSyntheticCatalog,
  cohorts: verifiedSyntheticCatalog.cohorts.map((cohort, index) => {
    const base = cohort.rows[0];
    return index === 0 && base !== undefined
      ? {
          ...cohort,
          rows: syntheticCandidateSpecs.map((spec, rowIndex) => syntheticRow(base, spec, rowIndex)),
        }
      : cohort;
  }),
};

const replaceOnlyRow = (
  catalog: PublicComparisonCatalog,
  update: (row: PublicComparisonRow) => PublicComparisonRow,
): PublicComparisonCatalog => ({
  ...catalog,
  cohorts: catalog.cohorts.map((cohort, index) =>
    index === 0 ? { ...cohort, rows: cohort.rows.map(update) } : cohort,
  ),
});

export const incompleteCoverageCatalog = replaceOnlyRow(verifiedSyntheticCatalog, (row) => ({
  ...row,
  coverage: { ...row.coverage, status: "incomplete" },
  metrics: {
    ...row.metrics,
    passRate: {
      availability: "withheld",
      reason: "incomplete_coverage",
      unit: "unavailable",
    },
  },
  unrankedReasons: ["pilot", "synthetic", "incomplete_coverage"],
}));

export const aggregateOnlyCatalog = replaceOnlyRow(verifiedSyntheticCatalog, (row) => ({
  ...row,
  evidence: "aggregate_only",
}));

export const emptyPublicCatalog: PublicComparisonCatalog = {
  ...verifiedSyntheticCatalog,
  cohorts: [],
};
