import projection from "../results/2026-09-16/reasoning-sweep/native-cost-estimates.json";
import type { CostEstimateBasis, RecordedCostEstimate } from "../canonical/canonical";

export interface NativeCostRecord {
  readonly rowId: string;
  readonly family: string;
  readonly model: string;
  readonly target: string;
  readonly method: string;
  readonly rateSource: string;
  readonly rateSourceSha256: string | null;
  readonly priceAsOf: string;
  readonly rateCard: {
    readonly inputUsdPerMillion: number;
    readonly cachedInputUsdPerMillion: number;
    readonly outputUsdPerMillion: number;
  } | null;
  readonly sourceSummarySha256: string;
  readonly sourceEvidenceSha256: string;
  readonly sampleCount: number;
  readonly population: string;
  readonly recordedAt: string;
  readonly usdTotal: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

export const publishedNativeCosts: readonly NativeCostRecord[] = projection.runs;
const basisFor: Readonly<Record<string, CostEstimateBasis>> = {
  recorded_client_estimate: "native_estimate",
  catalogue_token_rates: "catalogue_token_rates",
  published_api_rates: "published_api_rates",
  catalogue_free_tier: "catalogue_free_tier",
};
const sourceFor: Readonly<Record<string, string>> = {
  recorded_client_estimate: "Native session cost estimates; includes cache reads and writes",
  catalogue_token_rates: "Devin retained model catalogue rates; includes cache discounts",
  published_api_rates:
    "Meta standard API rates; includes cache discounts; excludes subscription charges",
  catalogue_free_tier: "Devin retained model catalogue: Free tier; excludes subscription charges",
};

/** Bind the numeric-only projection to the exact published source and population. */
export function recordedSweepCost(
  row: {
    readonly rowId: string;
    readonly model: string;
    readonly target: string;
    readonly sourceSummarySha256: string;
  },
  run: { readonly family: string; readonly graded: number },
  records: readonly NativeCostRecord[] = publishedNativeCosts,
): RecordedCostEstimate {
  if (records.length === 0) {
    return { availability: "withheld", reason: "Cost estimates are not published." };
  }
  const matches = records.filter(
    (entry) => entry.rowId === row.rowId && entry.family === run.family,
  );
  const entry = matches[0];
  const explicitFreeTier =
    entry?.method === "catalogue_free_tier" &&
    entry.target === "devin_cli" &&
    entry.rateSource === "devin_models_catalogue" &&
    entry.rateSourceSha256 !== null &&
    entry.rateCard?.inputUsdPerMillion === 0 &&
    entry.rateCard.cachedInputUsdPerMillion === 0 &&
    entry.rateCard.outputUsdPerMillion === 0;
  if (
    matches.length !== 1 ||
    entry === undefined ||
    entry.sourceSummarySha256 !== row.sourceSummarySha256 ||
    entry.model !== row.model ||
    entry.target !== row.target ||
    entry.population !== "completed" ||
    !Object.hasOwn(basisFor, entry.method) ||
    entry.sampleCount !== run.graded ||
    !Number.isInteger(entry.sampleCount) ||
    entry.sampleCount < 0 ||
    !Number.isFinite(entry.usdTotal) ||
    entry.usdTotal < 0 ||
    (entry.sampleCount === 0 ? entry.usdTotal !== 0 : entry.usdTotal === 0 && !explicitFreeTier)
  ) {
    return {
      availability: "not_recorded",
      reason: "Retained cost evidence does not match this run and its completed attempts.",
    };
  }
  return {
    availability: "available",
    basis: basisFor[entry.method]!,
    usdTotal: entry.usdTotal,
    sampleCount: entry.sampleCount,
    population: "completed",
    source: sourceFor[entry.method]!,
    recordedAt: entry.priceAsOf,
  };
}
