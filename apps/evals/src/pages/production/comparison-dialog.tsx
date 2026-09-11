import type { ReactNode } from "react";
import {
  ComparisonConditions,
  DimensionValue,
  MetricValue,
} from "../../components/public-comparison-ui";
import {
  PUBLIC_DIMENSION_DEFINITIONS,
  PUBLIC_METRIC_DEFINITIONS,
  type PublicComparisonCohort,
  type PublicComparisonRow,
  type PublicDimensionId,
  type PublicMetricValue,
} from "../../lib/public-comparison";
import {
  CandidateIdentity,
  CoverageBadge,
  ProductionDialog,
  ProductionNotice,
  formatProductionDate,
} from "./shared";
import "./run.css";

const INTEGER = new Intl.NumberFormat("en-US");

const EVIDENCE_LABELS = {
  available: "Attempt detail retained",
  aggregate_only: "Aggregate only",
  not_retained: "Attempt detail not retained",
  withheld: "Attempt detail withheld",
  not_evaluated: "Attempt detail not evaluated",
  not_applicable: "Attempt detail not applicable",
} as const;

const ORIGIN_LABELS = {
  synthetic: "Synthetic preview, not measured",
  measured: "Measured",
} as const;

type Pair = { left: PublicComparisonRow; right: PublicComparisonRow };
type Rejection = { title: string; description: string };

function uniqueRow(
  cohort: PublicComparisonCohort,
  publicationId: string | undefined,
): PublicComparisonRow | undefined {
  if (publicationId === undefined) return undefined;
  let match: PublicComparisonRow | undefined;
  for (const row of cohort.rows) {
    if (row.publicationId !== publicationId) continue;
    if (match !== undefined) return undefined;
    match = row;
  }
  return match;
}

function resolvePair(cohort: PublicComparisonCohort, ids: readonly string[]): Pair | Rejection {
  if (ids.length !== 2) {
    return {
      title: "Select exactly two publications",
      description:
        ids.length === 0
          ? "Nothing is selected. Choose two current publications from this cohort."
          : `${INTEGER.format(ids.length)} ${ids.length === 1 ? "publication is" : "publications are"} selected. A comparison needs exactly two.`,
    };
  }
  const [leftId, rightId] = ids;
  if (leftId === rightId) {
    return {
      title: "Select two different publications",
      description: `"${leftId}" is selected twice. Pick a second publication from the same cohort.`,
    };
  }
  const left = uniqueRow(cohort, leftId);
  const right = uniqueRow(cohort, rightId);
  if (left === undefined || right === undefined) {
    return {
      title: "Publications could not be resolved",
      description: "Each selection must match exactly one current publication in this cohort.",
    };
  }
  return { left, right };
}

function CompareRow({
  label,
  note,
  left,
  right,
}: {
  label: string;
  note?: string;
  left: ReactNode;
  right: ReactNode;
}) {
  return (
    <tr>
      <th scope="row">
        {label}
        {note !== undefined && <small>{note}</small>}
      </th>
      <td>{left}</td>
      <td>{right}</td>
    </tr>
  );
}

function SectionRow({ children }: { children: ReactNode }) {
  return (
    <tr className="prod-compare-section">
      <th scope="rowgroup" colSpan={3}>
        {children}
      </th>
    </tr>
  );
}

const attemptsOf = (count: number, row: PublicComparisonRow): string =>
  `${INTEGER.format(count)} of ${INTEGER.format(row.counts.attempts.total)} observed attempts`;

function MetricCell({ metric, row }: { metric: PublicMetricValue; row: PublicComparisonRow }) {
  if (metric.availability !== "available") return <MetricValue metric={metric} />;
  return (
    <span className="prod-compare-sample">
      <MetricValue metric={metric} />
      <small>Sample: {attemptsOf(metric.sampleCount, row)}</small>
    </span>
  );
}

function DimensionCell({
  row,
  dimension,
}: {
  row: PublicComparisonRow;
  dimension: PublicDimensionId;
}) {
  const { passed, failed } = row.dimensions[dimension];
  const evaluated = passed + failed;
  return (
    <span className="prod-compare-dimension">
      <DimensionValue row={row} dimension={dimension} />
      <small>Evaluated in {attemptsOf(evaluated, row)}</small>
    </span>
  );
}

