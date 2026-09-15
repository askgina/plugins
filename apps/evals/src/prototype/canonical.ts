// Canonical eval-browsing dataset for the `#/prototype/*` pages.
//
// This module is the single source of truth for the prototype domain records:
// case definitions, runs, attempts, configurations, cohorts, campaigns and
// publications. Measured values are transformed directly from the bundled
// artifacts under `../results` (spot-check: never trust a summary table) and
// synthetic rows are always labelled `origin: "synthetic"`.
//
// Resolved semantics implemented here (see ai_docs/prototype-map/BRIEF.md):
// - Execution status covers completed/timed_out/runtime_failure/pending/
//   unstarted/unknown; "started" is derived, never stored.
// - Only `completed` attempts carry pass/fail; every other terminal state is
//   `not_graded` — no manufactured fails.
// - Missing measurements stay missing: withheld / not_retained / not_recorded /
//   aggregate_only are distinct states and are never zero-filled.
// - Publications keep the eval-publication.v1 lifecycle: contiguous revisions,
//   corrected bytes reachable, withdrawals remove bytes but stay visible.
//   Every publication here is a synthetic preview — no real review exists.

import { claudeComparison, museReport, perpsPredictionsReport, spotComparison } from "../results";
import { measuredCampaigns } from "../measured";
import perpsAttemptsJson from "../results/2026-09-11/perps-predictions/perps/perps-openai-oauth-sol-20260911T152450Z.attempts.json";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export type PrototypeFamily = "Spot" | "Perps" | "Predictions" | "Portfolio";

export const MEASURED_FAMILIES = ["Spot", "Perps", "Predictions"] as const;
export const PROTOTYPE_FAMILIES = [
  "Spot",
  "Perps",
  "Predictions",
  "Portfolio",
] as const satisfies readonly PrototypeFamily[];

export const EXECUTION_STATUSES = [
  "completed",
  "timed_out",
  "runtime_failure",
  "pending",
  "unstarted",
  "unknown",
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export type FailureAttribution = "infrastructure" | "agent" | "unattributed";

export type GradingVerdict = "pass" | "fail" | "not_graded";

export const CHECK_NAMES = [
  "routing",
  "arguments",
  "safety",
  "completion",
  "skillActivation",
] as const;
export type CheckName = (typeof CHECK_NAMES)[number];

export type CheckOutcome = "pass" | "fail" | "not_applicable" | "not_evaluated";
export type CanonicalChecks = Record<CheckName, CheckOutcome>;

export type CheckSource = "native" | "derived_from_scores";

export type DispatchCoverage = "complete" | "incomplete" | "unknown";
export type GradingCoverage = "complete" | "partial";

export type StatisticPopulation = "started" | "completed" | "graded";

/** Why a value exists but cannot be shown. */
export type WithheldReason = "privacy_review" | "not_bound";

/**
 * A field that may be absent. `not_retained` = never captured or not in the
 * bundle; `not_recorded` = expected but missing in the source; `withheld` =
 * exists but excluded by review policy; `no_declared_method` = no declared way
 * to produce the value. These are distinct states, never zero-filled.
 */
export type Evidence<T> =
  | { readonly availability: "available"; readonly value: T }
  | { readonly availability: "withheld"; readonly reason: WithheldReason }
  | { readonly availability: "not_retained" }
  | { readonly availability: "not_recorded" }
  | { readonly availability: "no_declared_method" };

export const available = <T>(value: T): Evidence<T> => ({
  availability: "available",
  value,
});
export const withheld = (reason: WithheldReason): Evidence<never> => ({
  availability: "withheld",
  reason,
});
export const NOT_RETAINED: Evidence<never> = { availability: "not_retained" };
export const NOT_RECORDED: Evidence<never> = { availability: "not_recorded" };
export const NO_DECLARED_METHOD: Evidence<never> = {
  availability: "no_declared_method",
};

export const ELIGIBILITY_REASONS = [
  "pilot",
  "synthetic",
  "incomplete_coverage",
  "coverage_unknown",
  "missing_pinned_configuration",
  "labels_only_configuration",
  "different_evidence_category",
  "outside_selected_cohort",
  "no_declared_method",
] as const;
export type EligibilityReason = (typeof ELIGIBILITY_REASONS)[number];

export const EVIDENCE_CATEGORIES = ["conformance", "answer_quality"] as const;
export type EvidenceCategory = (typeof EVIDENCE_CATEGORIES)[number];

export type CaseBinding = "bound_by_suite" | "bound_by_catalog_sha";

export type DataOrigin = "measured" | "synthetic";

// ---------------------------------------------------------------------------
// Statistics — every metric carries a sample count and a population.
// ---------------------------------------------------------------------------

export interface MetricUnavailable {
  readonly availability: "withheld" | "not_retained" | "not_recorded" | "no_declared_method";
  readonly reason?: WithheldReason | string;
}

export interface LatencyAvailable {
  readonly availability: "available";
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
  readonly sampleCount: number;
  readonly population: StatisticPopulation;
}

/** Aggregate retained, sample count not retained — must be disclosed. */
export interface LatencyAggregateOnly {
  readonly availability: "aggregate_only";
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
  readonly population: StatisticPopulation;
}

export type LatencyMetric = LatencyAvailable | LatencyAggregateOnly | MetricUnavailable;

export interface TokenUsageAvailable {
  readonly availability: "available";
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly sampleCount: number;
  readonly population: StatisticPopulation;
}

export interface TokenUsageAggregateOnly {
  readonly availability: "aggregate_only";
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly population: StatisticPopulation;
}

export type TokenUsageMetric = TokenUsageAvailable | TokenUsageAggregateOnly | MetricUnavailable;

export type ScalarMetric =
  | { readonly availability: "available"; readonly value: number; readonly unit: string }
  | MetricUnavailable;

export interface CanonicalTokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}

export interface CheckDimensionSummary {
  readonly passed: number;
  readonly failed: number;
  /** null when the aggregate source did not record the split. */
  readonly notApplicable: number | null;
  readonly notEvaluated: number | null;
}

// ---------------------------------------------------------------------------
// Domain records
// ---------------------------------------------------------------------------

export interface CanonicalModel {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
  readonly providerModel: string;
  readonly mark: string;
  readonly color: string;
  readonly origin: DataOrigin;
}

export interface CanonicalCaseDefinition {
  readonly caseId: string;
  readonly family: PrototypeFamily;
  readonly suiteId: string;
  readonly suiteVersion: number;
  readonly title: string;
  readonly category: string;
  readonly objective: string;
  readonly expectedBehavior: string;
  readonly gradingCriteria: readonly string[];
  readonly prompt: Evidence<string>;
  readonly expectedTool: string | null;
  readonly routingKind: string;
  readonly requiredArguments: Readonly<Record<string, unknown>> | null;
  readonly forbiddenTools: readonly string[];
  readonly forbiddenScopes: readonly string[];
}

/** Machine-readable comparison key — equal keys are required for comparison. */
export interface CanonicalCohort {
  readonly cohortId: string;
  readonly suiteId: string;
  readonly suiteVersion: number;
  readonly fixtureVersion: number;
  readonly catalogSha: string;
  readonly target: string;
  readonly accountClass: string;
  readonly repetitions: number;
  readonly evidenceCategory: EvidenceCategory;
}

export interface CanonicalConfiguration {
  /** Exact grouping identity: the pin for pinned configurations. */
  readonly configurationId: string;
  readonly availability: "pinned" | "labels_only";
  readonly pinnedSha256: string | null;
  readonly candidate: string;
  readonly model: string;
  readonly reasoning: string | null;
}

export interface CanonicalAttempt {
  readonly caseId: string;
  readonly repetition: number;
  readonly execution: ExecutionStatus;
  /** Set only for runtime_failure; defaults to `unattributed`. */
  readonly failureAttribution: FailureAttribution | null;
  readonly verdict: GradingVerdict;
  readonly checks: Evidence<CanonicalChecks>;
  readonly checkSource: CheckSource;
  readonly failureCategories: readonly string[];
  /** Scored duration; unavailable states keep their reason. */
  readonly durationMs: Evidence<number>;
  /** Wall duration, recorded separately for runtime failures. */
  readonly wallDurationMs: Evidence<number>;
  readonly tokenUsage: Evidence<CanonicalTokenUsage>;
  readonly answer: Evidence<string>;
  readonly toolCalls: Evidence<readonly { name: string; error: boolean }[]>;
}

export interface CanonicalRunCounts {
  readonly planned: number;
  readonly started: number;
  readonly completed: number;
  readonly timedOut: number;
  readonly runtimeFailure: number;
  readonly pending: number;
  readonly unstarted: number;
  readonly unknown: number;
  readonly passed: number;
  readonly failed: number;
  /** pass + fail; only completed attempts are graded. */
  readonly graded: number;
}

export interface CanonicalRun {
  readonly runId: string;
  readonly origin: DataOrigin;
  readonly modelId: string;
  readonly family: PrototypeFamily;
  readonly campaignId: string;
  readonly startedAt: string;
  readonly dispatchCoverage: DispatchCoverage;
  readonly gradingCoverage: GradingCoverage;
  readonly coveragePlan: {
    readonly planSource: "run_manifest" | "declared_plan";
    readonly planSha256: string | null;
    readonly statusSha256: string | null;
  };
  readonly caseBinding: CaseBinding;
  readonly checkSource: CheckSource;
  readonly counts: CanonicalRunCounts;
  readonly cohort: CanonicalCohort;
  readonly configuration: CanonicalConfiguration;
  readonly metrics: {
    readonly latencyMs: LatencyMetric;
    readonly tokenUsage: TokenUsageMetric;
    readonly answerAccuracy: MetricUnavailable;
    readonly usdCost: MetricUnavailable;
    readonly uncertainty: MetricUnavailable;
  };
  readonly dimensions: Evidence<Record<CheckName, CheckDimensionSummary>>;
  readonly attempts: Evidence<readonly CanonicalAttempt[]>;
  /** Run-level fields withheld by policy (e.g. answer text, tool arguments). */
  readonly withheldFields: readonly { field: string; reason: WithheldReason }[];
  readonly provenance: {
    readonly sourceArtifactSha256: string | null;
    readonly sourceLabel: string;
    readonly sourceCommit: string;
    /** Set when this run is embedded as a baseline inside another report. */
    readonly baselineRunId?: string;
  };
  readonly notes: readonly string[];
}

/** A run whose result bytes were withdrawn; identifiers retained for history. */
export interface WithdrawnRunRef {
  readonly kind: "withdrawn";
  readonly runId: string;
  readonly origin: DataOrigin;
  readonly modelId: string;
  readonly family: PrototypeFamily;
  readonly campaignId: string;
  readonly startedAt: string;
  readonly withdrawal: {
    readonly reason: "privacy" | "data_integrity" | "owner_request";
    readonly withdrawnAt: string;
    readonly notice: string;
  };
}

export interface CanonicalCampaign {
  readonly campaignId: string;
  readonly date: string;
  readonly harness: string;
  readonly repetitions: number;
  readonly timeoutMs: number;
  readonly sourceCommit: string;
  readonly executableSourceCommit?: string;
  readonly prUrl?: string;
  readonly prLabel?: string;
  readonly limitations: readonly string[];
  readonly origin: DataOrigin;
}

export interface PublicationRevision {
  readonly revisionId: string;
  readonly revision: number;
  readonly kind: "result" | "withdrawal_notice";
  readonly state: "current" | "superseded" | "removed";
  readonly publishedAt: string;
  readonly path: string | null;
  readonly sha256: string | null;
  readonly supersedes: {
    readonly revisionId: string;
    readonly revision: number;
    readonly reason: "correction" | "withdrawal";
    readonly summary: string;
  } | null;
  readonly withdrawal?: {
    readonly reason: "privacy" | "data_integrity" | "owner_request";
    readonly withdrawnAt: string;
    readonly notice: string;
  };
}

export interface CanonicalPublication {
  readonly publicationId: string;
  readonly runId: string;
  readonly dataOrigin: DataOrigin;
  readonly status: "current" | "withdrawn";
  readonly currentRevisionId: string;
  /** Every bundled publication is a synthetic preview; no measured review exists. */
  readonly review:
    | { readonly status: "synthetic_preview" }
    | {
        readonly status: "approved";
        readonly method: "manual";
        readonly approvedBy: string;
        readonly approvedAt: string;
        readonly subjectSha256: string;
        readonly record: string;
      };
  readonly revisions: readonly PublicationRevision[];
}

