// Shared building blocks for the canonical eval-browsing UI (`#/compare`).
//
// Styling stays inside design-system classes (eval-*, lb-*, eval-compare-*)
// — no new CSS files, no raw color values. Every unavailable state renders
// through a reason-code label so withheld / not_retained / not_recorded /
// aggregate_only stay visibly distinct.

import type { ReactNode } from "react";

import type {
  CanonicalAttempt,
  CheckOutcome,
  CanonicalRun,
  DispatchCoverage,
  Evidence,
  ExecutionStatus,
  FailureAttribution,
  GradingVerdict,
  LatencyMetric,
  TokenUsageMetric,
} from "./canonical";
import {
  dispatchCoverageText,
  eligibilityText,
  gradedOnlyLabel,
  scoringCoverageFor,
  type GradedOnlyRate,
  type Headline,
} from "./selectors";

// ---------------------------------------------------------------------------
// Origin markers — measured/synthetic labelling is permanent.
// ---------------------------------------------------------------------------

/** Marks a synthetic model, run, or publication — never implied. */
export function SyntheticTag() {
  return <span className="eval-demo-label">Synthetic</span>;
}

export function MeasuredTag() {
  return <span className="lb-measured-pill">Measured</span>;
}

export function OriginTag({ origin }: { origin: "measured" | "synthetic" }) {
  return origin === "synthetic" ? <SyntheticTag /> : <MeasuredTag />;
}

// ---------------------------------------------------------------------------
// State chips
// ---------------------------------------------------------------------------

export function VerdictChip({ verdict }: { verdict: GradingVerdict }) {
  if (verdict === "pass") {
    return (
      <span className="eval-score eval-score-positive">
        <strong>pass</strong>
      </span>
    );
  }
  if (verdict === "fail") {
    return (
      <span className="eval-score eval-score-negative">
        <strong>fail</strong>
      </span>
    );
  }
  return <span className="eval-demo-label">not graded</span>;
}

const EXECUTION_LABELS: Record<ExecutionStatus, string> = {
  completed: "completed",
  timed_out: "timed out",
  runtime_failure: "runtime failure",
  pending: "pending",
  unstarted: "unstarted",
  unknown: "unknown",
};

export function ExecutionChip({
  execution,
  failureAttribution,
}: {
  execution: ExecutionStatus;
  failureAttribution?: FailureAttribution | null;
}) {
  const negative = execution === "runtime_failure";
  const label =
    execution === "runtime_failure" && failureAttribution
      ? `${EXECUTION_LABELS[execution]} · ${failureAttribution}`
      : EXECUTION_LABELS[execution];
  if (execution === "completed") {
    return (
      <span className="eval-score eval-score-positive">
        <strong>{label}</strong>
      </span>
    );
  }
  if (negative) {
    return (
      <span className="eval-score eval-score-negative">
        <strong>{label}</strong>
      </span>
    );
  }
  return <span className="eval-demo-label">{label}</span>;
}

