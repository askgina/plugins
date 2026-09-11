import { useId, useState, type ReactNode } from "react";
import { ArrowUpRight, Download, GitCompare } from "lucide-react";
import { Panel } from "../../components/eval-ui";
import {
  DimensionOutcomeChart,
  LatencyEnvelopeChart,
} from "../../components/public-comparison-charts";
import {
  ComparisonConditions,
  MetricValue,
  ResultState,
} from "../../components/public-comparison-ui";
import { Button } from "../../components/ui/button";
import {
  PUBLIC_DIMENSION_DEFINITIONS,
  PUBLIC_METRIC_DEFINITIONS,
  type PublicComparisonCohort,
  type PublicComparisonRow,
} from "../../lib/public-comparison";
import type { PublicComparisonState } from "../../lib/use-public-comparison";
import { ComparisonDialog } from "./comparison-dialog";
import { serializePublicPublication } from "./public-download";
import {
  CoverageBadge,
  ProductionHero,
  ProductionLoadState,
  ProductionNotice,
  ProductionShell,
  attemptsHref,
  findProductionRun,
  formatProductionDate,
} from "./shared";
import "./run.css";

const INTEGER = new Intl.NumberFormat("en-US");
const HEADLINE_METRICS = PUBLIC_METRIC_DEFINITIONS.filter(
  ({ id }) =>
    id === "passRate" || id === "latencyP50" || id === "latencyP95" || id === "tokenUsage",
);
const UNAVAILABLE_METRICS = PUBLIC_METRIC_DEFINITIONS.filter(({ unit }) => unit === "unavailable");
const LATENCY_METRICS = PUBLIC_METRIC_DEFINITIONS.filter(({ unit }) => unit === "milliseconds");

const EVIDENCE_NOTICES = {
  aggregate_only: {
    title: "Aggregate-only publication",
    description:
      "This revision publishes aggregate counts and metrics, without individual attempt records. Per-case verdicts are unavailable. No attempt details are reconstructed from the totals.",
  },
  withheld: {
    title: "Attempt detail withheld",
    description:
      "Attempt records are withheld from this public revision. Only released aggregates are shown. Private records are not fetched or included in the download.",
  },
  not_retained: {
    title: "Attempt detail not retained",
    description:
      "Individual attempt records were not retained in this publication. The aggregate result remains available, but attempts and per-case verdicts cannot be recovered here.",
  },
  not_evaluated: {
    title: "Attempt detail not evaluated",
    description:
      "This publication marks attempt detail as not evaluated. Aggregate metrics do not establish that individual evidence is available.",
  },
  not_applicable: {
    title: "Attempt detail not applicable",
    description:
      "This publication marks attempt detail as not applicable. Only the published aggregates are shown.",
  },
} as const;

const UNRANKED_LABELS = {
  pilot: "Pilot",
  synthetic: "Synthetic preview",
  incomplete_coverage: "Incomplete coverage",
  missing_pinned_configuration: "Configuration not pinned",
} as const;

export interface RunPageProps {
  state: PublicComparisonState;
  publicationId?: string;
  comparePublicationId?: string;
}

function RecordRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function RunDetail({
  cohort,
  row,
  comparePublicationId,
}: {
  cohort: PublicComparisonCohort;
  row: PublicComparisonRow;
  comparePublicationId?: string;
}) {
  const titleId = useId();
  const compareHintId = useId();
  const [selectedCompareId, setSelectedCompareId] = useState(comparePublicationId ?? "");
  const [compareOpen, setCompareOpen] = useState(comparePublicationId !== undefined);
  const peers = cohort.rows.filter((candidate) => candidate.publicationId !== row.publicationId);
  const selectedPeer = peers.find((candidate) => candidate.publicationId === selectedCompareId);
  const invalidSelection = selectedCompareId !== "" && selectedPeer === undefined;
  const { result, publication, coverage, counts } = row;
  const { source, metrics } = result;
  const retainedAttemptCount = result.attempts?.length ?? 0;
  const evidenceNotice = row.evidence === "available" ? null : EVIDENCE_NOTICES[row.evidence];
  const unavailableMetrics = HEADLINE_METRICS.filter(
    ({ id }) => row.metrics[id].availability !== "available" && id !== "latencyP95",
  );

  const downloadPublication = () => {
    const url = URL.createObjectURL(
      new Blob([serializePublicPublication(publication)], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${publication.publicationId}-${publication.revisionId}.json`;
    document.body.append(anchor);
    try {
      anchor.click();
    } finally {
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  };

  return (
    <>
      <header className="eval-hero prod-run-hero" aria-labelledby={titleId}>
        <img className="eval-hero-art" src="/images/hero-watercolor-landscape.webp" alt="" />
        <div className="prod-run-intro">
          <nav className="prod-run-breadcrumbs" aria-label="Breadcrumb">
            <a href="#/results">Results</a>
            <span aria-hidden="true">/</span>
            <span aria-current="page">{row.candidate}</span>
          </nav>
          <p className="eval-eyebrow">Run detail · public conformance record</p>
          <h1 className="eval-title" id={titleId}>
            {row.model}
            <span>.</span>
          </h1>
          <p className="prod-run-candidate">
            Candidate <code>{row.candidate}</code>
            {row.reasoning !== null && <span> · Reasoning: {row.reasoning}</span>}
          </p>
          <p className="eval-description">
            One candidate under one set of benchmark conditions. Passes reflect the declared
            conformance checks, not answer accuracy or financial outcomes.
          </p>
          <div className="prod-run-status">
            <CoverageBadge row={row} />
            <span className="prod-badge">Current revision {publication.revision}</span>
            <span
              className={`prod-badge ${row.dataOrigin === "synthetic" ? "prod-badge--warning" : "prod-badge--neutral"}`}
            >
              {row.dataOrigin === "synthetic"
                ? "Synthetic preview · not measured"
                : "Measured publication"}
            </span>
          </div>
          <p className="prod-run-dates">
            Run started <time dateTime={row.startedAt}>{formatProductionDate(row.startedAt)}</time>
            {" · "}Published{" "}
            <time dateTime={row.publishedAt}>{formatProductionDate(row.publishedAt)}</time>
            {" · UTC"}
          </p>
        </div>
        <div className="prod-run-actions">
          <label className="prod-select-field">
            <span>Compare with</span>
            <select
              value={selectedCompareId}
              onChange={(event) => setSelectedCompareId(event.target.value)}
              disabled={peers.length === 0}
              aria-describedby={compareHintId}
              aria-invalid={invalidSelection || undefined}
            >
              <option value="">Choose a publication</option>
              {invalidSelection && (
                <option value={selectedCompareId} disabled>
                  Selection unavailable in this cohort
                </option>
              )}
              {peers.map((candidate) => (
                <option key={candidate.publicationId} value={candidate.publicationId}>
                  {candidate.model} · {candidate.candidate} · {candidate.publicationId}
                </option>
              ))}
            </select>
          </label>
          <Button
            className="prod-button"
            type="button"
            disabled={selectedPeer === undefined}
            onClick={() => setCompareOpen(true)}
          >
            <GitCompare size={16} aria-hidden="true" /> Compare publications
          </Button>
          <p className="prod-muted prod-run-action-note" id={compareHintId}>
            {peers.length === 0
              ? "No other current publications share this cohort."
              : invalidSelection
                ? "The requested comparison is not another publication in this cohort. Choose a listed publication."
                : "Only current publications with matching benchmark conditions are listed."}
          </p>
          <Button
            className="prod-run-download"
            type="button"
            variant="secondary"
            title="Supported public v1 fields for inspection, not the original indexed snapshot bytes."
            onClick={downloadPublication}
          >
            <Download size={15} aria-hidden="true" /> Download public JSON
          </Button>
          <a className="prod-inline-link" href={attemptsHref(row.publicationId)}>
            {row.evidence === "available"
              ? "Explore retained attempts"
              : "View attempt availability"}
            <ArrowUpRight size={14} aria-hidden="true" />
          </a>
          <a className="prod-inline-link" href="#/methodology">
            Read the methodology <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        </div>
      </header>

      {(coverage.status === "incomplete" ||
        evidenceNotice !== null ||
        unavailableMetrics.length > 0) && (
        <div className="prod-run-notices">
          {coverage.status === "incomplete" && (
            <ProductionNotice
              title="Incomplete coverage"
              description={`${INTEGER.format(counts.attempts.total)} of ${INTEGER.format(coverage.plannedAttempts)} planned attempts were observed across ${INTEGER.format(counts.cases.total)} of ${INTEGER.format(coverage.plannedCases)} cases. A headline pass rate and complete per-case verdicts are unavailable.`}
              tone="warning"
            />
          )}
          {evidenceNotice !== null && (
            <ProductionNotice
              {...evidenceNotice}
              tone={row.evidence === "withheld" ? "warning" : "neutral"}
            />
          )}
          {unavailableMetrics.length > 0 && (
            <ProductionNotice
              title="Public metrics unavailable"
              description={`${unavailableMetrics.map(({ label }) => label).join(", ")} unavailable in this revision. Each metric's recorded availability and reason appear below. No missing metric is recalculated from counts or retained attempts.`}
            />
          )}
        </div>
      )}

      <section className="prod-run-metrics" aria-label="Published summary metrics">
        {HEADLINE_METRICS.map((definition) => {
          const metric = row.metrics[definition.id];
          return (
            <article className="prod-run-metric" key={definition.id}>
              <h2>{definition.label}</h2>
              <MetricValue metric={metric} />
              {metric.availability === "available" && (
                <p className="prod-run-sample">
                  {definition.id === "passRate"
                    ? `${INTEGER.format(metric.sampleCount)} observed attempts · ${coverage.status} coverage`
                    : `${INTEGER.format(metric.sampleCount)} / ${INTEGER.format(counts.attempts.total)} observed attempts ${definition.id === "tokenUsage" ? "with retained usage" : "with duration samples"}`}
                </p>
              )}
              <p>{definition.description}</p>
              {definition.id === "tokenUsage" &&
                metric.availability === "available" &&
                metric.sampleCount < counts.attempts.total && (
                  <p className="prod-run-missing-usage">
                    {INTEGER.format(counts.attempts.total - metric.sampleCount)} attempts without
                    retained usage. This is not a full-run token total.
                  </p>
                )}
            </article>
          );
        })}
      </section>

      <div className="prod-run-grid">
        <Panel
          title="Check outcomes"
          description="Published verdict counts by conformance dimension."
          className="prod-run-chart"
        >
          <DimensionOutcomeChart row={row} />
          <p className="prod-run-panel-note">
            {INTEGER.format(counts.attempts.total)} observed attempts per dimension. Bar labels show
            passed / evaluated checks; not-applicable checks are excluded from that denominator.
          </p>
          <details className="prod-run-disclosure">
            <summary>Exact check counts</summary>
            <div
              className="prod-table-scroll"
              role="region"
              aria-label="Check outcome counts"
              tabIndex={0}
            >
              <table className="eval-table prod-run-dimension-table">
                <caption className="prod-sr-only">Published conformance check counts</caption>
                <thead>
                  <tr>
                    <th scope="col">Check</th>
                    <th scope="col">Passed</th>
                    <th scope="col">Failed</th>
                    <th scope="col">Not applicable</th>
                  </tr>
                </thead>
                <tbody>
                  {PUBLIC_DIMENSION_DEFINITIONS.map(({ id, label }) => (
                    <tr key={id}>
                      <th scope="row">{label}</th>
                      <td>{INTEGER.format(row.dimensions[id].passed)}</td>
                      <td>{INTEGER.format(row.dimensions[id].failed)}</td>
                      <td>{INTEGER.format(row.dimensions[id].notApplicable)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </Panel>
        <Panel
          title="Observed latency"
          description="Published nearest-rank duration summaries, not a score distribution."
          className="prod-run-chart"
        >
          {metrics.latencyMs.availability === "available" && <LatencyEnvelopeChart row={row} />}
          <dl className="prod-run-latency-summary">
            {LATENCY_METRICS.map(({ id, label }) => (
              <div key={id}>
                <dt>{label}</dt>
                <dd>
                  <MetricValue metric={row.metrics[id]} />
                </dd>
              </div>
            ))}
          </dl>
          <p className="prod-run-panel-note">
            {metrics.latencyMs.availability === "available"
              ? `${INTEGER.format(metrics.latencyMs.sampleCount)} of ${INTEGER.format(counts.attempts.total)} observed attempts have duration samples. ${metrics.latencyMs.max === 0 ? "All published duration summaries are 0 ms. " : ""}These describe attempt duration, not uncertainty in the result.`
              : "The publication does not supply latency summaries. Retained attempts, if any, are not used to fill in missing aggregate metrics."}
          </p>
        </Panel>
      </div>

      <section className="prod-run-unavailable" aria-labelledby={`${titleId}-unavailable`}>
        <div className="prod-section-heading">
          <div>
            <p className="prod-kicker">Limits of this record</p>
            <h2 id={`${titleId}-unavailable`}>What these results cannot tell you</h2>
            <p>
              The v1 public contract provides no declared method for these measures. Unavailable
              does not mean zero.
            </p>
          </div>
        </div>
        <div className="prod-run-unavailable-grid">
          {UNAVAILABLE_METRICS.map(({ id, label }) => (
            <article className="prod-run-unavailable-metric" key={id}>
              <h3>{label}</h3>
              <MetricValue metric={row.metrics[id]} />
            </article>
          ))}
        </div>
      </section>

      <div className="prod-run-grid">
        <Panel
          title="Coverage and cases"
          description="Observed work stays separate from the declared plan."
          className="prod-run-record-panel"
        >
          <dl className="prod-record-list">
            <RecordRow label="Coverage">
              <CoverageBadge row={row} />
            </RecordRow>
            <RecordRow label="Observed / planned attempts">
              {INTEGER.format(counts.attempts.total)} / {INTEGER.format(coverage.plannedAttempts)}
            </RecordRow>
            <RecordRow label="Observed / planned cases">
              {INTEGER.format(counts.cases.total)} / {INTEGER.format(coverage.plannedCases)}
            </RecordRow>
            <RecordRow label="Attempt verdicts">
              {INTEGER.format(counts.attempts.passed)} passed ·{" "}
              {INTEGER.format(counts.attempts.failed)} failed
            </RecordRow>
            <RecordRow label="Cases passing every attempt">
              {counts.cases.passedEveryAttempt === null
                ? "Unavailable"
                : INTEGER.format(counts.cases.passedEveryAttempt)}
            </RecordRow>
            <RecordRow label="Cases failing any attempt">
              {counts.cases.failedAnyAttempt === null
                ? "Unavailable"
                : INTEGER.format(counts.cases.failedAnyAttempt)}
            </RecordRow>
            <RecordRow label="Retained attempt detail">
              {row.evidence === "available"
                ? `${INTEGER.format(retainedAttemptCount)} of ${INTEGER.format(counts.attempts.total)} observed attempts`
                : evidenceNotice?.title}
            </RecordRow>
            <RecordRow label="Plan source">
              {coverage.planSource === "run_manifest" ? "Run manifest" : "Declared plan"}
            </RecordRow>
          </dl>
          {(counts.cases.passedEveryAttempt === null || counts.cases.failedAnyAttempt === null) && (
            <p className="prod-run-panel-note">
              Per-case verdicts require retained attempts and complete planned coverage. They are
              not derived from aggregate counts.
            </p>
          )}
          <a
            className="prod-inline-link prod-run-panel-link"
            href={attemptsHref(row.publicationId)}
          >
            {row.evidence === "available"
              ? "Inspect retained attempts"
              : "Inspect evidence availability"}{" "}
            <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        </Panel>
        <Panel
          title="Benchmark conditions"
          description="All these values must match for two publications to share a comparison cohort."
          className="prod-run-record-panel"
        >
          <div className="prod-run-conditions">
            <ComparisonConditions conditions={cohort.conditions} />
          </div>
          <dl className="prod-record-list">
            <RecordRow label="Clean chat">
              {cohort.conditions.cleanChat ? "Required" : "Not required"}
            </RecordRow>
            <RecordRow label="Catalog SHA-256">
              <code>{cohort.conditions.catalogSha}</code>
            </RecordRow>
          </dl>
          <div className="prod-run-ranking">
            <ResultState row={row} />
            <p className="prod-muted">
              {row.unrankedReasons.map((reason) => UNRANKED_LABELS[reason]).join(" · ")}. Display
              order is not a ranking.
            </p>
          </div>
        </Panel>
      </div>

      <div className="prod-run-grid">
        <Panel
          title="Configuration identity"
          description="Published model labels and the configuration pin are separate facts."
          className="prod-run-record-panel"
        >
          {row.configuration.availability === "labels_only" && (
            <div className="prod-run-inset-notice">
              <ProductionNotice
                title="Labels-only configuration"
                description="No configuration hash was published. Matching model labels do not establish an identical or reproducible configuration."
                tone="warning"
              />
            </div>
          )}
          <dl className="prod-record-list">
            <RecordRow label="Availability">
              {row.configuration.availability === "pinned" ? "Pinned configuration" : "Labels only"}
            </RecordRow>
            <RecordRow label="Candidate">
              <code>{row.candidate}</code>
            </RecordRow>
            <RecordRow label="Model">
              <code>{row.model}</code>
            </RecordRow>
            <RecordRow label="Reasoning">{row.reasoning ?? "Not declared"}</RecordRow>
            <RecordRow label="Configuration SHA-256">
              {row.configuration.pinnedSha256 === null ? (
                "Not supplied"
              ) : (
                <code>{row.configuration.pinnedSha256}</code>
              )}
            </RecordRow>
          </dl>
        </Panel>
        <Panel
          title="Current publication"
          description="This view and its download use only the current public revision."
          className="prod-run-record-panel"
        >
          <dl className="prod-record-list">
            <RecordRow label="Publication">
              <code>{row.publicationId}</code>
            </RecordRow>
            <RecordRow label="Current revision">
              {publication.revision} · <code>{row.revisionId}</code>
            </RecordRow>
            <RecordRow label="Run">
              <code>{result.run.runId}</code>
            </RecordRow>
            <RecordRow label="Result">
              <code>{result.resultId}</code>
            </RecordRow>
            <RecordRow label="Published">
              <time dateTime={row.publishedAt}>{row.publishedAt}</time>
            </RecordRow>
            <RecordRow label="Review">
              {publication.review.status === "approved"
                ? "Manual approval"
                : "Synthetic preview, not a measured result"}
            </RecordRow>
          </dl>
          {publication.supersedes !== null ? (
            <div className="prod-run-correction">
              <h3>Correction to revision {publication.supersedes.revision}</h3>
              <p>{publication.supersedes.summary}</p>
              <p className="prod-muted">
                Replaces <code>{publication.supersedes.revisionId}</code>. Previous results are not
                loaded.
              </p>
            </div>
          ) : (
            <p className="prod-run-panel-note">
              First public revision. No previous revision is superseded.
            </p>
          )}
        </Panel>
      </div>

      <details className="prod-run-provenance">
        <summary>
          Source and publication provenance{" "}
          <span>Public identifiers, hashes and review record</span>
        </summary>
        <p className="prod-muted">
          These fields come from the current public publication. Hashes identify source artifacts;
          they are not links to private files.
        </p>
        <div className="prod-run-provenance-grid">
          <dl className="prod-record-list">
            <RecordRow label="Data origin">
              {row.dataOrigin === "synthetic" ? "Synthetic preview" : "Measured"}
            </RecordRow>
            <RecordRow label="Measure">{result.measures}</RecordRow>
            <RecordRow label="Run started">
              <time dateTime={row.startedAt}>{row.startedAt}</time>
            </RecordRow>
            <RecordRow label="Source kind">
              <code>{source.kind}</code>
            </RecordRow>
            <RecordRow label="Report schema">
              <code>{source.reportSchemaVersion}</code>
            </RecordRow>
            <RecordRow label="Report SHA-256">
              <code>{source.reportSha256}</code>
            </RecordRow>
            <RecordRow label="Attempt capture SHA-256">
              {source.attemptCaptureSha256 === null ? (
                "Not included in this public revision"
              ) : (
                <code>{source.attemptCaptureSha256}</code>
              )}
            </RecordRow>
          </dl>
          <dl className="prod-record-list">
            <RecordRow label="Publication schema">
              <code>{publication.schemaVersion}</code>
            </RecordRow>
            <RecordRow label="Result schema">
              <code>{result.schemaVersion}</code>
            </RecordRow>
            <RecordRow label="Plan SHA-256">
              {coverage.planSha256 === null ? (
                "Not supplied by run manifest"
              ) : (
                <code>{coverage.planSha256}</code>
              )}
            </RecordRow>
            <RecordRow label="Status SHA-256">
              {coverage.statusSha256 === null ? (
                "Not supplied by run manifest"
              ) : (
                <code>{coverage.statusSha256}</code>
              )}
            </RecordRow>
            {publication.review.status === "approved" ? (
              <>
                <RecordRow label="Review method">{publication.review.method}</RecordRow>
                <RecordRow label="Approved by">{publication.review.approvedBy}</RecordRow>
                <RecordRow label="Approved at">
                  <time dateTime={publication.review.approvedAt}>
                    {publication.review.approvedAt}
                  </time>
                </RecordRow>
                <RecordRow label="Review subject SHA-256">
                  <code>{publication.review.subjectSha256}</code>
                </RecordRow>
                <RecordRow label="Review record">{publication.review.record}</RecordRow>
              </>
            ) : (
              <RecordRow label="Review status">Synthetic preview</RecordRow>
            )}
          </dl>
        </div>
        <p className="prod-muted">
          The JSON download contains this publication's supported public v1 fields for inspection,
          not the original indexed snapshot bytes. Its file hash may differ from the index. It adds
          no reconstructed metrics, private source data or superseded snapshots.
        </p>
      </details>

      <ComparisonDialog
        cohort={cohort}
        selectedPublicationIds={[row.publicationId, selectedCompareId]}
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
      />
    </>
  );
}

export function RunPage({ state, publicationId, comparePublicationId }: RunPageProps) {
  if (state.status !== "ready") {
    return (
      <ProductionShell active="run">
        <div className="eval-container prod-run-page">
          <ProductionHero
            eyebrow="Public conformance record"
            title="Run detail"
            description="Current publications, declared benchmark conditions and retained evidence."
          />
          <ProductionLoadState state={state} />
        </div>
      </ProductionShell>
    );
  }

  const selected = findProductionRun(state.catalog, publicationId);
  return (
    <ProductionShell active="run" catalog={state.catalog}>
      <div className="eval-container prod-run-page">
        {selected === undefined ? (
          <>
            <ProductionHero
              eyebrow="Public conformance record"
              title={publicationId === undefined ? "No current publications" : "Run not found"}
              description="Only current, verified public publications can be opened here."
            />
            <ProductionNotice
              title={
                publicationId === undefined ? "Nothing to show yet" : "Publication unavailable"
              }
              description={
                publicationId === undefined
                  ? "The current public catalog contains no results. There are no metrics or attempts to display."
                  : "The requested publication is absent from the current public catalog. It may be unknown, removed or withdrawn. No other run or historical revision is substituted."
              }
              role="status"
            >
              <a className="prod-inline-link" href="#/results">
                Return to results <ArrowUpRight size={14} aria-hidden="true" />
              </a>
            </ProductionNotice>
          </>
        ) : (
          <RunDetail
            key={`${selected.cohort.id}:${selected.row.publicationId}:${selected.row.revisionId}`}
            cohort={selected.cohort}
            row={selected.row}
            comparePublicationId={comparePublicationId}
          />
        )}
        {state.catalog.withdrawnCount > 0 && (
          <p className="prod-run-withdrawn" role="status">
            {INTEGER.format(state.catalog.withdrawnCount)} withdrawn{" "}
            {state.catalog.withdrawnCount === 1 ? "publication is" : "publications are"} excluded
            from the catalog. Withdrawn identities and previous results are not displayed.
          </p>
        )}
      </div>
    </ProductionShell>
  );
}