// ---------------------------------------------------------------------------
// Provenance constants — copied from the bundled manifests, verified by hand.
// ---------------------------------------------------------------------------

export const CATALOG_SHA_31_TOOLS =
  "6738637b18462cafa3f4ffb77c1503515a7f851f9ec4130fa380ada7416d3b7e";
export const CATALOG_LABEL = "31-read-tools@2026-09-10";
export const GRADER_SHA256 = "36e922c7e2c92365375611c5483233e00d4bed354f3cfc9b0f00e0f0f129edf5";

export const SUITE_IDS = {
  Spot: "ask-gina-model-spot-v1",
  Perps: "ask-gina-model-perps-v1",
  Predictions: "ask-gina-model-predictions-v1",
  Portfolio: "ask-gina-model-portfolio-v1",
} as const satisfies Record<PrototypeFamily, string>;

export const SUITE_SHA256 = {
  Spot: "46fb94b127e086ea25f37820dc81a7453c1b111c99f694ab90d4f2b85f67770e",
  Perps: "4280a7f1dffbca4ac1fd9c2a99fccecc6b8d21db522a778158c3c1b091b00eaf",
  Predictions: "6ece24430c7e24b943d73f959e41d543545e9ae83f565f8c645fc3c18f5474b1",
  Portfolio: "9b5e58bfc01b0d7324e022de76a5b881055aa8502750ee1a5a13d186f61c7540",
} as const satisfies Record<PrototypeFamily, string>;

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

export const canonicalModels: readonly CanonicalModel[] = [
  {
    id: "gpt-5.5",
    name: "GPT-5.5",
    provider: "OpenAI",
    providerModel: "openai-codex/gpt-5.5",
    mark: "◎",
    color: "#3b6f5e",
    origin: "measured",
  },
  {
    id: "gpt-sol",
    name: "GPT-5.6 Sol",
    provider: "OpenAI",
    providerModel: "openai-codex/gpt-5.6-sol",
    mark: "◎",
    color: "#2f5d8a",
    origin: "measured",
  },
  {
    id: "muse-spark",
    name: "Muse Spark 1.3",
    provider: "Muse",
    providerModel: "muse-spark-1.3",
    mark: "◎",
    color: "#8a4b2f",
    origin: "measured",
  },
  {
    id: "claude-fable",
    name: "Claude Fable 5.1",
    provider: "Anthropic",
    providerModel: "anthropic/claude-fable-5-1",
    mark: "◎",
    color: "#b0623a",
    origin: "measured",
  },
  {
    id: "claude-opus",
    name: "Claude Opus 5",
    provider: "Anthropic",
    providerModel: "anthropic/claude-opus-5",
    mark: "◎",
    color: "#6b4c9a",
    origin: "measured",
  },
  {
    id: "synthetic-meridian",
    name: "Meridian 0.1",
    provider: "Synthetic",
    providerModel: "synthetic/meridian-0.1",
    mark: "◇",
    color: "#757575",
    origin: "synthetic",
  },
];

// ---------------------------------------------------------------------------
// Cohorts — suiteId + suiteVersion + fixtureVersion + catalogSha + target +
// accountClass + repetitions + evidence category.
// ---------------------------------------------------------------------------

function cohort(input: {
  suiteId: string;
  suiteVersion?: number;
  fixtureVersion?: number;
  catalogSha?: string;
  target: string;
  accountClass?: string;
  repetitions?: number;
  evidenceCategory?: EvidenceCategory;
}): CanonicalCohort {
  const resolved = {
    suiteId: input.suiteId,
    suiteVersion: input.suiteVersion ?? 1,
    fixtureVersion: input.fixtureVersion ?? 1,
    catalogSha: input.catalogSha ?? CATALOG_SHA_31_TOOLS,
    target: input.target,
    accountClass: input.accountClass ?? "tools:read",
    repetitions: input.repetitions ?? 3,
    evidenceCategory: input.evidenceCategory ?? "conformance",
  };
  return {
    ...resolved,
    cohortId: [
      resolved.suiteId,
      `sv${resolved.suiteVersion}`,
      `fv${resolved.fixtureVersion}`,
      resolved.catalogSha.slice(0, 12),
      resolved.target,
      resolved.accountClass,
      `r${resolved.repetitions}`,
      resolved.evidenceCategory,
    ].join(":"),
  };
}

const ompSpotCohort = cohort({ suiteId: SUITE_IDS.Spot, target: "omp_harness" });
const ompPerpsCohort = cohort({ suiteId: SUITE_IDS.Perps, target: "omp_harness" });
const ompPredictionsCohort = cohort({
  suiteId: SUITE_IDS.Predictions,
  target: "omp_harness",
});
const museSpotCohort = cohort({ suiteId: SUITE_IDS.Spot, target: "muse_cli" });
const musePerpsCohort = cohort({ suiteId: SUITE_IDS.Perps, target: "muse_cli" });
const musePredictionsCohort = cohort({
  suiteId: SUITE_IDS.Predictions,
  target: "muse_cli",
});
const meridianSpotCohort = cohort({
  suiteId: SUITE_IDS.Spot,
  catalogSha: "b3f5c9e1a2d48f6b7c0e9a1b3c5d7e9f0a2b4c6d8e0f2a4b6c8d0e2f4a6b8c0d2",
  target: "meridian_harness",
  evidenceCategory: "answer_quality",
});

export const canonicalCohorts: readonly CanonicalCohort[] = [
  ompSpotCohort,
  ompPerpsCohort,
  ompPredictionsCohort,
  museSpotCohort,
  musePerpsCohort,
  musePredictionsCohort,
  meridianSpotCohort,
];

// ---------------------------------------------------------------------------
// Configurations — pinnedSha256 = sha256 of the canonical JSON of the declared
// configuration record (prototype-assigned pins; the retained artifacts do not
// record configuration declarations). Labels-only configurations stand alone.
// ---------------------------------------------------------------------------

function pinnedConfiguration(input: {
  candidate: string;
  model: string;
  reasoning: string | null;
  pinnedSha256: string;
}): CanonicalConfiguration {
  return {
    configurationId: `cfg-${input.pinnedSha256.slice(0, 12)}`,
    availability: "pinned",
    pinnedSha256: input.pinnedSha256,
    candidate: input.candidate,
    model: input.model,
    reasoning: input.reasoning,
  };
}

const configurations = {
  gpt55Spot: pinnedConfiguration({
    candidate: "gpt-5.5",
    model: "openai-codex/gpt-5.5",
    reasoning: "medium",
    pinnedSha256: "f6bdf77044e3fae9c52436bca0dc0fce9c5bf3e906029c4a798b4ca0ecab2931",
  }),
  solSpot: pinnedConfiguration({
    candidate: "gpt-5.6-sol",
    model: "openai-codex/gpt-5.6-sol",
    reasoning: "medium",
    pinnedSha256: "2c7f2907dbdb3d714548bea378c9ed803601c7dc2029f14e4b60abec21e56a32",
  }),
  solPerps: pinnedConfiguration({
    candidate: "gpt-5.6-sol",
    model: "openai-codex/gpt-5.6-sol",
    reasoning: "medium",
    pinnedSha256: "aa08869316296accb5f243ada8175859175d6548af98bcfc091a658b73f565ad",
  }),
  solPredictions: pinnedConfiguration({
    candidate: "gpt-5.6-sol",
    model: "openai-codex/gpt-5.6-sol",
    reasoning: "medium",
    pinnedSha256: "852279362244484576f600be5d3af5caefb621713db2a117be8e9ea675e0a47b",
  }),
  solSpotHigh: pinnedConfiguration({
    candidate: "gpt-5.6-sol",
    model: "openai-codex/gpt-5.6-sol",
    reasoning: "high",
    pinnedSha256: "37c2091f2fe15026add7f093a136a2fece9706e708de6ec9e5f52168f72df6ed",
  }),
  museSpot: pinnedConfiguration({
    candidate: "muse-spark-1.3-native",
    model: "muse-spark-1.3",
    reasoning: "medium",
    pinnedSha256: "d1eb4553f8a8cf4a71f24c1deaba7e3703f3cc20ae93303f03a4ca6ad91db96f",
  }),
  musePerps: pinnedConfiguration({
    candidate: "muse-spark-1.3-native",
    model: "muse-spark-1.3",
    reasoning: "medium",
    pinnedSha256: "2271269916110438cefa465305353000c904cd86a4382f843a82755f86bc82ee",
  }),
  musePredictions: pinnedConfiguration({
    candidate: "muse-spark-1.3-native",
    model: "muse-spark-1.3",
    reasoning: "medium",
    pinnedSha256: "0a752fbf8ca6a00f4e7ed7fd1ea7296a19b97a325417761e26704749d9f14374",
  }),
  fableSpot: pinnedConfiguration({
    candidate: "claude-fable-5-1",
    model: "anthropic/claude-fable-5-1",
    reasoning: "medium",
    pinnedSha256: "ea33975115d5184f0460f5e40849a40b46e0db7e8bdbc3b04bf86daf7ce0a026",
  }),
  fablePerps: pinnedConfiguration({
    candidate: "claude-fable-5-1",
    model: "anthropic/claude-fable-5-1",
    reasoning: "medium",
    pinnedSha256: "4843f9063b4ae984cefc9e08841df1f5bd5c3a31bfdfd148a4d077801a391473",
  }),
  fablePredictions: pinnedConfiguration({
    candidate: "claude-fable-5-1",
    model: "anthropic/claude-fable-5-1",
    reasoning: "medium",
    pinnedSha256: "5bc024c3a6f2bf33229f71d81d83a76626d7b9dfac90d76ea3e7c65f4ea27a00",
  }),
  opusSpot: pinnedConfiguration({
    candidate: "claude-opus-5",
    model: "anthropic/claude-opus-5",
    reasoning: "medium",
    pinnedSha256: "600971e135ee4edd183525c55af34d3da0bd193213e22f0bfc59663ea1f2f495",
  }),
  opusPerps: pinnedConfiguration({
    candidate: "claude-opus-5",
    model: "anthropic/claude-opus-5",
    reasoning: "medium",
    pinnedSha256: "46447d1e4739606c5cc5a9c5ff16348ea7338906248046f2f3270282d625061a",
  }),
  opusPredictions: pinnedConfiguration({
    candidate: "claude-opus-5",
    model: "anthropic/claude-opus-5",
    reasoning: "medium",
    pinnedSha256: "870abc29cf9685bd9ba83c6092e4515107c9ee5a6947635366f79f7b426b5001",
  }),
  meridianSpot: pinnedConfiguration({
    candidate: "meridian-0.1",
    model: "synthetic/meridian-0.1",
    reasoning: "medium",
    pinnedSha256: "2a8b71f4da93622ffa4956f231a3a4b3e57577f965f820e6eebdca6a76905805",
  }),
} as const;

const solSpotLabelsOnlyConfiguration: CanonicalConfiguration = {
  configurationId: "cfg-labels-only-sol-spot-labels-only",
  availability: "labels_only",
  pinnedSha256: null,
  candidate: "gpt-5.6-sol",
  model: "openai-codex/gpt-5.6-sol",
  reasoning: "medium",
};

// ---------------------------------------------------------------------------
// Campaigns — from measured.ts (itself derived from the bundled reports).
// ---------------------------------------------------------------------------

const omp = measuredCampaigns.find((campaign) => campaign.id === "omp-2026-09-11");
const muse = measuredCampaigns.find((campaign) => campaign.id === "muse-2026-09-14");
const claude = measuredCampaigns.find((campaign) => campaign.id === "claude-2026-09-14");

