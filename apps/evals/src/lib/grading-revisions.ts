import perpsReceipt from "../results/2026-09-21/regrade/perps-receipt.json";
import receipt from "../results/2026-09-21/regrade/receipt.json";
import type { CanonicalAttempt, CheckOutcome, GradingVerdict } from "../canonical/canonical";

export const PERPS_GRADING_POLICY = "perps-price-evidence-v1";
export const SEARCH_GRADING_POLICY = "bounded-prediction-search-v1";

export interface GradingRevisionEntry {
  readonly runId: string;
  readonly caseId: string;
  readonly repetition: number;
  readonly sourceSummarySha256: string;
  readonly transcriptSha256: string;
  readonly kind: "bounded_search" | "provider_error" | "perps_price";
  readonly previousArguments?: CheckOutcome;
  readonly arguments?: CheckOutcome;
  readonly priceGrounding?: { readonly outcome: "pass" | "fail"; readonly detail: string };
  readonly previousRouting: CheckOutcome;
  readonly routing: CheckOutcome;
  readonly previousVerdict: GradingVerdict;
  readonly verdict: GradingVerdict;
  readonly excludedCostUsd: number;
}

export const gradingRevisionEntries: readonly GradingRevisionEntry[] =
  receipt.entries as readonly GradingRevisionEntry[];

export const perpsGradingEntries: readonly GradingRevisionEntry[] =
  perpsReceipt.entries as readonly GradingRevisionEntry[];

export function reviseAttempt(
  attempt: CanonicalAttempt,
  entry: GradingRevisionEntry,
): CanonicalAttempt {
  if (
    attempt.execution !== "completed" ||
    attempt.checks.availability !== "available" ||
    attempt.conversation?.sourceSummarySha256 !== entry.sourceSummarySha256 ||
    attempt.verdict !== entry.previousVerdict ||
    attempt.checks.value.routing !== entry.previousRouting ||
    (entry.kind === "perps_price" &&
      (attempt.checks.value.arguments !== entry.previousArguments ||
        !entry.priceGrounding ||
        !entry.arguments))
  )
    throw new Error("Grading revision does not match its original evidence");
  const revision = {
    policyId: entry.kind === "perps_price" ? PERPS_GRADING_POLICY : SEARCH_GRADING_POLICY,
    ...(entry.priceGrounding ? { priceGrounding: entry.priceGrounding } : {}),
    kind: entry.kind,
    previousVerdict: attempt.verdict,
    previousChecks: attempt.checks.value,
  };
  if (entry.kind === "provider_error") {
    return {
      ...attempt,
      gradingRevision: revision,
      execution: "runtime_failure",
      verdict: "not_graded",
      failureAttribution: "infrastructure",
      failureCategories: ["provider_configuration_error"],
      checks: {
        availability: "available",
        value: {
          routing: "not_evaluated",
          arguments: "not_evaluated",
          safety: "not_evaluated",
          completion: "not_evaluated",
          skillActivation: "not_evaluated",
        },
      },
      durationMs: { availability: "not_recorded" },
      wallDurationMs:
        attempt.wallDurationMs.availability === "available"
          ? attempt.wallDurationMs
          : attempt.durationMs,
    };
  }
  return {
    ...attempt,
    gradingRevision: revision,
    verdict: entry.verdict,
    checks: {
      availability: "available",
      value: {
        ...attempt.checks.value,
        routing: entry.routing,
        ...(entry.arguments ? { arguments: entry.arguments } : {}),
      },
    },
    failureCategories: [
      ...attempt.failureCategories.filter(
        (reason) =>
          reason !== "routing_mismatch" &&
          (entry.kind !== "perps_price" || reason !== "argument_mismatch"),
      ),
      ...(entry.kind === "perps_price" && entry.arguments === "fail" ? ["argument_mismatch"] : []),
      ...(entry.priceGrounding?.outcome === "fail" ? ["price_grounding_mismatch"] : []),
      ...(entry.routing === "fail" ? ["routing_mismatch"] : []),
    ],
  };
}