function ConfigurationPin({ row }: { row: PublicComparisonRow }) {
  const sha = row.configuration.pinnedSha256;
  if (sha === null) {
    return (
      <span className="prod-compare-plain">
        Labels only
        <small>No pinned configuration bytes</small>
      </span>
    );
  }
  return (
    <details className="prod-compare-plain">
      <summary>
        Pinned <code>{sha.slice(0, 12)}</code>
      </summary>
      <small>
        SHA-256 <code>{sha}</code>
      </small>
    </details>
  );
}

function Revision({ row }: { row: PublicComparisonRow }) {
  const { revision, supersedes } = row.publication;
  return (
    <span className="prod-compare-plain">
      Revision {revision}, current
      {supersedes !== null && (
        <small>
          {supersedes.reason === "correction" ? "Corrects" : "Replaces withdrawn"} revision{" "}
          {supersedes.revision}: {supersedes.summary}
        </small>
      )}
    </span>
  );
}

const attemptCounts = (row: PublicComparisonRow): string => {
  const { total, passed, failed } = row.counts.attempts;
  return `${INTEGER.format(total)} observed · ${INTEGER.format(passed)} passed · ${INTEGER.format(failed)} failed`;
};

const caseVerdicts = (row: PublicComparisonRow): string => {
  const { total, passedEveryAttempt, failedAnyAttempt } = row.counts.cases;
  if (passedEveryAttempt === null || failedAnyAttempt === null) {
    return `${INTEGER.format(total)} unique cases · per-case verdicts not derivable`;
  }
  return `${INTEGER.format(total)} unique cases · ${INTEGER.format(passedEveryAttempt)} passed every attempt · ${INTEGER.format(failedAnyAttempt)} failed at least once`;
};

const plannedCoverage = (row: PublicComparisonRow): string =>
  `${INTEGER.format(row.counts.attempts.total)} of ${INTEGER.format(row.coverage.plannedAttempts)} planned attempts across ${INTEGER.format(row.coverage.plannedCases)} planned cases`;

function ComparisonCard({ row }: { row: PublicComparisonRow }) {
  return (
    <article className="prod-compare-card">
      <CandidateIdentity row={row} />
      <div className="prod-compare-card-badges">
        <CoverageBadge row={row} />
        <span className="prod-badge prod-badge--neutral">Revision {row.publication.revision}</span>
        <span
          className={`prod-badge ${row.dataOrigin === "synthetic" ? "prod-badge--warning" : "prod-badge--neutral"}`}
        >
          {ORIGIN_LABELS[row.dataOrigin]}
        </span>
      </div>
      <p className="prod-muted">
        Published {formatProductionDate(row.publishedAt)} · <code>{row.publicationId}</code>
      </p>
    </article>
  );
}