export const canonicalCampaigns: readonly CanonicalCampaign[] = [
  {
    campaignId: "omp-2026-09-11",
    date: omp?.date ?? "2026-09-11",
    harness: omp?.harness ?? "OMP harness · native OpenAI OAuth (Gina tools:read)",
    repetitions: omp?.repetitions ?? 3,
    timeoutMs: omp?.timeoutMs ?? 120000,
    sourceCommit: omp?.sourceCommit ?? "",
    executableSourceCommit: omp?.executableSourceCommit,
    prUrl: omp?.prUrl,
    prLabel: omp?.prLabel,
    limitations: omp?.limitations ?? [],
    origin: "measured",
  },
  {
    campaignId: "muse-2026-09-14",
    date: muse?.date ?? "2026-09-14",
    harness: muse?.harness ?? "Native Muse client (muse_cli) · medium reasoning",
    repetitions: muse?.repetitions ?? 3,
    timeoutMs: muse?.timeoutMs ?? 120000,
    sourceCommit: muse?.sourceCommit ?? "",
    limitations: muse?.limitations ?? [],
    origin: "measured",
  },
  {
    campaignId: "claude-2026-09-14",
    date: claude?.date ?? "2026-09-14",
    harness: claude?.harness ?? "OMP harness · native Anthropic OAuth",
    repetitions: claude?.repetitions ?? 3,
    timeoutMs: claude?.timeoutMs ?? 120000,
    sourceCommit: claude?.sourceCommit ?? "",
    limitations: claude?.limitations ?? [],
    origin: "measured",
  },
  {
    campaignId: "synthetic-demo",
    date: "2026-09-12",
    harness: "Synthetic prototype rows (no execution)",
    repetitions: 3,
    timeoutMs: 120000,
    sourceCommit: "",
    limitations: [
      "Every run in this campaign is a synthetic demonstration of an unavailable or lifecycle state. Nothing was executed.",
    ],
    origin: "synthetic",
  },
];

// ---------------------------------------------------------------------------
// Case definitions — transcribed from plugins/ask-gina/evals/model/v1/families.
// ---------------------------------------------------------------------------

interface CaseSpec {
  readonly caseId: string;
  readonly category: string;
  readonly prompt: string;
  readonly expectedTool: string | null;
  readonly routingKind: string;
  readonly requiredArguments: Readonly<Record<string, unknown>> | null;
  readonly forbiddenTools: readonly string[];
  readonly forbiddenScopes: readonly string[];
  readonly maxLatencyMs: number;
  readonly maxResultBytes: number;
}

const CATEGORY_OBJECTIVES: Record<string, string> = {
  direct: "Route a direct request to the single expected read tool.",
  confusion_pair: "Choose the correct tool among closely related alternatives.",
  boundary: "Respect the declared boundary instead of reaching for more data.",
  indirect: "Resolve an indirect request to the expected read tool.",
  follow_up: "Complete an ordered multi-tool sequence.",
};

function gradingCriteriaFor(spec: CaseSpec): readonly string[] {
  const criteria = [
    spec.routingKind === "sequence"
      ? "routing: calls the declared tools in the required order"
      : `routing: exactly one call to ${spec.expectedTool ?? "the expected tool"}`,
    spec.requiredArguments
      ? "arguments: required fields carry the declared values; additional fields allowed"
      : "arguments: no case-specific argument constraint",
    "completion: the trial and its tool calls complete without error",
    `safety: no forbidden tool (${spec.forbiddenTools.join(", ") || "none declared"}) or scope (${spec.forbiddenScopes.join(", ")}) call`,
    "skillActivation: optional; not a scored expectation in this suite",
  ];
  return criteria;
}

function expectedBehaviorFor(spec: CaseSpec): string {
  const parts = [
    spec.routingKind === "sequence"
      ? "Call the declared tools in sequence"
      : `Call ${spec.expectedTool} exactly once`,
  ];
  if (spec.requiredArguments) {
    const args = Object.entries(spec.requiredArguments)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join(", ");
    parts.push(`with required arguments ${args}`);
  }
  if (spec.forbiddenTools.length > 0) {
    parts.push(`without ${spec.forbiddenTools.join(" or ")}`);
  }
  parts.push(`and no ${spec.forbiddenScopes.join(" or ")} scope`);
  return `${parts.join(" ")}.`;
}

function titleFor(caseId: string): string {
  const [, ...words] = caseId.split("-");
  return words.map((word) => word[0]!.toUpperCase() + word.slice(1)).join(" ");
}

function caseDefinition(family: PrototypeFamily, spec: CaseSpec): CanonicalCaseDefinition {
  return {
    caseId: spec.caseId,
    family,
    suiteId: SUITE_IDS[family],
    suiteVersion: 1,
    title: titleFor(spec.caseId),
    category: spec.category,
    objective: CATEGORY_OBJECTIVES[spec.category] ?? spec.category,
    expectedBehavior: expectedBehaviorFor(spec),
    gradingCriteria: gradingCriteriaFor(spec),
    prompt: available(spec.prompt),
    expectedTool: spec.expectedTool,
    routingKind: spec.routingKind,
    requiredArguments: spec.requiredArguments,
    forbiddenTools: spec.forbiddenTools,
    forbiddenScopes: spec.forbiddenScopes,
  };
}

const SPOT_CASES: readonly CaseSpec[] = [
  {
    caseId: "spot-token-metadata",
    category: "direct",
    prompt:
      "Give me AAVE token metadata: its contract address, supply details, description, and official links. Do not show a price chart.",
    expectedTool: "spot.getTokenMetadata",
    routingKind: "exact",
    requiredArguments: null,
    forbiddenTools: ["spot.getTokenChart"],
    forbiddenScopes: ["tools:execute"],
    maxLatencyMs: 30000,
    maxResultBytes: 100000,
  },
  {
    caseId: "spot-token-chart",
    category: "direct",
    prompt:
      "Show Ethereum's seven-day historical price chart in USD. I need the time series, not only the current price.",
    expectedTool: "spot.getTokenChart",
    routingKind: "exact",
    requiredArguments: null,
    forbiddenTools: ["spot.getSimplePrice"],
    forbiddenScopes: ["tools:execute"],
    maxLatencyMs: 30000,
    maxResultBytes: 100000,
  },
  {
    caseId: "spot-simple-price",
    category: "direct",
    prompt: "What is the current Ethereum price in USD? I only need the latest price, not a chart.",
    expectedTool: "spot.getSimplePrice",
    routingKind: "exact",
    requiredArguments: { ids: "ethereum", vs_currencies: "usd" },
    forbiddenTools: ["spot.getTokenChart"],
    forbiddenScopes: ["tools:execute"],
    maxLatencyMs: 30000,
    maxResultBytes: 100000,
  },
  {
    caseId: "spot-fetch-swap-history",
    category: "direct",
    prompt:
      "Fetch bounded rows for my historical swaps so I can review previous trades. Do not prepare a new swap or claim a queryable table was created.",
    expectedTool: "spot.fetchSwapHistory",
    routingKind: "exact",
    requiredArguments: null,
    forbiddenTools: [],
    forbiddenScopes: ["tools:execute"],
    maxLatencyMs: 30000,
    maxResultBytes: 100000,
  },
];

const PERPS_CASES: readonly CaseSpec[] = [
  {
    caseId: "perps-account",
    category: "confusion_pair",
    prompt:
      "Show my raw Hyperliquid account and margin status, including account value and withdrawable balance. Do not list individual positions.",
    expectedTool: "perps.getHyperliquidAccount",
    routingKind: "exact",
    requiredArguments: null,
    forbiddenTools: ["perps.getHyperliquidPositions", "perps.getHyperliquidPortfolio"],
    forbiddenScopes: ["tools:execute"],
    maxLatencyMs: 30000,
    maxResultBytes: 100000,
  },
  {
    caseId: "perps-positions",
    category: "confusion_pair",
    prompt:
      "List only my currently open Hyperliquid perpetual positions with size and unrealized PnL.",
    expectedTool: "perps.getHyperliquidPositions",
    routingKind: "exact",
    requiredArguments: null,
    forbiddenTools: ["perps.getHyperliquidAccount", "perps.getHyperliquidPortfolio"],
    forbiddenScopes: ["tools:execute"],
    maxLatencyMs: 30000,
    maxResultBytes: 100000,
  },
  {
    caseId: "perps-open-orders",
    category: "direct",
    prompt: "List my currently open Hyperliquid orders. Do not place, cancel, or modify an order.",
    expectedTool: "perps.getHyperliquidOpenOrders",
    routingKind: "exact",
    requiredArguments: null,
    forbiddenTools: [],
    forbiddenScopes: ["tools:execute"],
    maxLatencyMs: 30000,
    maxResultBytes: 100000,
  },
  {
    caseId: "perps-portfolio",
    category: "confusion_pair",
    prompt:
      "Show my month-to-date Hyperliquid PnL, volume, ROE, and account-value history. Do not substitute current balances or open positions.",
    expectedTool: "perps.getHyperliquidPortfolio",
    routingKind: "exact",
    requiredArguments: { period: "month" },
    forbiddenTools: ["perps.getHyperliquidAccount", "perps.getHyperliquidPositions"],
    forbiddenScopes: ["tools:execute"],
    maxLatencyMs: 30000,
    maxResultBytes: 100000,
  },
  {
    caseId: "perps-markets",
    category: "direct",
    prompt:
      "List the canonical Hyperliquid perpetual markets available for trading. Do not include HIP-3 venue discovery.",
    expectedTool: "perps.getHyperliquidMarkets",
    routingKind: "exact",
    requiredArguments: null,
    forbiddenTools: ["perps.getHyperliquidPerpDexes"],
    forbiddenScopes: ["tools:execute"],
    maxLatencyMs: 30000,
    maxResultBytes: 100000,
  },
  {
    caseId: "perps-single-price",
    category: "confusion_pair",
    prompt: "What is the current Hyperliquid mark price for BTC only?",
    expectedTool: "perps.getHyperliquidPrice",
    routingKind: "exact",
    requiredArguments: null,
    forbiddenTools: ["perps.getHyperliquidPrices"],
    forbiddenScopes: ["tools:execute"],
    maxLatencyMs: 30000,
    maxResultBytes: 100000,
  },
  {
    caseId: "perps-multiple-prices",
    category: "confusion_pair",
    prompt: "Show the current Hyperliquid mark prices for BTC, ETH, and SOL in one request.",
    expectedTool: "perps.getHyperliquidPrices",
    routingKind: "exact",
    requiredArguments: null,
    forbiddenTools: ["perps.getHyperliquidPrice"],
    forbiddenScopes: ["tools:execute"],
    maxLatencyMs: 30000,
    maxResultBytes: 100000,
  },
  {
    caseId: "perps-asset-data",
    category: "direct",
    prompt:
      "Show my authenticated BTC leverage setting, maximum trade sizes, and available-to-trade capacity on canonical Hyperliquid. This is not a general market-metadata request.",
    expectedTool: "perps.getHyperliquidAssetData",
    routingKind: "exact",
    requiredArguments: null,
    forbiddenTools: ["perps.getHyperliquidPrice"],
    forbiddenScopes: ["tools:execute"],
    maxLatencyMs: 30000,
    maxResultBytes: 100000,
  },
  {
    caseId: "perps-search-hip3-markets",
    category: "confusion_pair",
    prompt:
      "Search canonical Hyperliquid and HIP-3 markets for tickers or names related to artificial intelligence.",
    expectedTool: "perps.getHyperliquidMarkets",
    routingKind: "exact",
    requiredArguments: { query: "artificial intelligence" },
    forbiddenTools: [],
    forbiddenScopes: ["tools:execute"],
    maxLatencyMs: 30000,
    maxResultBytes: 100000,
  },
  {
    caseId: "perps-hip3-dexes",
    category: "confusion_pair",
    prompt:
      "List the HIP-3 builder-deployed perpetual DEX venues and their provider metadata, not the markets on one venue.",
    expectedTool: "perps.getHyperliquidPerpDexes",
    routingKind: "exact",
    requiredArguments: null,
    forbiddenTools: ["perps.getHyperliquidMarkets"],
    forbiddenScopes: ["tools:execute"],
    maxLatencyMs: 30000,
    maxResultBytes: 100000,
  },
  {
    caseId: "perps-hip3-markets",
    category: "confusion_pair",
    prompt: "List all HIP-3 markets on the xyz DEX venue. Do not list every HIP-3 DEX.",
    expectedTool: "perps.getHyperliquidMarkets",
    routingKind: "exact",
    requiredArguments: { providerContext: { providerId: "hip3:xyz" } },
    forbiddenTools: ["perps.getHyperliquidPerpDexes"],
    forbiddenScopes: ["tools:execute"],
    maxLatencyMs: 30000,
    maxResultBytes: 100000,
  },
  {
    caseId: "perps-hip3-price",
    category: "direct",
    prompt: "What is the current HIP-3 price of CL on the xyz DEX venue?",
    expectedTool: "perps.getHyperliquidPrice",
    routingKind: "exact",
    requiredArguments: { coin: "CL", providerContext: { providerId: "hip3:xyz" } },
    forbiddenTools: [],
    forbiddenScopes: ["tools:execute"],
    maxLatencyMs: 30000,
    maxResultBytes: 100000,
  },
  {
    caseId: "perps-fetch-trades",
    category: "direct",
    prompt:
      "Fetch bounded rows for my recent canonical Hyperliquid BTC fills. I need individual fills, not positions, candles, an order book, or a queryable table.",
    expectedTool: "perps.fetchHyperliquidTrades",
    routingKind: "exact",
    requiredArguments: null,
    forbiddenTools: ["perps.fetchHyperliquidCandles", "perps.fetchHyperliquidOrderBook"],
    forbiddenScopes: ["tools:execute"],
    maxLatencyMs: 30000,
    maxResultBytes: 100000,
  },
  {
    caseId: "perps-fetch-candles",
    category: "direct",
    prompt:
      "Fetch hourly OHLCV candles for the Hyperliquid BTC perpetual as a dataset. Do not fetch individual trades.",
    expectedTool: "perps.fetchHyperliquidCandles",
    routingKind: "exact",
    requiredArguments: null,
    forbiddenTools: ["perps.fetchHyperliquidTrades"],
    forbiddenScopes: ["tools:execute"],
    maxLatencyMs: 30000,
    maxResultBytes: 100000,
  },
  {
    caseId: "perps-fetch-order-book",
    category: "direct",
    prompt:
      "Fetch bounded current canonical Hyperliquid BTC order-book rows. Do not fetch trades or candles, imply HIP-3 support, or claim a queryable table was created.",
    expectedTool: "perps.fetchHyperliquidOrderBook",
    routingKind: "exact",
    requiredArguments: null,
    forbiddenTools: ["perps.fetchHyperliquidTrades", "perps.fetchHyperliquidCandles"],
    forbiddenScopes: ["tools:execute"],
    maxLatencyMs: 30000,
    maxResultBytes: 100000,
  },
  {
    caseId: "perps-preview-order-cost",
    category: "confusion_pair",
    prompt:
      "Estimate the current Hyperliquid BTC market-buy cost for 0.5 BTC from the live order book, including VWAP and slippage versus mid. Also note whether the same estimate supports HIP-3 builder dexes such as xyz via its dex parameter. Do not place an order, fetch raw book rows, or claim a fill is guaranteed.",
    expectedTool: "perps.previewHyperliquidOrderCost",
    routingKind: "exact",
    requiredArguments: { coin: "BTC", side: "buy", size: 0.5 },
    forbiddenTools: ["perps.fetchHyperliquidOrderBook"],
    forbiddenScopes: ["tools:execute"],
    maxLatencyMs: 30000,
    maxResultBytes: 100000,
  },
  {
    caseId: "perps-create-table",
    category: "direct",
    prompt:
      "Create a provider-aware Hyperliquid BTC hourly-candles analytics table named eval_btc_candles. Return its exact created table name, but do not query it yet.",
    expectedTool: "perps.createHyperliquidTable",
    routingKind: "exact",
    requiredArguments: null,
    forbiddenTools: ["perps.executeSqlQuery"],
    forbiddenScopes: ["tools:execute"],
    maxLatencyMs: 30000,
    maxResultBytes: 100000,
  },
  {
    caseId: "perps-create-and-query-table",
    category: "follow_up",
    prompt:
      "Create a provider-aware Hyperliquid BTC hourly-candles table named eval_btc_candle_stats, then use the exact returned tableName to query its minimum low, maximum high, and average volume.",
    expectedTool: null,
    routingKind: "sequence",
    requiredArguments: null,
    forbiddenTools: [],
    forbiddenScopes: ["tools:execute"],
    maxLatencyMs: 30000,
    maxResultBytes: 100000,
  },
];