export function CoverageChip({ run }: { run: Pick<CanonicalRun, "counts" | "dispatchCoverage"> }) {
  const coverage = scoringCoverageFor(run);
  const dispatch = dispatchCoverageText(run.dispatchCoverage);
  if (coverage === "complete") {
    return (
      <span className="eval-score eval-score-positive" title={dispatch}>
        <strong>Fully scored</strong>
      </span>
    );
  }
  return (
    <span className="eval-demo-label" title={dispatch}>
      {coverage === "none"
        ? "Not scored"
        : coverage === "partial"
          ? "Partially scored"
          : "Scoring coverage unknown"}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Availability marks — each state keeps its own label and reason.
// ---------------------------------------------------------------------------

const AVAILABILITY_LABELS: Record<string, string> = {
  withheld: "withheld",
  not_retained: "not retained",
  not_recorded: "not recorded",
  aggregate_only: "aggregate only",
  no_declared_method: "no declared method",
};

export function AvailabilityMark({
  availability,
  reason,
}: {
  availability:
    | "withheld"
    | "not_retained"
    | "not_recorded"
    | "aggregate_only"
    | "no_declared_method";
  reason?: string;
}) {
  const label = AVAILABILITY_LABELS[availability];
  return (
    <span className="eval-demo-label" title={reason ? `${label} · ${reason}` : label}>
      {reason ? `${label} · ${reason}` : label}
    </span>
  );
}

/** Renders an Evidence<> field or its availability mark. */
export function EvidenceValue<T>({
  evidence,
  children,
  renderValue,
}: {
  evidence: Evidence<T>;
  children?: ReactNode;
  renderValue?: (value: T) => ReactNode;
}) {
  if (evidence.availability === "available") {
    return <>{renderValue ? renderValue(evidence.value) : children}</>;
  }
  if (evidence.availability === "withheld") {
    return <AvailabilityMark availability="withheld" reason={evidence.reason} />;
  }
  return <AvailabilityMark availability={evidence.availability} />;
}

// ---------------------------------------------------------------------------
// Check outcomes + outcome-matrix cells
// ---------------------------------------------------------------------------

const CHECK_LABELS: Record<CheckOutcome, string> = {
  pass: "pass",
  fail: "fail",
  not_applicable: "n/a",
  not_evaluated: "not evaluated",
};

export function CheckMark({ outcome }: { outcome: CheckOutcome }) {
  if (outcome === "pass") {
    return (
      <span className="eval-score eval-score-positive">
        <strong>pass</strong>
      </span>
    );
  }
  if (outcome === "fail") {
    return (
      <span className="eval-score eval-score-negative">
        <strong>fail</strong>
      </span>
    );
  }
  return <span className="eval-demo-label">{CHECK_LABELS[outcome]}</span>;
}

/** One cell of the case × repetition outcome matrix. */
export function OutcomeMatrixCell({ attempt }: { attempt: CanonicalAttempt | undefined }) {
  if (attempt === undefined) {
    return (
      <td className="eval-muted" aria-label="no attempt">
        —
      </td>
    );
  }
  const state =
    attempt.execution === "completed"
      ? attempt.verdict === "pass"
        ? "pass"
        : attempt.verdict === "fail"
          ? "fail"
          : "not_graded"
      : attempt.execution;
  const label =
    state === "pass"
      ? "pass"
      : state === "fail"
        ? "fail"
        : state === "not_graded"
          ? "not graded"
          : EXECUTION_LABELS[attempt.execution];
  const title = `${attempt.caseId} rep ${attempt.repetition}: ${label}`;
  if (state === "pass") {
    return (
      <td title={title}>
        <span className="eval-score eval-score-positive">
          <strong>{label}</strong>
        </span>
      </td>
    );
  }
  if (state === "fail") {
    return (
      <td title={title}>
        <span className="eval-score eval-score-negative">
          <strong>{label}</strong>
        </span>
      </td>
    );
  }
  return (
    <td title={title}>
      <span className="eval-demo-label">{label}</span>
    </td>
  );
}

// ---------------------------------------------------------------------------
// Headline + graded-only rate
// ---------------------------------------------------------------------------

/** passes/started when dispatch and grading are complete; counts + reason otherwise. */
export function HeadlineValue({ headline }: { headline: Headline }) {
  if (headline.kind === "rate") {
    return (
      <span className="lb-count">
        {headline.passed}/{headline.started}
      </span>
    );
  }
  return (
    <span className="lb-cost-stack">
      <span className="lb-count">
        {headline.passed} passed · {headline.started} started
      </span>
      {headline.reason === "incomplete_grading" ? (
        <span className="eval-muted" title={eligibilityText(headline.reason)}>
          Incomplete grading · counts only · not ranked
        </span>
      ) : (
        <>
          <AvailabilityMark
            availability={
              headline.reason === "incomplete_coverage" ? "not_retained" : "not_recorded"
            }
            reason={
              headline.reason === "incomplete_coverage" ? "incomplete coverage" : "coverage unknown"
            }
          />
          <span className="eval-muted">Counts only · not ranked</span>
        </>
      )}
    </span>
  );
}

/** Graded-only rate — always carries its exclusion label. */
export function GradedOnlyRateValue({ rate }: { rate: GradedOnlyRate }) {
  return (
    <span className="eval-compare-row">
      <span className="lb-count">
        {rate.passed}/{rate.graded}
      </span>
      <span className="eval-muted">{gradedOnlyLabel(rate)}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Sample-count disclosure
// ---------------------------------------------------------------------------

/** Sample-count disclosure required next to every statistic. */
export function SampleCount({
  sampleCount,
  population,
}: {
  sampleCount: number;
  population: string;
}) {
  return (
    <span className="eval-muted">
      n={sampleCount} of {population}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Metric values — availability-aware rendering for latency and token usage.
// ---------------------------------------------------------------------------

export function LatencyValue({ metric }: { metric: LatencyMetric }) {
  if (metric.availability === "available") {
    return (
      <span className="eval-compare-chip-row">
        <span className="lb-count">
          p50 {metric.p50}ms · p95 {metric.p95}ms · max {metric.max}ms
        </span>
        <SampleCount sampleCount={metric.sampleCount} population={metric.population} />
      </span>
    );
  }
  if (metric.availability === "aggregate_only") {
    return (
      <span className="eval-compare-chip-row">
        <span className="lb-count">
          p50 {metric.p50}ms · p95 {metric.p95}ms · max {metric.max}ms
        </span>
        <AvailabilityMark
          availability="aggregate_only"
          reason={`${metric.population} population`}
        />
      </span>
    );
  }
  return <AvailabilityMark availability={metric.availability} reason={metric.reason} />;
}

export function TokenUsageValue({ metric }: { metric: TokenUsageMetric }) {
  if (metric.availability === "available" || metric.availability === "aggregate_only") {
    const total = metric.totalTokens.toLocaleString("en-US");
    return (
      <span className="eval-compare-chip-row">
        <span className="lb-count">
          {total} tokens ({metric.inputTokens.toLocaleString("en-US")} in ·{" "}
          {metric.outputTokens.toLocaleString("en-US")} out)
        </span>
        {metric.availability === "available" ? (
          <SampleCount sampleCount={metric.sampleCount} population={metric.population} />
        ) : (
          <AvailabilityMark
            availability="aggregate_only"
            reason={`${metric.population} population`}
          />
        )}
      </span>
    );
  }
  return <AvailabilityMark availability={metric.availability} reason={metric.reason} />;
}

// ---------------------------------------------------------------------------
// Coverage text helper re-exported for pages.
// ---------------------------------------------------------------------------

export function CoverageLabel({ coverage }: { coverage: DispatchCoverage }) {
  return <span className="eval-muted">{dispatchCoverageText(coverage)}</span>;
}
