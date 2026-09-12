import type { ReactNode } from "react";
import type {
  PublicComparisonConditions,
  PublicComparisonRow,
  PublicDimensionId,
  PublicMetricValue,
} from "../lib/public-comparison";

const INTEGER = new Intl.NumberFormat("en-US");
const PERCENT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

const AVAILABILITY_LABELS = {
  not_evaluated: "Not evaluated",
  not_applicable: "Not applicable",
  not_retained: "Not retained",
  withheld: "Withheld",
} as const;

const REASON_LABELS = {
  no_declared_method: "no declared method",
  incomplete_coverage: "incomplete coverage",
  not_captured: "not captured",
  privacy_review: "privacy review",
} as const;

const EVIDENCE_LABELS = {
  available: "Attempt detail available",
  aggregate_only: "Aggregate only",
  not_retained: "Attempt detail not retained",
  withheld: "Attempt detail withheld",
  not_evaluated: "Attempt detail not evaluated",
  not_applicable: "Attempt detail not applicable",
} as const;

export function formatMetric(metric: PublicMetricValue): string {
  if (metric.availability !== "available") return AVAILABILITY_LABELS[metric.availability];
  if (metric.unit === "ratio") return `${PERCENT.format(metric.value * 100)}%`;
  if (metric.unit === "milliseconds") {
    return metric.value >= 1000
      ? `${PERCENT.format(metric.value / 1000)}s`
      : `${INTEGER.format(metric.value)}ms`;
  }
  return INTEGER.format(metric.value);
}

export function MetricValue({
  metric,
  compact = false,
}: {
  metric: PublicMetricValue;
  compact?: boolean;
}) {
  if (metric.availability !== "available") {
    return (
      <span className="eval-metric-unavailable" title={REASON_LABELS[metric.reason]}>
        {AVAILABILITY_LABELS[metric.availability]}
        {!compact && <small>{REASON_LABELS[metric.reason]}</small>}
      </span>
    );
  }
  return (
    <span className="eval-metric-value">
      <strong>{formatMetric(metric)}</strong>
      {!compact && <small>{metric.detail}</small>}
    </span>
  );
}

export function DimensionValue({
  row,
  dimension,
  compact = false,
}: {
  row: PublicComparisonRow;
  dimension: PublicDimensionId;
  compact?: boolean;
}) {
  const value = row.dimensions[dimension];
  const summary = `${INTEGER.format(value.passed)} passed, ${INTEGER.format(value.failed)} failed, ${INTEGER.format(value.notApplicable)} not applicable`;
  return (
    <span className="eval-dimension-value" title={summary} aria-label={summary}>
      <strong>{INTEGER.format(value.passed)}</strong>
      <small>{compact ? ` / ${INTEGER.format(value.failed)}` : " passed"}</small>
      {!compact && (
        <span>
          {INTEGER.format(value.failed)} failed · {INTEGER.format(value.notApplicable)} n/a
        </span>
      )}
    </span>
  );
}

export function ResultState({ row }: { row: PublicComparisonRow }) {
  return (
    <span className="eval-result-state">
      <span className="eval-state-badge">Unranked</span>
      <small>{EVIDENCE_LABELS[row.evidence]}</small>
    </span>
  );
}

function Condition({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function ComparisonConditions({ conditions }: { conditions: PublicComparisonConditions }) {
  return (
    <dl className="eval-comparison-conditions">
      <Condition label="Suite">
        <code>{conditions.suiteId}</code> v{conditions.suiteVersion}
      </Condition>
      <Condition label="Fixture version">{conditions.fixtureVersion}</Condition>
      <Condition label="Target">
        <code>{conditions.target}</code>
      </Condition>
      <Condition label="Account class">
        <code>{conditions.accountClass}</code>
      </Condition>
      <Condition label="Repetitions">{conditions.repetitions}</Condition>
      <Condition label="Catalog SHA-256">
        <code title={conditions.catalogSha}>{conditions.catalogSha.slice(0, 12)}…</code>
      </Condition>
    </dl>
  );
}