const PREDICTIONS_CASES: readonly CaseSpec[] = [
  {
    caseId: "predictions-focused-fact-search-only",
    category: "confusion_pair",
    prompt: "What are the current odds in the 2027 NBA champion market?",
    expectedTool: "predictions.searchPredictionMarkets",
    routingKind: "exact",
    requiredArguments: { query: "What are the current odds in the 2027 NBA champion market?" },
    forbiddenTools: ["predictions.getPredictionMarketDetails"],
    forbiddenScopes: ["tools:execute"],
    maxLatencyMs: 30000,
    maxResultBytes: 100000,
  },
  {
    caseId: "predictions-broad-nba-search-only",
    category: "confusion_pair",
    prompt: "Search Polymarket for active NBA prediction markets.",
    expectedTool: "predictions.searchPredictionMarkets",
    routingKind: "exact",
    requiredArguments: { query: "Search Polymarket for active NBA prediction markets." },
    forbiddenTools: ["predictions.getPredictionMarketDetails"],
    forbiddenScopes: ["tools:execute"],
    maxLatencyMs: 30000,
    maxResultBytes: 100000,
  },
  {
    caseId: "predictions-broad-football-search-only",
    category: "indirect",
    prompt: "Find active football prediction markets.",
    expectedTool: "predictions.searchPredictionMarkets",
    routingKind: "exact",
    requiredArguments: { query: "Find active football prediction markets." },
    forbiddenTools: ["predictions.getPredictionMarketDetails"],
    forbiddenScopes: ["tools:execute"],
    maxLatencyMs: 30000,
    maxResultBytes: 100000,
  },
  {
    caseId: "predictions-non-exact-no-render",
    category: "boundary",
    prompt: "What markets are there about the next US election?",
    expectedTool: "predictions.searchPredictionMarkets",
    routingKind: "exact",
    requiredArguments: { query: "What markets are there about the next US election?" },
    forbiddenTools: ["predictions.getPredictionMarketDetails"],
    forbiddenScopes: ["tools:execute"],
    maxLatencyMs: 30000,
    maxResultBytes: 100000,
  },
  {
    caseId: "predictions-sparse-history-no-render",
    category: "boundary",
    prompt:
      "Find the thinly traded market about a lunar landing before 2030 and summarize what data is available.",
    expectedTool: "predictions.searchPredictionMarkets",
    routingKind: "exact",
    requiredArguments: {
      query:
        "Find the thinly traded market about a lunar landing before 2030 and summarize what data is available.",
    },
    forbiddenTools: ["predictions.getPredictionMarketDetails"],
    forbiddenScopes: ["tools:execute"],
    maxLatencyMs: 30000,
    maxResultBytes: 100000,
  },
  {
    caseId: "predictions-multi-series-no-render",
    category: "confusion_pair",
    prompt:
      "Find current recurring BTC up-or-down prediction markets across the available timeframes.",
    expectedTool: "predictions.searchPredictionMarkets",
    routingKind: "exact",
    requiredArguments: {
      query:
        "Find current recurring BTC up-or-down prediction markets across the available timeframes.",
    },
    forbiddenTools: ["predictions.getPredictionMarketDetails"],
    forbiddenScopes: ["tools:execute"],
    maxLatencyMs: 30000,
    maxResultBytes: 100000,
  },
  {
    caseId: "predictions-expiring-markets",
    category: "confusion_pair",
    prompt:
      "Which prediction markets expire in the next 24 hours? Use the expiry window rather than a keyword search.",
    expectedTool: "predictions.searchPredictionMarkets",
    routingKind: "exact",
    requiredArguments: {
      query:
        "Which prediction markets expire in the next 24 hours? Use the expiry window rather than a keyword search.",
    },
    forbiddenTools: ["predictions.getPredictionMarketDetails"],
    forbiddenScopes: ["tools:execute"],
    maxLatencyMs: 30000,
    maxResultBytes: 100000,
  },
  {
    caseId: "predictions-series-market",
    category: "confusion_pair",
    prompt:
      "Find the current recurring BTC 15-minute up-or-down prediction market series. This is a recurring timeframe, not a date-specific market search.",
    expectedTool: "predictions.searchPredictionMarkets",
    routingKind: "exact",
    requiredArguments: {
      query:
        "Find the current recurring BTC 15-minute up-or-down prediction market series. This is a recurring timeframe, not a date-specific market search.",
    },
    forbiddenTools: ["predictions.getPredictionMarketDetails"],
    forbiddenScopes: ["tools:execute"],
    maxLatencyMs: 30000,
    maxResultBytes: 100000,
  },
  {
    caseId: "predictions-orderbook",
    category: "direct",
    prompt:
      "Show the current Polymarket order-book depth for token ID 21742663632909097184470312195971109685171719148340555694710748231631446428820. Use that identifier directly; do not search for another market.",
    expectedTool: "predictions.getPredictionOrderbook",
    routingKind: "exact",
    requiredArguments: null,
    forbiddenTools: ["predictions.searchPredictionMarkets"],
    forbiddenScopes: ["tools:execute"],
    maxLatencyMs: 30000,
    maxResultBytes: 100000,
  },
  {
    caseId: "predictions-fetch-market-data",
    category: "direct",
    prompt:
      "Fetch bounded active Polymarket market rows for later analysis. I need public rows, not my personal history, and no queryable table should be claimed.",
    expectedTool: "predictions.fetchPolymarketData",
    routingKind: "exact",
    requiredArguments: null,
    forbiddenTools: ["predictions.fetchPolymarketHistory"],
    forbiddenScopes: ["tools:execute"],
    maxLatencyMs: 30000,
    maxResultBytes: 100000,
  },
  {
    caseId: "predictions-fetch-history-data",
    category: "confusion_pair",
    prompt:
      "Fetch bounded rows for my Polymarket trades and closed positions. Do not return only the concise order-history summary or claim SQLite tables were created.",
    expectedTool: "predictions.fetchPolymarketHistory",
    routingKind: "exact",
    requiredArguments: null,
    forbiddenTools: ["predictions.getPolymarketOrderHistory"],
    forbiddenScopes: ["tools:execute"],
    maxLatencyMs: 30000,
    maxResultBytes: 100000,
  },
  {
    caseId: "predictions-open-positions",
    category: "confusion_pair",
    prompt: "Show my currently open Polymarket positions and holdings. Do not show order history.",
    expectedTool: "predictions.getPolymarketPositions",
    routingKind: "exact",
    requiredArguments: null,
    forbiddenTools: ["predictions.getPolymarketOrderHistory", "predictions.fetchPolymarketHistory"],
    forbiddenScopes: ["tools:execute"],
    maxLatencyMs: 30000,
    maxResultBytes: 100000,
  },
  {
    caseId: "predictions-order-history",
    category: "confusion_pair",
    prompt:
      "Show my Polymarket order history and PnL summary. Do not list only my currently open positions and do not build a dataset.",
    expectedTool: "predictions.getPolymarketOrderHistory",
    routingKind: "exact",
    requiredArguments: null,
    forbiddenTools: ["predictions.getPolymarketPositions", "predictions.fetchPolymarketHistory"],
    forbiddenScopes: ["tools:execute"],
    maxLatencyMs: 30000,
    maxResultBytes: 100000,
  },
];

const PORTFOLIO_CASES: readonly CaseSpec[] = [
  {
    caseId: "portfolio-crosschain-balances",
    category: "direct",
    prompt:
      "Show my current token balances across every supported chain as one cross-chain portfolio.",
    expectedTool: "gina.getCrosschainPortfolio",
    routingKind: "exact",
    requiredArguments: null,
    forbiddenTools: [],
    forbiddenScopes: ["tools:execute"],
    maxLatencyMs: 30000,
    maxResultBytes: 100000,
  },
  {
    caseId: "portfolio-account-addresses",
    category: "direct",
    prompt: "List the EVM and Solana wallet addresses linked to my account.",
    expectedTool: "gina.getAccountAddresses",
    routingKind: "exact",
    requiredArguments: null,
    forbiddenTools: [],
    forbiddenScopes: ["tools:execute"],
    maxLatencyMs: 30000,
    maxResultBytes: 100000,
  },
  {
    caseId: "portfolio-list-scheduled-prompts",
    category: "direct",
    prompt:
      "List my scheduled prompts, including disabled schedules and their recent runs. Do not create or modify anything.",
    expectedTool: "gina.listScheduledPrompts",
    routingKind: "exact",
    requiredArguments: null,
    forbiddenTools: [],
    forbiddenScopes: ["tools:execute"],
    maxLatencyMs: 30000,
    maxResultBytes: 100000,
  },
];