function ComparisonBody({ cohort, left, right }: { cohort: PublicComparisonCohort } & Pair) {
  return (
    <div className="prod-compare">
      <div className="prod-compare-grid">
        <ComparisonCard key={left.publicationId} row={left} />
        <ComparisonCard key={right.publicationId} row={right} />
      </div>

      <div
        className="prod-table-scroll prod-compare-scroll"
        role="region"
        aria-label="Publication comparison table"
        tabIndex={0}
      >
        <table className="eval-table prod-compare-table">
          <caption className="prod-sr-only">
            Side-by-side public metrics for {left.model} ({left.candidate}) and {right.model} (
            {right.candidate}) under identical benchmark conditions
          </caption>
          <thead>
            <tr>
              <th scope="col">Measure</th>
              <th scope="col">
                {left.model} <small>{left.candidate}</small>
              </th>
              <th scope="col">
                {right.model} <small>{right.candidate}</small>
              </th>
            </tr>
          </thead>
          <tbody>
            <SectionRow>Public metrics</SectionRow>
            {PUBLIC_METRIC_DEFINITIONS.map((definition) => (
              <CompareRow
                key={definition.id}
                label={definition.label}
                note={definition.description}
                left={<MetricCell metric={left.metrics[definition.id]} row={left} />}
                right={<MetricCell metric={right.metrics[definition.id]} row={right} />}
              />
            ))}
          </tbody>
          <tbody>
            <SectionRow>Observed counts</SectionRow>
            <CompareRow label="Attempts" left={attemptCounts(left)} right={attemptCounts(right)} />
            <CompareRow label="Cases" left={caseVerdicts(left)} right={caseVerdicts(right)} />
          </tbody>
          <tbody>
            <SectionRow>Check dimensions</SectionRow>
            {PUBLIC_DIMENSION_DEFINITIONS.map((definition) => (
              <CompareRow
                key={definition.id}
                label={definition.label}
                left={<DimensionCell row={left} dimension={definition.id} />}
                right={<DimensionCell row={right} dimension={definition.id} />}
              />
            ))}
          </tbody>
          <tbody>
            <SectionRow>Coverage and evidence</SectionRow>
            <CompareRow
              label="Coverage"
              left={
                <span className="prod-compare-plain">
                  <CoverageBadge row={left} />
                  <small>{plannedCoverage(left)}</small>
                </span>
              }
              right={
                <span className="prod-compare-plain">
                  <CoverageBadge row={right} />
                  <small>{plannedCoverage(right)}</small>
                </span>
              }
            />
            <CompareRow
              label="Attempt evidence"
              left={EVIDENCE_LABELS[left.evidence]}
              right={EVIDENCE_LABELS[right.evidence]}
            />
            <CompareRow
              label="Data origin"
              left={ORIGIN_LABELS[left.dataOrigin]}
              right={ORIGIN_LABELS[right.dataOrigin]}
            />
          </tbody>
          <tbody>
            <SectionRow>Publication and configuration</SectionRow>
            <CompareRow
              label="Revision"
              left={<Revision row={left} />}
              right={<Revision row={right} />}
            />
            <CompareRow
              label="Model"
              left={<code>{left.model}</code>}
              right={<code>{right.model}</code>}
            />
            <CompareRow
              label="Reasoning"
              left={left.reasoning ?? "Not declared"}
              right={right.reasoning ?? "Not declared"}
            />
            <CompareRow
              label="Configuration pin"
              left={<ConfigurationPin row={left} />}
              right={<ConfigurationPin row={right} />}
            />
          </tbody>
        </table>
      </div>

      <section className="prod-compare-conditions" aria-label="Shared benchmark conditions">
        <h3>Shared benchmark conditions</h3>
        <ComparisonConditions conditions={cohort.conditions} />
        <p className="prod-muted">
          Clean chat: {cohort.conditions.cleanChat ? "yes" : "no"}, every attempt started from an
          empty conversation. Full catalog SHA-256 <code>{cohort.conditions.catalogSha}</code>.
        </p>
      </section>

      <p className="prod-compare-note">
        This compares conformance under shared conditions, not a ranking. Answer accuracy, USD cost
        and uncertainty are not measured.
      </p>
    </div>
  );
}

export function ComparisonDialog({
  cohort,
  selectedPublicationIds,
  open,
  onClose,
}: {
  cohort: PublicComparisonCohort;
  selectedPublicationIds: readonly string[];
  open: boolean;
  onClose: () => void;
}) {
  const resolved = resolvePair(cohort, selectedPublicationIds);
  if ("title" in resolved) {
    return (
      <ProductionDialog
        title="Comparison unavailable"
        description="Comparisons only run between two current publications that share one benchmark cohort."
        open={open}
        onClose={onClose}
      >
        <div className="prod-compare">
          <ProductionNotice
            title={resolved.title}
            description={resolved.description}
            tone="warning"
            role="alert"
          />
        </div>
      </ProductionDialog>
    );
  }
  const { conditions } = cohort;
  return (
    <ProductionDialog
      title={`Compare ${resolved.left.model} and ${resolved.right.model}`}
      description={`Same cohort: ${conditions.suiteId} v${conditions.suiteVersion}, fixture v${conditions.fixtureVersion}, target ${conditions.target}, ${INTEGER.format(conditions.repetitions)} repetitions per case. Conformance, not answer accuracy.`}
      open={open}
      onClose={onClose}
    >
      <ComparisonBody cohort={cohort} left={resolved.left} right={resolved.right} />
    </ProductionDialog>
  );
}