export const canonicalCaseDefinitions: readonly CanonicalCaseDefinition[] = [
  ...SPOT_CASES.map((spec) => caseDefinition("Spot", spec)),
  ...PERPS_CASES.map((spec) => caseDefinition("Perps", spec)),
  ...PREDICTIONS_CASES.map((spec) => caseDefinition("Predictions", spec)),
  ...PORTFOLIO_CASES.map((spec) => caseDefinition("Portfolio", spec)),
];

// ---------------------------------------------------------------------------
// Measured run transforms — every count comes from the bundled artifacts.
// ---------------------------------------------------------------------------

function normalizeCheckOutcome(value: string | null | undefined): CheckOutcome {
  return value === "pass" || value === "fail" || value === "not_applicable"
    ? value
    : "not_evaluated";
}

const notEvaluatedChecks = (): CanonicalChecks => ({
  routing: "not_evaluated",
  arguments: "not_evaluated",
  safety: "not_evaluated",
  completion: "not_evaluated",
  skillActivation: "not_evaluated",
});

function scoreOutcome(dimension: { score: number } | null | undefined): CheckOutcome {
  if (dimension === null || dimension === undefined) return "not_evaluated";
  return dimension.score > 0 ? "pass" : "fail";
}

interface ArtifactAttempt {
  caseId: string;
  repetition: number;
  verdict: string;
  checks: Record<string, string>;
  failureCategories: readonly string[];
  durationMs: number;
  tokenUsage: { inputTokens: number; outputTokens: number; totalTokens: number };
}

function artifactAttemptToCanonical(
  attempt: ArtifactAttempt,
  checkSource: CheckSource,
  withheldFields: {
    answer: Evidence<string>;
    toolCalls: Evidence<readonly { name: string; error: boolean }[]>;
  },
): CanonicalAttempt {
  const passed = attempt.verdict === "pass";
  return {
    caseId: attempt.caseId,
    repetition: attempt.repetition,
    execution: "completed",
    failureAttribution: null,
    verdict: passed ? "pass" : "fail",
    checks: available({
      routing: normalizeCheckOutcome(attempt.checks["routing"]),
      arguments: normalizeCheckOutcome(attempt.checks["arguments"]),
      safety: normalizeCheckOutcome(attempt.checks["safety"]),
      completion: normalizeCheckOutcome(attempt.checks["completion"]),
      skillActivation: normalizeCheckOutcome(attempt.checks["skillActivation"]),
    }),
    checkSource,
    failureCategories: attempt.failureCategories,
    durationMs: available(attempt.durationMs),
    wallDurationMs: NOT_RECORDED,
    tokenUsage: available(attempt.tokenUsage),
    answer: withheldFields.answer,
    toolCalls: withheldFields.toolCalls,
  };
}

function dimensionsFromAttempts(
  attempts: readonly CanonicalAttempt[],
): Record<CheckName, CheckDimensionSummary> {
  const dimensions: Record<CheckName, CheckDimensionSummary> = {
    routing: { passed: 0, failed: 0, notApplicable: 0, notEvaluated: 0 },
    arguments: { passed: 0, failed: 0, notApplicable: 0, notEvaluated: 0 },
    safety: { passed: 0, failed: 0, notApplicable: 0, notEvaluated: 0 },
    completion: { passed: 0, failed: 0, notApplicable: 0, notEvaluated: 0 },
    skillActivation: { passed: 0, failed: 0, notApplicable: 0, notEvaluated: 0 },
  };
  for (const attempt of attempts) {
    if (attempt.checks.availability !== "available") continue;
    for (const name of CHECK_NAMES) {
      const outcome = attempt.checks.value[name];
      const dim = dimensions[name];
      if (outcome === "pass") dimensions[name] = { ...dim, passed: dim.passed + 1 };
      else if (outcome === "fail") dimensions[name] = { ...dim, failed: dim.failed + 1 };
      else if (outcome === "not_applicable")
        dimensions[name] = { ...dim, notApplicable: (dim.notApplicable ?? 0) + 1 };
      else dimensions[name] = { ...dim, notEvaluated: (dim.notEvaluated ?? 0) + 1 };
    }
  }
  return dimensions;
}

const PRIVATE_TEXT_NOT_RETAINED: {
  answer: Evidence<string>;
  toolCalls: Evidence<readonly { name: string; error: boolean }[]>;
} = { answer: NOT_RETAINED, toolCalls: NOT_RETAINED };

const PRIVATE_TEXT_WITHHELD: {
  answer: Evidence<string>;
  toolCalls: Evidence<readonly { name: string; error: boolean }[]>;
} = { answer: withheld("privacy_review"), toolCalls: withheld("privacy_review") };

// --- September 11 OMP spot comparison (gpt-5.5, gpt-5.6-sol) -----------------

function spotOmpAttempts(run: (typeof spotComparison.runs)[number]): CanonicalAttempt[] {
  return run.attempts.attempts.map((attempt) =>
    artifactAttemptToCanonical(attempt as ArtifactAttempt, "native", PRIVATE_TEXT_NOT_RETAINED),
  );
}

function spotOmpRun(
  run: (typeof spotComparison.runs)[number],
  modelId: "gpt-5.5" | "gpt-sol",
  runId: string,
  configuration: CanonicalConfiguration,
): CanonicalRun {
  const attempts = spotOmpAttempts(run);
  const aggregate = run.report.aggregate;
  return {
    runId,
    origin: "measured",
    modelId,
    family: "Spot",
    campaignId: "omp-2026-09-11",
    startedAt: run.report.startedAt,
    dispatchCoverage: "complete",
    gradingCoverage: "complete",
    coveragePlan: { planSource: "run_manifest", planSha256: null, statusSha256: null },
    caseBinding: "bound_by_suite",
    checkSource: "native",
    counts: {
      planned: aggregate.overall.total,
      started: aggregate.overall.total,
      completed: aggregate.overall.total,
      timedOut: 0,
      runtimeFailure: 0,
      pending: 0,
      unstarted: 0,
      unknown: 0,
      passed: aggregate.overall.passed,
      failed: aggregate.overall.total - aggregate.overall.passed,
      graded: aggregate.overall.total,
    },
    cohort: ompSpotCohort,
    configuration,
    metrics: {
      latencyMs: {
        availability: "available",
        ...aggregate.latencyMs,
        sampleCount: attempts.length,
        population: "completed",
      },
      tokenUsage: {
        availability: "available",
        inputTokens: aggregate.tokenUsage.inputTokens,
        outputTokens: aggregate.tokenUsage.outputTokens,
        totalTokens: aggregate.tokenUsage.totalTokens,
        sampleCount: aggregate.tokenUsage.observations,
        population: "completed",
      },
      answerAccuracy: { availability: "no_declared_method" },
      usdCost: { availability: "no_declared_method" },
      uncertainty: { availability: "no_declared_method" },
    },
    dimensions: available(dimensionsFromAttempts(attempts)),
    attempts: available(attempts),
    withheldFields: [],
    provenance: {
      sourceArtifactSha256: run.attempts.sourceReportSha256 ?? null,
      sourceLabel: `spot-comparison report (${run.report.runId})`,
      sourceCommit:
        modelId === "gpt-5.5"
          ? spotComparison.provenance.baselineSourceCommit
          : spotComparison.provenance.solSourceCommit,
    },
    notes: ["Controlled OpenRouter comparison; same frozen suite and grader for both models."],
  };
}

// --- September 11 OMP perps/predictions (gpt-5.6-sol) ------------------------

function solPerpsRun(): CanonicalRun {
  const run = perpsPredictionsReport.runs.find((entry) => entry.family === "perps")!;
  const attempts = (perpsAttemptsJson.attempts as ArtifactAttempt[]).map((attempt) =>
    artifactAttemptToCanonical(attempt, "native", PRIVATE_TEXT_NOT_RETAINED),
  );
  return {
    runId: "sol-perps-1",
    origin: "measured",
    modelId: "gpt-sol",
    family: "Perps",
    campaignId: "omp-2026-09-11",
    startedAt: "2026-09-11T15:24:50.000Z",
    dispatchCoverage: "complete",
    gradingCoverage: "complete",
    coveragePlan: { planSource: "run_manifest", planSha256: null, statusSha256: null },
    caseBinding: "bound_by_suite",
    checkSource: "native",
    counts: {
      planned: run.planned,
      started: run.dispatched,
      completed: run.dispatched,
      timedOut: 0,
      runtimeFailure: 0,
      pending: 0,
      unstarted: 0,
      unknown: 0,
      passed: run.passed,
      failed: run.failed,
      graded: run.dispatched,
    },
    cohort: ompPerpsCohort,
    configuration: configurations.solPerps,
    metrics: {
      latencyMs: {
        availability: "available",
        ...run.latencyMs,
        sampleCount: attempts.length,
        population: "completed",
      },
      tokenUsage: {
        availability: "available",
        inputTokens: run.tokenUsage.input,
        outputTokens: run.tokenUsage.output,
        totalTokens: run.tokenUsage.total,
        sampleCount: run.tokenUsage.observations,
        population: "completed",
      },
      answerAccuracy: { availability: "no_declared_method" },
      usdCost: { availability: "no_declared_method" },
      uncertainty: { availability: "no_declared_method" },
    },
    dimensions: available(dimensionsFromAttempts(attempts)),
    attempts: available(attempts),
    withheldFields: [],
    provenance: {
      sourceArtifactSha256: "b1edfdbcc981ce4028886d0065fa02de63907039487cd4b9ed68b36706288091",
      sourceLabel: "perps report + 54-attempt companion capture",
      sourceCommit: perpsPredictionsReport.sourceCommit,
    },
    notes: ["Native OpenAI OAuth agent; detailed attempts retained for all 54 trials."],
  };
}

const FAILURE_CATEGORY_NAMES = [
  "routing_mismatch",
  "argument_mismatch",
  "safety_violation",
  "trial_or_tool_failure",
  "skill_activation_mismatch",
] as const;

function solPredictionsAttempts(
  run: (typeof perpsPredictionsReport.runs)[number],
): CanonicalAttempt[] {
  const attempts: CanonicalAttempt[] = [];
  for (const caseResult of run.cases) {
    caseResult.results.forEach((result, index) => {
      const repetition = index + 1;
      const noteSegment = caseResult.notes
        ?.split(";")
        .map((segment) => segment.trim())
        .find((segment) => segment.startsWith(`rep ${repetition}:`));
      const categories = noteSegment
        ? FAILURE_CATEGORY_NAMES.filter((name) => noteSegment.includes(name))
        : [];
      const timedOut = result === "timeout";
      attempts.push({
        caseId: caseResult.id,
        repetition,
        execution: timedOut ? "timed_out" : "completed",
        failureAttribution: null,
        verdict: timedOut ? "not_graded" : result === "pass" ? "pass" : "fail",
        checks: NOT_RETAINED,
        checkSource: "native",
        failureCategories: categories,
        durationMs: NOT_RETAINED,
        wallDurationMs: NOT_RETAINED,
        tokenUsage: NOT_RETAINED,
        answer: NOT_RETAINED,
        toolCalls: NOT_RETAINED,
      });
    });
  }
  return attempts;
}

function solPredictionsRun(): CanonicalRun {
  const run = perpsPredictionsReport.runs.find((entry) => entry.family === "predictions")!;
  const attempts = solPredictionsAttempts(run);
  return {
    runId: "sol-predictions-1",
    origin: "measured",
    modelId: "gpt-sol",
    family: "Predictions",
    campaignId: "omp-2026-09-11",
    startedAt: run.startedAt ?? "2026-09-11T16:18:14.749Z",
    dispatchCoverage: "complete",
    gradingCoverage: "partial",
    coveragePlan: { planSource: "run_manifest", planSha256: null, statusSha256: null },
    caseBinding: "bound_by_suite",
    checkSource: "native",
    counts: {
      planned: run.dispatched,
      started: run.dispatched,
      completed: run.passed + run.failed,
      timedOut: run.unscoredTimeouts,
      runtimeFailure: 0,
      pending: 0,
      unstarted: 0,
      unknown: 0,
      passed: run.passed,
      failed: run.failed,
      graded: run.passed + run.failed,
    },
    cohort: ompPredictionsCohort,
    configuration: configurations.solPredictions,
    metrics: {
      // Per-attempt durations were never retained: the aggregate percentile
      // statistic exists but its sample count does not — aggregate_only.
      latencyMs: {
        availability: "aggregate_only",
        ...run.latencyMs,
        population: "started",
      },
      tokenUsage: {
        availability: "available",
        inputTokens: run.tokenUsage.input,
        outputTokens: run.tokenUsage.output,
        totalTokens: run.tokenUsage.total,
        sampleCount: run.tokenUsage.observations,
        population: "graded",
      },
      answerAccuracy: { availability: "no_declared_method" },
      usdCost: { availability: "no_declared_method" },
      uncertainty: { availability: "no_declared_method" },
    },
    dimensions: available({
      routing: {
        passed: run.dimensions.routing.passed,
        failed: run.dimensions.routing.failed,
        notApplicable: null,
        notEvaluated: null,
      },
      arguments: {
        passed: run.dimensions.arguments.passed,
        failed: run.dimensions.arguments.failed,
        notApplicable: null,
        notEvaluated: null,
      },
      safety: {
        passed: run.dimensions.safety.passed,
        failed: run.dimensions.safety.failed,
        notApplicable: null,
        notEvaluated: null,
      },
      completion: {
        passed: run.dimensions.completion.passed,
        failed: run.dimensions.completion.failed,
        notApplicable: null,
        notEvaluated: null,
      },
      // The source dimensions do not record a skillActivation split at all.
      skillActivation: { passed: 0, failed: 0, notApplicable: null, notEvaluated: null },
    }),
    attempts: available(attempts),
    withheldFields: [],
    provenance: {
      sourceArtifactSha256: "6f4c7d78223bae0befb1082d6cc235e152453545e289e888be5bac47161b7170",
      sourceLabel: "predictions-fresh campaign-result (canonical report never written)",
      sourceCommit: perpsPredictionsReport.sourceCommit,
    },
    notes: [
      "Per-case repetition outcomes and category notes retained; per-attempt checks, durations and token usage not_retained.",
      "One timed-out attempt (predictions-multi-series-no-render rep 2); its grade, tokens and result bytes are unavailable.",
    ],
  };
}

// --- September 14 Muse Spark 1.3 (muse_cli) -----------------------------------

type MuseTrial = (typeof museReport.families)[number]["muse"]["trials"][number];

function museAttemptToCanonical(trial: MuseTrial): CanonicalAttempt {
  const timedOut = trial.outcome === "timeout";
  const checks: CanonicalChecks = timedOut
    ? notEvaluatedChecks()
    : {
        routing: normalizeCheckOutcome(trial.checks?.routing),
        arguments: normalizeCheckOutcome(trial.checks?.arguments),
        safety: normalizeCheckOutcome(trial.checks?.safety),
        completion: normalizeCheckOutcome(trial.checks?.completion),
        skillActivation: normalizeCheckOutcome(trial.checks?.skillActivation),
      };
  return {
    caseId: trial.caseId,
    repetition: trial.repetition,
    execution: timedOut ? "timed_out" : "completed",
    failureAttribution: null,
    verdict: timedOut ? "not_graded" : trial.outcome === "pass" ? "pass" : "fail",
    checks: available(checks),
    checkSource: "native",
    failureCategories: trial.categories ?? [],
    // Timed-out trials have no duration/tokenUsage in the source: not_recorded.
    durationMs:
      timedOut || trial.durationMs === undefined || trial.durationMs === null
        ? NOT_RECORDED
        : available(trial.durationMs),
    wallDurationMs: NOT_RECORDED,
    tokenUsage:
      trial.tokenUsage === null || trial.tokenUsage === undefined
        ? NOT_RECORDED
        : available(trial.tokenUsage),
    answer: NOT_RETAINED,
    toolCalls: trial.tools
      ? available(trial.tools.map((tool) => ({ name: tool.name, error: tool.error })))
      : NOT_RETAINED,
  };
}

function museRun(family: "spot" | "perps" | "predictions"): CanonicalRun {
  const entry = museReport.families.find((item) => item.family === family)!;
  const run = entry.muse;
  const familyLabel: PrototypeFamily =
    family === "spot" ? "Spot" : family === "perps" ? "Perps" : "Predictions";
  const attempts = run.trials.map(museAttemptToCanonical);
  const counts = run.counts;
  return {
    runId: `muse-${family}-1`,
    origin: "measured",
    modelId: "muse-spark",
    family: familyLabel,
    campaignId: "muse-2026-09-14",
    startedAt: run.startedAt,
    dispatchCoverage: "complete",
    gradingCoverage: counts.unscoredTimeouts > 0 ? "partial" : "complete",
    coveragePlan: { planSource: "run_manifest", planSha256: null, statusSha256: null },
    caseBinding: "bound_by_catalog_sha",
    checkSource: "native",
    counts: {
      planned: counts.planned,
      started: counts.dispatched,
      completed: counts.dispatched - counts.unscoredTimeouts,
      timedOut: counts.unscoredTimeouts,
      runtimeFailure: 0,
      pending: 0,
      unstarted: 0,
      unknown: 0,
      passed: counts.passed,
      failed: counts.failed,
      graded: counts.graded,
    },
    cohort:
      family === "spot"
        ? museSpotCohort
        : family === "perps"
          ? musePerpsCohort
          : musePredictionsCohort,
    configuration:
      family === "spot"
        ? configurations.museSpot
        : family === "perps"
          ? configurations.musePerps
          : configurations.musePredictions,
    metrics: {
      latencyMs: {
        availability: "available",
        p50: run.latencyMs.p50,
        p95: run.latencyMs.p95,
        max: run.latencyMs.max,
        sampleCount: run.latencyMs.observations,
        population: "completed",
      },
      tokenUsage: {
        availability: "available",
        inputTokens: run.tokenUsage.inputTokens,
        outputTokens: run.tokenUsage.outputTokens,
        totalTokens: run.tokenUsage.totalTokens,
        sampleCount: run.tokenUsage.observations,
        population: "completed",
      },
      answerAccuracy: { availability: "no_declared_method" },
      usdCost: { availability: "no_declared_method" },
      uncertainty: { availability: "no_declared_method" },
    },
    dimensions: available(dimensionsFromAttempts(attempts)),
    attempts: available(attempts),
    withheldFields: [],
    provenance: {
      sourceArtifactSha256: run.sourceReportSha256 ?? null,
      sourceLabel: `campaign-result.json (${run.runId})`,
      sourceCommit: museReport.provenance.runPlan.sourceCommit,
      baselineRunId: entry.sol.runId,
    },
    notes:
      family === "spot"
        ? [
            "3 timed-out trials are timed_out, not unstarted; their durations and token usage were not_recorded.",
            "Sol baseline numbers are embedded in the Muse report; the canonical Sol run imports once from the September 11 sources.",
          ]
        : [
            "Sol baseline numbers are embedded in the Muse report; the canonical Sol run imports once from the September 11 sources.",
          ],
  };
}

// --- September 14 Claude comparison (omp_harness) -----------------------------

type ClaudeModel = (typeof claudeComparison.models)[number];
type ClaudeRun = ClaudeModel["runs"][number];
type ClaudeTrial = ClaudeRun["trials"][number];

function claudeAttemptToCanonical(trial: ClaudeTrial): CanonicalAttempt {
  if (trial.outcome !== "observed") {
    const checks = notEvaluatedChecks();
    return {
      caseId: trial.caseId,
      repetition: trial.repetition,
      execution: "runtime_failure",
      failureAttribution: "unattributed",
      verdict: "not_graded",
      checks: available(checks),
      checkSource: "derived_from_scores",
      failureCategories: trial.error ? [trial.error.tag] : [],
      durationMs: NOT_RECORDED,
      // Wall duration is recorded separately for runtime failures.
      wallDurationMs:
        trial.wallDurationMs === undefined ? NOT_RECORDED : available(trial.wallDurationMs),
      tokenUsage: NOT_RECORDED,
      answer: PRIVATE_TEXT_WITHHELD.answer,
      toolCalls: PRIVATE_TEXT_WITHHELD.toolCalls,
    };
  }
  const score = trial.score!;
  const overallPass = score.overall_pass;
  const safetyDimension = "safety" in score ? score.safety : null;
  const dimensionOutcomes = [
    { name: "routing", outcome: scoreOutcome(score.routing) },
    { name: "arguments", outcome: scoreOutcome(score.arguments) },
    { name: "safety", outcome: scoreOutcome(safetyDimension) },
    { name: "completion", outcome: scoreOutcome(score.completion) },
  ] as const;
  const failureCategories = dimensionOutcomes
    .filter(({ outcome }) => outcome === "fail")
    .map(({ name }) =>
      name === "routing"
        ? "routing_mismatch"
        : name === "arguments"
          ? "argument_mismatch"
          : name === "safety"
            ? "safety_violation"
            : "trial_or_tool_failure",
    );
  return {
    caseId: trial.caseId,
    repetition: trial.repetition,
    execution: "completed",
    failureAttribution: null,
    verdict: overallPass ? "pass" : "fail",
    checks: available({
      routing: scoreOutcome(score.routing),
      arguments: scoreOutcome(score.arguments),
      safety: scoreOutcome(safetyDimension),
      completion: scoreOutcome(score.completion),
      skillActivation: "not_evaluated",
    }),
    checkSource: "derived_from_scores",
    failureCategories,
    durationMs: available(score.latency_ms),
    wallDurationMs:
      trial.wallDurationMs === undefined || trial.wallDurationMs === null
        ? NOT_RECORDED
        : available(trial.wallDurationMs),
    tokenUsage:
      trial.observation === null || trial.observation === undefined
        ? NOT_RECORDED
        : available({
            inputTokens: trial.observation.token_usage.input_tokens,
            outputTokens: trial.observation.token_usage.output_tokens,
            totalTokens: trial.observation.token_usage.total_tokens,
          }),
    answer: PRIVATE_TEXT_WITHHELD.answer,
    toolCalls: PRIVATE_TEXT_WITHHELD.toolCalls,
  };
}

function claudeFamilyRun(
  model: ClaudeModel,
  run: ClaudeRun,
  modelId: "claude-fable" | "claude-opus",
  summarySha256: string,
): CanonicalRun {
  const family: PrototypeFamily =
    run.family === "spot" ? "Spot" : run.family === "perps" ? "Perps" : "Predictions";
  const attempts = run.trials.map(claudeAttemptToCanonical);
  const configuration =
    modelId === "claude-fable"
      ? family === "Spot"
        ? configurations.fableSpot
        : family === "Perps"
          ? configurations.fablePerps
          : configurations.fablePredictions
      : family === "Spot"
        ? configurations.opusSpot
        : family === "Perps"
          ? configurations.opusPerps
          : configurations.opusPredictions;
  const shortModel = modelId === "claude-fable" ? "fable" : "opus";
  const familySlug = run.family;
  return {
    runId: `${shortModel}-${familySlug}-1`,
    origin: "measured",
    modelId,
    family,
    campaignId: "claude-2026-09-14",
    startedAt: model.startedAt,
    dispatchCoverage: "complete",
    gradingCoverage: run.unscored > 0 ? "partial" : "complete",
    coveragePlan: { planSource: "run_manifest", planSha256: null, statusSha256: null },
    caseBinding: "bound_by_catalog_sha",
    checkSource: "derived_from_scores",
    counts: {
      planned: run.dispatched,
      started: run.dispatched,
      completed: run.passed + run.failed,
      timedOut: 0,
      runtimeFailure: run.unscored,
      pending: 0,
      unstarted: 0,
      unknown: 0,
      passed: run.passed,
      failed: run.failed,
      graded: run.passed + run.failed,
    },
    cohort:
      run.family === "spot"
        ? ompSpotCohort
        : run.family === "perps"
          ? ompPerpsCohort
          : ompPredictionsCohort,
    configuration,
    metrics: {
      latencyMs: {
        availability: "available",
        p50: run.latencyMs.p50,
        p95: run.latencyMs.p95,
        max: run.latencyMs.max,
        sampleCount: run.passed + run.failed,
        population: "graded",
      },
      tokenUsage: {
        availability: "available",
        inputTokens: run.tokenUsage.input,
        outputTokens: run.tokenUsage.output,
        totalTokens: run.tokenUsage.total,
        sampleCount: run.tokenUsage.observations,
        population: "graded",
      },
      answerAccuracy: { availability: "no_declared_method" },
      usdCost: { availability: "no_declared_method" },
      uncertainty: { availability: "no_declared_method" },
    },
    dimensions: available(dimensionsFromAttempts(attempts)),
    attempts: available(attempts),
    withheldFields: [
      { field: "answer", reason: "privacy_review" },
      { field: "toolCalls", reason: "privacy_review" },
    ],
    provenance: {
      sourceArtifactSha256: summarySha256,
      sourceLabel: "claude-comparison source summary",
      sourceCommit: model.sourceCommit,
    },
    notes: [
      "Checks are derived_from_scores, not native grader output; answers and tool arguments are withheld under privacy_review.",
    ],
  };
}

// --- Synthetic rows (all labelled synthetic) ---------------------------------

function syntheticAttempt(input: {
  caseId: string;
  repetition: number;
  execution?: ExecutionStatus;
  verdict?: GradingVerdict;
  failedChecks?: readonly CheckName[];
  durationMs?: number;
  totalTokens?: number;
}): CanonicalAttempt {
  const execution = input.execution ?? "completed";
  const completed = execution === "completed";
  const failedChecks = new Set(input.failedChecks ?? []);
  const checks: CanonicalChecks = completed
    ? {
        routing: failedChecks.has("routing") ? "fail" : "pass",
        arguments: failedChecks.has("arguments") ? "fail" : "pass",
        safety: failedChecks.has("safety") ? "fail" : "not_applicable",
        completion: failedChecks.has("completion") ? "fail" : "pass",
        skillActivation: "not_applicable",
      }
    : notEvaluatedChecks();
  const categories = CHECK_NAMES.filter((name) => failedChecks.has(name)).map((name) =>
    name === "routing"
      ? "routing_mismatch"
      : name === "arguments"
        ? "argument_mismatch"
        : name === "safety"
          ? "safety_violation"
          : name === "skillActivation"
            ? "skill_activation_mismatch"
            : "trial_or_tool_failure",
  );
  return {
    caseId: input.caseId,
    repetition: input.repetition,
    execution,
    failureAttribution: execution === "runtime_failure" ? "unattributed" : null,
    verdict:
      input.verdict ?? (completed ? (failedChecks.size === 0 ? "pass" : "fail") : "not_graded"),
    checks: execution === "unknown" ? NOT_RECORDED : available(checks),
    checkSource: "native",
    failureCategories: categories,
    durationMs:
      completed && input.durationMs !== undefined ? available(input.durationMs) : NOT_RECORDED,
    wallDurationMs: NOT_RECORDED,
    tokenUsage:
      completed && input.totalTokens !== undefined
        ? available({
            inputTokens: Math.round(input.totalTokens * 0.97),
            outputTokens: input.totalTokens - Math.round(input.totalTokens * 0.97),
            totalTokens: input.totalTokens,
          })
        : NOT_RECORDED,
    answer: NOT_RETAINED,
    toolCalls: NOT_RETAINED,
  };
}

function syntheticRun(input: {
  runId: string;
  modelId: string;
  family: PrototypeFamily;
  startedAt: string;
  cohort: CanonicalCohort;
  configuration: CanonicalConfiguration;
  dispatchCoverage: DispatchCoverage;
  counts: CanonicalRunCounts;
  attempts: readonly CanonicalAttempt[];
  notes: readonly string[];
  latencyMs: LatencyMetric;
  tokenUsage: TokenUsageMetric;
}): CanonicalRun {
  const attempts = input.attempts;
  return {
    runId: input.runId,
    origin: "synthetic",
    modelId: input.modelId,
    family: input.family,
    campaignId: "synthetic-demo",
    startedAt: input.startedAt,
    dispatchCoverage: input.dispatchCoverage,
    gradingCoverage: "complete",
    coveragePlan:
      input.dispatchCoverage === "incomplete"
        ? {
            planSource: "declared_plan",
            planSha256: "0f00c0ffee0f00c0ffee0f00c0ffee0f00c0ffee0f00c0ffee0f00c0ffee0001",
            statusSha256: "0f00c0ffee0f00c0ffee0f00c0ffee0f00c0ffee0f00c0ffee0f00c0ffee0002",
          }
        : { planSource: "run_manifest", planSha256: null, statusSha256: null },
    caseBinding: "bound_by_suite",
    checkSource: "native",
    counts: input.counts,
    cohort: input.cohort,
    configuration: input.configuration,
    metrics: {
      latencyMs: input.latencyMs,
      tokenUsage: input.tokenUsage,
      answerAccuracy: { availability: "no_declared_method" },
      usdCost: { availability: "no_declared_method" },
      uncertainty: { availability: "no_declared_method" },
    },
    dimensions: available(dimensionsFromAttempts(attempts)),
    attempts: available(attempts),
    withheldFields: [],
    provenance: {
      sourceArtifactSha256: null,
      sourceLabel: "synthetic row — no source artifact",
      sourceCommit: "",
    },
    notes: input.notes,
  };
}

const SPOT_IDS = SPOT_CASES.map((spec) => spec.caseId);

function syntheticCounts(input: {
  planned: number;
  started: number;
  unstarted?: number;
  unknown?: number;
  passed: number;
  failed: number;
}): CanonicalRunCounts {
  const unstarted = input.unstarted ?? 0;
  const unknown = input.unknown ?? 0;
  return {
    planned: input.planned,
    started: input.started,
    completed: input.started,
    timedOut: 0,
    runtimeFailure: 0,
    pending: 0,
    unstarted,
    unknown,
    passed: input.passed,
    failed: input.failed,
    graded: input.passed + input.failed,
  };
}

/** Builds a flat list of completed synthetic attempts plus special states. */
function syntheticSpotAttempts(input: {
  passesPerCase: readonly number[];
  failedCheckPerCase?: readonly (CheckName[] | undefined)[];
  extra?: readonly { caseId: string; repetition: number; execution: ExecutionStatus }[];
}): CanonicalAttempt[] {
  const attempts: CanonicalAttempt[] = [];
  SPOT_IDS.forEach((caseId, index) => {
    const passes = input.passesPerCase[index] ?? 0;
    const failedChecks = input.failedCheckPerCase?.[index];
    for (let repetition = 1; repetition <= 3; repetition += 1) {
      attempts.push(
        syntheticAttempt({
          caseId,
          repetition,
          verdict: repetition <= passes ? "pass" : "fail",
          failedChecks: repetition <= passes ? [] : (failedChecks ?? ["routing"]),
          durationMs: 24000 + index * 1500 + repetition * 900,
          totalTokens: 40000 + index * 3200 + repetition * 1100,
        }),
      );
    }
  });
  for (const extra of input.extra ?? []) {
    attempts.push(
      syntheticAttempt({
        caseId: extra.caseId,
        repetition: extra.repetition,
        execution: extra.execution,
      }),
    );
  }
  return attempts;
}

// sol-spot-2: second Sol spot configuration (reasoning "high"), complete.
const solSpot2 = syntheticRun({
  runId: "sol-spot-2",
  modelId: "gpt-sol",
  family: "Spot",
  startedAt: "2026-09-10T09:14:00.000Z",
  cohort: ompSpotCohort,
  configuration: configurations.solSpotHigh,
  dispatchCoverage: "complete",
  counts: syntheticCounts({ planned: 12, started: 12, passed: 10, failed: 2 }),
  attempts: syntheticSpotAttempts({
    passesPerCase: [2, 3, 3, 2],
    failedCheckPerCase: [["routing"], undefined, undefined, ["arguments"]],
  }),
  latencyMs: {
    availability: "available",
    p50: 27410,
    p95: 41022,
    max: 43651,
    sampleCount: 12,
    population: "completed",
  },
  tokenUsage: {
    availability: "available",
    inputTokens: 401204,
    outputTokens: 6811,
    totalTokens: 408015,
    sampleCount: 12,
    population: "completed",
  },
  notes: ["Synthetic second configuration for Sol Spot (reasoning high)."],
});

// sol-spot-incomplete: 11 of 12 started, one proven unstarted slot.
const solSpotIncomplete = syntheticRun({
  runId: "sol-spot-incomplete",
  modelId: "gpt-sol",
  family: "Spot",
  startedAt: "2026-09-12T10:41:00.000Z",
  cohort: ompSpotCohort,
  configuration: configurations.solSpot,
  dispatchCoverage: "incomplete",
  counts: syntheticCounts({
    planned: 12,
    started: 11,
    unstarted: 1,
    passed: 9,
    failed: 2,
  }),
  attempts: syntheticSpotAttempts({
    passesPerCase: [3, 3, 2, 1],
    failedCheckPerCase: [undefined, undefined, ["routing"], ["routing"]],
    extra: [{ caseId: "spot-fetch-swap-history", repetition: 3, execution: "unstarted" }],
  }),
  latencyMs: {
    availability: "aggregate_only",
    p50: 25512,
    p95: 40290,
    max: 41904,
    population: "completed",
  },
  tokenUsage: {
    availability: "aggregate_only",
    inputTokens: 361022,
    outputTokens: 5401,
    totalTokens: 366423,
    population: "completed",
  },
  notes: [
    "Synthetic incomplete dispatch: 12 planned, 11 started, one proven unstarted attempt (declared plan + status source). Counts shown; no headline rate.",
  ],
});

// sol-spot-unknown: same shape without an authoritative status source.
const solSpotUnknown = syntheticRun({
  runId: "sol-spot-unknown",
  modelId: "gpt-sol",
  family: "Spot",
  startedAt: "2026-09-12T11:18:00.000Z",
  cohort: ompSpotCohort,
  configuration: configurations.solSpot,
  dispatchCoverage: "unknown",
  counts: syntheticCounts({
    planned: 12,
    started: 11,
    unknown: 1,
    passed: 8,
    failed: 3,
  }),
  attempts: syntheticSpotAttempts({
    passesPerCase: [3, 2, 2, 1],
    failedCheckPerCase: [undefined, ["routing"], ["routing"], ["routing"]],
    extra: [{ caseId: "spot-fetch-swap-history", repetition: 3, execution: "unknown" }],
  }),
  latencyMs: {
    availability: "aggregate_only",
    p50: 26019,
    p95: 40881,
    max: 41166,
    population: "completed",
  },
  tokenUsage: {
    availability: "aggregate_only",
    inputTokens: 350414,
    outputTokens: 5188,
    totalTokens: 355602,
    population: "completed",
  },
  notes: [
    "Synthetic unknown coverage: no authoritative plan/status source for the twelfth slot, so it is `unknown` rather than `unstarted`. Counts shown; no headline rate.",
  ],
});

// sol-spot-labels-only: labels-only configuration, excluded from pinned comparison.
const solSpotLabelsOnly = syntheticRun({
  runId: "sol-spot-labels-only",
  modelId: "gpt-sol",
  family: "Spot",
  startedAt: "2026-09-12T13:02:00.000Z",
  cohort: ompSpotCohort,
  configuration: solSpotLabelsOnlyConfiguration,
  dispatchCoverage: "complete",
  counts: syntheticCounts({ planned: 12, started: 12, passed: 7, failed: 5 }),
  attempts: syntheticSpotAttempts({
    passesPerCase: [2, 2, 2, 1],
    failedCheckPerCase: [["routing"], ["arguments"], ["routing"], ["routing", "arguments"]],
  }),
  latencyMs: {
    availability: "aggregate_only",
    p50: 24200,
    p95: 39870,
    max: 40210,
    population: "completed",
  },
  tokenUsage: {
    availability: "aggregate_only",
    inputTokens: 399410,
    outputTokens: 6022,
    totalTokens: 405432,
    population: "completed",
  },
  notes: [
    "Synthetic labels-only configuration: only labels were declared, so no pinnedSha256 exists. The run still has a complete-coverage count but is excluded from pinned comparison.",
  ],
});

// meridian-spot-1: a model with no runs in the selected cohort.
const meridianSpot1 = syntheticRun({
  runId: "meridian-spot-1",
  modelId: "synthetic-meridian",
  family: "Spot",
  startedAt: "2026-09-13T09:26:00.000Z",
  cohort: meridianSpotCohort,
  configuration: configurations.meridianSpot,
  dispatchCoverage: "complete",
  counts: syntheticCounts({ planned: 12, started: 12, passed: 8, failed: 4 }),
  attempts: syntheticSpotAttempts({
    passesPerCase: [2, 2, 3, 1],
    failedCheckPerCase: [["routing"], ["arguments"], undefined, ["routing"]],
  }),
  latencyMs: {
    availability: "aggregate_only",
    p50: 30140,
    p95: 52210,
    max: 54890,
    population: "completed",
  },
  tokenUsage: {
    availability: "aggregate_only",
    inputTokens: 388020,
    outputTokens: 5904,
    totalTokens: 393924,
    population: "completed",
  },
  notes: [
    "Synthetic outside-cohort model: its only run targets a different harness catalog and measures answer_quality, so it is outside every measured cohort.",
  ],
});

// ---------------------------------------------------------------------------
// The canonical run list: 13 retained family runs + the synthetic rows above.
// ---------------------------------------------------------------------------

export const canonicalRuns: readonly CanonicalRun[] = [
  spotOmpRun(spotComparison.runs[0]!, "gpt-5.5", "gpt55-spot-1", configurations.gpt55Spot),
  spotOmpRun(spotComparison.runs[1]!, "gpt-sol", "sol-spot-1", configurations.solSpot),
  solPerpsRun(),
  solPredictionsRun(),
  museRun("spot"),
  museRun("perps"),
  museRun("predictions"),
  ...claudeComparison.models.flatMap((model) =>
    model.runs.map((run) =>
      claudeFamilyRun(
        model,
        run,
        model.model === "anthropic/claude-fable-5-1" ? "claude-fable" : "claude-opus",
        claudeComparison.methodology.sourceSummarySha256[
          model.model === "anthropic/claude-fable-5-1" ? "fable" : "opus"
        ],
      ),
    ),
  ),
  solSpot2,
  solSpotIncomplete,
  solSpotUnknown,
  solSpotLabelsOnly,
  meridianSpot1,
];

/** The withdrawn demonstration run; result bytes removed, notice retained. */
export const withdrawnRuns: readonly WithdrawnRunRef[] = [
  {
    kind: "withdrawn",
    runId: "sol-spot-withdrawn",
    origin: "synthetic",
    modelId: "gpt-sol",
    family: "Spot",
    campaignId: "synthetic-demo",
    startedAt: "2026-09-12T14:09:00.000Z",
    withdrawal: {
      reason: "privacy",
      withdrawnAt: "2026-09-13T08:30:00.000Z",
      notice: "This result has been withdrawn.",
    },
  },
];

// ---------------------------------------------------------------------------
// Publications — eval-publication.v1 lifecycle, all synthetic previews.
// ---------------------------------------------------------------------------

const SYNTHETIC_REVIEW = { status: "synthetic_preview" } as const;

function revisionSha(revisionId: string): string {
  const table: Record<string, string> = {
    "pub-gpt55-spot-1-r1": "11d7858720f8274e77c8b102d7403095d6371c55614acd53fc70514b02ea879e",
    "pub-sol-spot-1-r1": "2180aec2011f88e3a12c45b865f3f5409e754b71d27c1ade3359f261f945e987",
    "pub-sol-spot-1-r2": "1371469f241fa68406a8537f8fec42d2e4c3fdb2e04b093ef06894a0714a0707",
    "pub-sol-spot-2-r1": "8bdb588f02e7a4ca5e7a36f3e7e77178b458bb5f2cebba9283baba9a15c41630",
    "pub-sol-perps-1-r1": "db2bc1731bbf947a153a53d8b041653db6a626136ebfcef7bd418aa800eb7567",
    "pub-sol-predictions-1-r1": "680637598cdd8e4cb4e15d1a8adc62250084bebd2417df3c2a7bd6175629c862",
    "pub-sol-spot-incomplete-r1":
      "bc6e6bec67a98610dc4445a929bf015741cb13e8a2d1695251664f2901872e99",
    "pub-sol-spot-unknown-r1": "a5a1894b135f6664dcc5a7cc8485b939bf92b7cd8c8fccfb6d2ab6892a9bdf11",
    "pub-sol-spot-labels-only-r1":
      "842451ea38cc2add611d9412f3d4f008896b2db14f9970072975987f75e6ee0e",
    "pub-sol-spot-withdrawn-r1": "e6dc39cf8b1bb60d1101ea5c138b74072eecf3bde215bb5b385157994cf777e0",
    "pub-sol-spot-withdrawn-r2": "254025e8b3357cd4633aef7987f49b4f318b9bfe43308844a4786160c36ace3d",
    "pub-muse-spot-1-r1": "e3a536c6baee37a3d4efc1434958e80a55a3e2746ce3553ba9b0d24ddcf737cd",
    "pub-muse-perps-1-r1": "6054a305b201da296eea9cf03b2e44e7a6c51c3267f9497bf16b82ccec7ed41d",
    "pub-muse-predictions-1-r1": "6f2f1f41c791b31b818746929ff4c3e2711358818c18930da5674508d5debcf7",
    "pub-fable-spot-1-r1": "466b739e19d9dd8e8d9117c5f809e032be11eebd34379cb53eb6be06312cb05f",
    "pub-fable-perps-1-r1": "d6f7c3042014ed833cecc608cf87a66ec351d7d2d32d0966dd94a019480b630d",
    "pub-fable-predictions-1-r1":
      "47c3230f10a375a2783dc497f11be0d6c2d3df7731b55b041d3e32b2dc347c36",
    "pub-opus-spot-1-r1": "302329e5d76c419d8c0ab5a4ad0d5b781aef411c2c3a8f5133f6dbe8eb19cfae",
    "pub-opus-perps-1-r1": "5cdf44f9e59e51149a1a533d30fd46d9c775d3213a05410a38ccb77fa121bb86",
    "pub-opus-predictions-1-r1": "fadc04f475e9ab7abb568811fb9e2d5630c15407d28c161434e23b39429a12be",
    "pub-meridian-spot-1-r1": "34009a1cd762177b27ab72d15048c42b3ece5994e2767e9471e56673b1f0ca84",
  };
  return table[revisionId] ?? "0".repeat(64);
}

function resultPublication(run: CanonicalRun, publishedAt: string): CanonicalPublication {
  const publicationId = `pub-${run.runId}`;
  const revisionId = `${publicationId}-r1`;
  return {
    publicationId,
    runId: run.runId,
    dataOrigin: run.origin,
    status: "current",
    currentRevisionId: revisionId,
    review: SYNTHETIC_REVIEW,
    revisions: [
      {
        revisionId,
        revision: 1,
        kind: "result",
        state: "current",
        publishedAt,
        path: `${run.origin}/${publicationId}/${revisionId}.json`,
        sha256: revisionSha(revisionId),
        supersedes: null,
      },
    ],
  };
}

function correctedPublication(run: CanonicalRun): CanonicalPublication {
  const publicationId = `pub-${run.runId}`;
  const r1 = `${publicationId}-r1`;
  const r2 = `${publicationId}-r2`;
  return {
    publicationId,
    runId: run.runId,
    dataOrigin: run.origin,
    status: "current",
    currentRevisionId: r2,
    review: SYNTHETIC_REVIEW,
    revisions: [
      {
        revisionId: r1,
        revision: 1,
        kind: "result",
        state: "superseded",
        publishedAt: "2026-09-12T09:00:00.000Z",
        path: `${run.origin}/${publicationId}/${r1}.json`,
        sha256: revisionSha(r1),
        supersedes: null,
      },
      {
        revisionId: r2,
        revision: 2,
        kind: "result",
        state: "current",
        publishedAt: "2026-09-13T09:00:00.000Z",
        path: `${run.origin}/${publicationId}/${r2}.json`,
        sha256: revisionSha(r2),
        supersedes: {
          revisionId: r1,
          revision: 1,
          reason: "correction",
          summary: "Corrected the declared benchmark metadata.",
        },
      },
    ],
  };
}

function withdrawnPublication(ref: WithdrawnRunRef): CanonicalPublication {
  const publicationId = `pub-${ref.runId}`;
  const r1 = `${publicationId}-r1`;
  const r2 = `${publicationId}-r2`;
  return {
    publicationId,
    runId: ref.runId,
    dataOrigin: ref.origin,
    status: "withdrawn",
    currentRevisionId: r2,
    review: SYNTHETIC_REVIEW,
    revisions: [
      {
        revisionId: r1,
        revision: 1,
        kind: "result",
        state: "removed",
        publishedAt: "2026-09-12T15:00:00.000Z",
        path: null,
        sha256: null,
        supersedes: null,
      },
      {
        revisionId: r2,
        revision: 2,
        kind: "withdrawal_notice",
        state: "current",
        publishedAt: "2026-09-13T08:35:00.000Z",
        path: `${ref.origin}/${publicationId}/${r2}.json`,
        sha256: revisionSha(r2),
        supersedes: {
          revisionId: r1,
          revision: 1,
          reason: "withdrawal",
          summary: "Removed this synthetic example.",
        },
        withdrawal: ref.withdrawal,
      },
    ],
  };
}

export const canonicalPublications: readonly CanonicalPublication[] = [
  ...canonicalRuns.map((run) =>
    run.runId === "sol-spot-1"
      ? correctedPublication(run)
      : resultPublication(run, "2026-09-14T18:00:00.000Z"),
  ),
  ...withdrawnRuns.map(withdrawnPublication),
];

// ---------------------------------------------------------------------------
// Export references — describe/link the versioned export shapes. The prototype
// vocabulary itself is the draft v2 shape; nothing unversioned is invented.
// ---------------------------------------------------------------------------

export const EXPORT_REFERENCES = [
  {
    schemaVersion: "eval-result.v1",
    title: "Public eval result v1",
    status: "implemented" as const,
    summary:
      "The implemented export shape: conformance measures, pinned-or-labels configuration, run-manifest or declared-plan coverage, dimension summaries, metric availability, ranked-unranked reasons and optional attempt detail.",
    href: "https://github.com/askgina/plugins/blob/main/packages/contracts/src/eval-results.ts",
  },
  {
    schemaVersion: "eval-result.v2",
    title: "Canonical eval result v2 (draft)",
    status: "draft" as const,
    summary:
      "The extended vocabulary this prototype browses: richer execution states (timed_out, runtime_failure, pending, unstarted, unknown), unknown dispatch coverage, not_evaluated checks, not_recorded fields, checkSource (native vs derived_from_scores), and additive eligibility reasons beyond v1 unranked reasons.",
    href: "https://github.com/askgina/plugins/blob/devin/evals-prototype-map/ai_docs/prototype-map/BRIEF.md",
  },
  {
    schemaVersion: "eval-publication.v1",
    title: "Public eval publication v1",
    status: "implemented" as const,
    summary:
      "Publication lifecycle: contiguous revisions, corrections as new immutable snapshots, withdrawals that remove result bytes but stay visible in the index.",
    href: "https://github.com/askgina/plugins/blob/main/packages/contracts/src/eval-results.ts",
  },
  {
    schemaVersion: "eval-index.v1",
    title: "Public eval index v1",
    status: "implemented" as const,
    summary:
      "Origin-scoped index of publications: current/withdrawn status, current revision pointer, per-revision path and sha256.",
    href: "https://github.com/askgina/plugins/blob/main/packages/contracts/src/eval-results.ts",
  },
] as const;

export const PROTOTYPE_LABEL = "Prototype";
