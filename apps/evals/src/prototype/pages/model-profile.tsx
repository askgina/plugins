// Prototype page: `#/prototype/models/:modelId` (optional `?run=<runId>`).
//
// Per ai_docs/prototype-map/BRIEF.md this page shows, for one model:
// - configuration groups keyed by exact pinnedSha256 (labels-only runs stand
//   alone — never merged into pinned groups)
// - run history newest-first per group, with corrections shown as revisions
//   and withdrawn publications visible but excluded from representative picks
// - family results + case consistency for the representative run
// - expandable run detail: case × repetition attempt matrix, per-check
//   outcomes, failure categories, task/wall durations and tokens with sample
//   counts, withheld fields, runtime failures with attribution, the labelled
//   graded-only rate, and counts-only (no rate) for incomplete/unknown runs
//
// All derivations come from ../canonical.ts + ../selectors.ts; this file only
// renders. No policy text is written here — eligibility text derives from
// reason codes.

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ModelAvatar, PageShell, Panel } from "../../components/eval-ui";
import {
  canonicalCampaigns,
  withdrawnRuns as canonicalWithdrawnRuns,
  CHECK_NAMES,
  MEASURED_FAMILIES,
  type CanonicalAttempt,
  type CanonicalRun,
  type CanonicalTokenUsage,
  type EligibilityReason,
  type PrototypeFamily,
  type WithdrawnRunRef,
} from "../canonical";
import {
  attemptsFor,
  configurationGroupKey,
  dispatchCoverageText,
  eligibilityText,
  getModel,
  getPublication,
  getRun,
  getWithdrawnRun,
  gradedOnlyRate,
  headlineFor,
  outcomeMatrixFor,
  representativeRuns,
  resolveBaselineRun,
  runHistoryFor,
  runsForModel,
} from "../selectors";
import {
  AvailabilityMark,
  CheckMark,
  CoverageChip,
  EligibilityReasonList,
  EvidenceValue,
  ExecutionChip,
  GradedOnlyRateValue,
  HeadlineValue,
  LatencyValue,
  OutcomeMatrixCell,
  OriginTag,
  PrototypeBanner,
  PrototypeTag,
  SampleCount,
  TokenUsageValue,
  VerdictChip,
} from "../components";
import "./model-profile.css";

const numberFormatter = new Intl.NumberFormat("en-US");

function formatTimestamp(iso: string): string {
  return `${iso.replace("T", " ").slice(0, 16)}Z`;
}

function shortSha(sha: string): string {
  return `${sha.slice(0, 12)}…`;
}

/** Reason codes for a run outside of any selected cohort (profile context). */
function reasonsForRun(run: CanonicalRun): EligibilityReason[] {
  const reasons: EligibilityReason[] = [];
  if (run.origin === "synthetic") reasons.push("synthetic");
  if (run.dispatchCoverage === "incomplete") reasons.push("incomplete_coverage");
  if (run.dispatchCoverage === "unknown") reasons.push("coverage_unknown");
  if (run.configuration.availability === "labels_only") {
    reasons.push("labels_only_configuration");
  }
  return reasons;
}

function percentile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[index]!;
}

/**
 * Wall durations are attempt-level evidence, not a run-level metric. Aggregate
 * the retained samples; when no attempt retained a wall duration, surface the
 * evidence state (not_recorded / not_retained) rather than a zero.
 */
function WallDurationValue({ run }: { run: CanonicalRun }) {
  if (run.attempts.availability !== "available") {
    return (
      <AvailabilityMark
        availability={run.attempts.availability}
        reason={run.attempts.availability === "withheld" ? run.attempts.reason : undefined}
      />
    );
  }
  const attempts = run.attempts.value;
  const samples = attempts.flatMap((attempt) =>
    attempt.wallDurationMs.availability === "available" ? [attempt.wallDurationMs.value] : [],
  );
  if (samples.length === 0) {
    const first = attempts[0]?.wallDurationMs;
    if (first === undefined || first.availability === "available") {
      return <AvailabilityMark availability="not_recorded" />;
    }
    return (
      <AvailabilityMark
        availability={first.availability}
        reason={first.availability === "withheld" ? first.reason : undefined}
      />
    );
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return (
    <span className="eval-proto-checks">
      <span className="lb-count">
        p50 {numberFormatter.format(percentile(sorted, 0.5))}ms · p95{" "}
        {numberFormatter.format(percentile(sorted, 0.95))}ms · max{" "}
        {numberFormatter.format(sorted[sorted.length - 1]!)}ms
      </span>
      <SampleCount sampleCount={sorted.length} population="started" />
    </span>
  );
}

interface CaseConsistencyRow {
  readonly caseId: string;
  readonly passed: number;
  readonly graded: number;
  readonly ungraded: number;
  readonly notStarted: number;
  readonly label: "consistent" | "mixed" | "ungraded";
}

/** Per-case outcome across repetitions: all-pass/all-fail = consistent. */
function caseConsistencyRows(run: CanonicalRun): readonly CaseConsistencyRow[] {
  return outcomeMatrixFor(run).map((row) => {
    const attempts = row.attempts.filter(
      (attempt): attempt is CanonicalAttempt => attempt !== undefined,
    );
    const graded = attempts.filter(
      (attempt) => attempt.verdict === "pass" || attempt.verdict === "fail",
    ).length;
    const passed = attempts.filter((attempt) => attempt.verdict === "pass").length;
    const notStarted = attempts.filter(
      (attempt) =>
        attempt.execution === "unstarted" ||
        attempt.execution === "unknown" ||
        attempt.execution === "pending",
    ).length;
    const ungraded = attempts.length - graded - notStarted;
    const label =
      graded === 0 ? "ungraded" : passed === graded || passed === 0 ? "consistent" : "mixed";
    return { caseId: row.caseId, passed, graded, ungraded, notStarted, label };
  });
}

function CaseConsistencyExtras({ row }: { row: CaseConsistencyRow }) {
  const extras: string[] = [];
  if (row.ungraded > 0) extras.push(`${row.ungraded} not graded`);
  if (row.notStarted > 0) extras.push(`${row.notStarted} not started`);
  if (extras.length === 0) return null;
  return <span className="eval-muted">{extras.join(" · ")}</span>;
}

/** Page-level case-consistency grid for a family's representative run. */
function CaseConsistencyGrid({ run }: { run: CanonicalRun }) {
  const rows = caseConsistencyRows(run);
  if (rows.length === 0) {
    return <p className="eval-proto-note">No attempt-level case detail retained.</p>;
  }
  return (
    <div className="eval-proto-consistency">
      {rows.map((row) => (
        <div className="eval-proto-consistency-item" key={row.caseId}>
          <code>{row.caseId}</code>
          <span className="eval-proto-checks">
            <span className="lb-count">
              {row.passed}/{row.graded}
            </span>
            <span className="eval-demo-label">{row.label}</span>
            <CaseConsistencyExtras row={row} />
          </span>
        </div>
      ))}
    </div>
  );
}

function AttemptChecks({ attempt }: { attempt: CanonicalAttempt }) {
  if (attempt.checks.availability !== "available") {
    return <EvidenceValue evidence={attempt.checks} renderValue={() => null} />;
  }
  const checks = attempt.checks.value;
  return (
    <span className="eval-proto-checks">
      {CHECK_NAMES.map((name) => (
        <span key={name}>
          <span className="eval-proto-check-name">{name}</span> <CheckMark outcome={checks[name]} />
        </span>
      ))}
    </span>
  );
}

function TokensCell({ usage }: { usage: CanonicalAttempt["tokenUsage"] }) {
  return (
    <EvidenceValue
      evidence={usage}
      renderValue={(value: CanonicalTokenUsage) => numberFormatter.format(value.totalTokens)}
    />
  );
}

/** The expandable run detail required by the page-2 spec. */
function RunDetail({ run }: { run: CanonicalRun }) {
  const headline = headlineFor(run);
  const gradedRate = gradedOnlyRate(run);
  const attempts = attemptsFor(run);
  const matrix = outcomeMatrixFor(run);
  const consistency = caseConsistencyRows(run);
  const publication = getPublication(run.runId);
  const campaign = canonicalCampaigns.find((entry) => entry.campaignId === run.campaignId);
  const baseline = resolveBaselineRun(run);
  const reasons = reasonsForRun(run);
  const failureCategories = [...new Set(attempts.flatMap((attempt) => attempt.failureCategories))];
  const runtimeFailures = attempts.filter((attempt) => attempt.execution === "runtime_failure");
  const maxRepetitions = matrix.reduce((max, row) => Math.max(max, row.attempts.length), 0);
  const counts: readonly [string, number][] = [
    ["planned", run.counts.planned],
    ["started", run.counts.started],
    ["completed", run.counts.completed],
    ["timed out", run.counts.timedOut],
    ["runtime failure", run.counts.runtimeFailure],
    ["pending", run.counts.pending],
    ["unstarted", run.counts.unstarted],
    ["unknown", run.counts.unknown],
    ["passed", run.counts.passed],
    ["failed", run.counts.failed],
    ["graded", run.counts.graded],
  ];

  return (
    <div className="eval-proto-run-detail">
      {reasons.length > 0 && <EligibilityReasonList reasons={reasons} />}

      <dl className="eval-proto-counts">
        {counts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{numberFormatter.format(value)}</dd>
          </div>
        ))}
        <div>
          <dt>headline</dt>
          <dd>
            <HeadlineValue headline={headline} />
          </dd>
        </div>
        {gradedRate && (
          <div>
            <dt>graded-only</dt>
            <dd>
              <GradedOnlyRateValue rate={gradedRate} />
            </dd>
          </div>
        )}
      </dl>

      {run.withheldFields.length > 0 && (
        <div className="eval-proto-detail-block">
          <h3 className="eval-proto-detail-heading">Withheld fields</h3>
          <span className="eval-proto-checks">
            {run.withheldFields.map((field) => (
              <span key={field.field}>
                <span className="eval-proto-check-name">{field.field}</span>{" "}
                <AvailabilityMark availability="withheld" reason={field.reason} />
              </span>
            ))}
          </span>
        </div>
      )}

      <div className="eval-proto-metrics">
        <div className="eval-proto-metric">
          <span className="eval-proto-metric-label">Task duration</span>
          <LatencyValue metric={run.metrics.latencyMs} />
        </div>
        <div className="eval-proto-metric">
          <span className="eval-proto-metric-label">Wall duration</span>
          <WallDurationValue run={run} />
        </div>
        <div className="eval-proto-metric">
          <span className="eval-proto-metric-label">Token usage</span>
          <TokenUsageValue metric={run.metrics.tokenUsage} />
        </div>
      </div>

      {failureCategories.length > 0 && (
        <div className="eval-proto-detail-block">
          <h3 className="eval-proto-detail-heading">Failure categories</h3>
          <span className="eval-proto-checks">
            {failureCategories.map((category) => (
              <span className="eval-demo-label" key={category}>
                {category}
              </span>
            ))}
          </span>
        </div>
      )}

      {runtimeFailures.length > 0 && (
        <p className="eval-proto-note">
          {runtimeFailures.length} runtime failure
          {runtimeFailures.length === 1 ? "" : "s"}:{" "}
          {runtimeFailures
            .map(
              (attempt) =>
                `${attempt.caseId} rep ${attempt.repetition} · ${attempt.failureAttribution ?? "unattributed"}`,
            )
            .join("; ")}
          .
        </p>
      )}

      {matrix.length > 0 && (
        <div className="eval-proto-detail-block">
          <h3 className="eval-proto-detail-heading">
            Attempt matrix · case × repetition
            {run.checkSource === "derived_from_scores" ? " · checks derived_from_scores" : ""}
          </h3>
          <div
            className="eval-proto-table-scroll"
            role="region"
            aria-label={`Attempt matrix for ${run.runId}`}
            tabIndex={0}
          >
            <table className="eval-table eval-proto-matrix">
              <thead>
                <tr>
                  <th scope="col">Case</th>
                  {Array.from({ length: maxRepetitions }, (_, index) => (
                    <th scope="col" key={index}>
                      rep {index + 1}
                    </th>
                  ))}
                  <th scope="col">Case consistency</th>
                </tr>
              </thead>
              <tbody>
                {matrix.map((row, rowIndex) => (
                  <tr key={row.caseId}>
                    <th scope="row" className="eval-proto-case">
                      {row.caseId}
                      {row.definition && <small>{row.definition.title}</small>}
                    </th>
                    {row.attempts.map((attempt, index) => (
                      <OutcomeMatrixCell attempt={attempt} key={index} />
                    ))}
                    <td>
                      {consistency[rowIndex] && (
                        <span className="eval-proto-checks">
                          <span className="lb-count">
                            {consistency[rowIndex]!.passed}/{consistency[rowIndex]!.graded}
                          </span>
                          <span className="eval-demo-label">{consistency[rowIndex]!.label}</span>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {attempts.length > 0 && (
        <div className="eval-proto-detail-block">
          <h3 className="eval-proto-detail-heading">
            Attempts · {numberFormatter.format(attempts.length)}
          </h3>
          <div
            className="eval-proto-table-scroll"
            role="region"
            aria-label={`Attempts for ${run.runId}`}
            tabIndex={0}
          >
            <table className="eval-table eval-proto-attempts">
              <thead>
                <tr>
                  <th scope="col">Case</th>
                  <th scope="col">Rep</th>
                  <th scope="col">Execution</th>
                  <th scope="col">Verdict</th>
                  <th scope="col">Checks</th>
                  <th scope="col">Failure categories</th>
                  <th scope="col">Task duration</th>
                  <th scope="col">Wall duration</th>
                  <th scope="col">Tokens</th>
                </tr>
              </thead>
              <tbody>
                {attempts.map((attempt) => (
                  <tr key={`${attempt.caseId}-${attempt.repetition}`}>
                    <th scope="row" className="eval-proto-case">
                      {attempt.caseId}
                    </th>
                    <td>{attempt.repetition}</td>
                    <td>
                      <ExecutionChip
                        execution={attempt.execution}
                        failureAttribution={attempt.failureAttribution}
                      />
                    </td>
                    <td>
                      <VerdictChip verdict={attempt.verdict} />
                    </td>
                    <td>
                      <AttemptChecks attempt={attempt} />
                    </td>
                    <td>
                      {attempt.failureCategories.length > 0 ? (
                        attempt.failureCategories.join(", ")
                      ) : (
                        <span className="eval-muted">—</span>
                      )}
                    </td>
                    <td>
                      <EvidenceValue
                        evidence={attempt.durationMs}
                        renderValue={(value: number) => `${numberFormatter.format(value)}ms`}
                      />
                    </td>
                    <td>
                      <EvidenceValue
                        evidence={attempt.wallDurationMs}
                        renderValue={(value: number) => `${numberFormatter.format(value)}ms`}
                      />
                    </td>
                    <td>
                      <TokensCell usage={attempt.tokenUsage} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {run.attempts.availability !== "available" && (
        <p className="eval-proto-note">
          Attempt-level detail:{" "}
          <AvailabilityMark
            availability={run.attempts.availability}
            reason={run.attempts.availability === "withheld" ? run.attempts.reason : undefined}
          />
        </p>
      )}

      {publication && (
        <div className="eval-proto-detail-block">
          <h3 className="eval-proto-detail-heading">
            Publication history · {publication.publicationId} · {publication.status}
          </h3>
          <ul className="eval-proto-revisions">
            {publication.revisions.map((revision) => (
              <li key={revision.revisionId}>
                <span>
                  r{revision.revision} · {revision.kind.replace("_", " ")} · {revision.state}
                </span>
                <span className="eval-muted">{formatTimestamp(revision.publishedAt)}</span>
                {revision.sha256 && <code>{shortSha(revision.sha256)}</code>}
                {revision.supersedes && (
                  <span className="eval-muted">
                    supersedes r{revision.supersedes.revision} ({revision.supersedes.reason}
                    {revision.supersedes.summary ? `: ${revision.supersedes.summary}` : ""})
                  </span>
                )}
                {revision.withdrawal && (
                  <span className="eval-muted">
                    withdrawn {formatTimestamp(revision.withdrawal.withdrawnAt)} ·{" "}
                    {revision.withdrawal.reason} · {revision.withdrawal.notice}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="eval-proto-detail-block">
        <h3 className="eval-proto-detail-heading">Provenance</h3>
        <dl className="eval-proto-kv">
          <div>
            <dt>source</dt>
            <dd>{run.provenance.sourceLabel}</dd>
          </div>
          <div>
            <dt>artifact sha256</dt>
            <dd>
              {run.provenance.sourceArtifactSha256 ? (
                shortSha(run.provenance.sourceArtifactSha256)
              ) : (
                <AvailabilityMark availability="not_retained" />
              )}
            </dd>
          </div>
          <div>
            <dt>source commit</dt>
            <dd>
              {run.provenance.sourceCommit ? (
                run.provenance.sourceCommit.slice(0, 12)
              ) : (
                <AvailabilityMark availability="not_retained" />
              )}
            </dd>
          </div>
          <div>
            <dt>cohort</dt>
            <dd>{run.cohort.cohortId}</dd>
          </div>
          <div>
            <dt>campaign</dt>
            <dd>{campaign ? `${campaign.campaignId} · ${campaign.harness}` : run.campaignId}</dd>
          </div>
          <div>
            <dt>case binding</dt>
            <dd>
              {run.caseBinding === "bound_by_catalog_sha"
                ? "definition matched by catalog hash"
                : "bound by suite"}
            </dd>
          </div>
          <div>
            <dt>check source</dt>
            <dd>{run.checkSource}</dd>
          </div>
          <div>
            <dt>dispatch coverage</dt>
            <dd>{dispatchCoverageText(run.dispatchCoverage)}</dd>
          </div>
          {baseline && (
            <div>
              <dt>embedded baseline</dt>
              <dd>
                <a href={`#/prototype/models/${baseline.modelId}?run=${baseline.runId}`}>
                  {baseline.runId}
                </a>
              </dd>
            </div>
          )}
        </dl>
      </div>

      {run.notes.length > 0 && (
        <div className="eval-proto-detail-block">
          <h3 className="eval-proto-detail-heading">Notes</h3>
          {run.notes.map((note) => (
            <p className="eval-proto-note" key={note}>
              {note}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/** A withdrawn publication row: visible in history, never expandable detail. */
function WithdrawnRunRow({ withdrawn }: { withdrawn: WithdrawnRunRef }) {
  const publication = getPublication(withdrawn.runId);
  return (
    <div className="eval-proto-run eval-proto-run-withdrawn" id={`proto-run-${withdrawn.runId}`}>
      <div className="eval-proto-run-summary">
        <span className="eval-proto-run-id">{withdrawn.runId}</span>
        <span className="eval-proto-run-date">{formatTimestamp(withdrawn.startedAt)}</span>
        <OriginTag origin={withdrawn.origin} />
        <span className="eval-demo-label">withdrawn · {withdrawn.withdrawal.reason}</span>
        <span className="eval-proto-run-tail">
          <AvailabilityMark availability="not_retained" reason="result bytes removed" />
        </span>
      </div>
      <div className="eval-proto-run-detail">
        <p className="eval-proto-note">
          {withdrawn.withdrawal.notice} Withdrawn{" "}
          {formatTimestamp(withdrawn.withdrawal.withdrawnAt)}. Excluded from the representative
          pick; the result bytes are removed but the publication stays visible in history.
        </p>
        {publication && (
          <ul className="eval-proto-revisions">
            {publication.revisions.map((revision) => (
              <li key={revision.revisionId}>
                <span>
                  r{revision.revision} · {revision.kind.replace("_", " ")} · {revision.state}
                </span>
                <span className="eval-muted">{formatTimestamp(revision.publishedAt)}</span>
                {revision.sha256 && <code>{shortSha(revision.sha256)}</code>}
                {revision.supersedes && (
                  <span className="eval-muted">
                    supersedes r{revision.supersedes.revision} ({revision.supersedes.reason})
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function RunSummaryRow({
  run,
  expanded,
  representative,
  onToggle,
}: {
  run: CanonicalRun;
  expanded: boolean;
  representative: boolean;
  onToggle: () => void;
}) {
  const publication = getPublication(run.runId);
  const currentRevision = publication?.revisions.find(
    (revision) => revision.revisionId === publication.currentRevisionId,
  );
  const corrected = publication?.revisions.some(
    (revision) => revision.supersedes?.reason === "correction",
  );
  return (
    <div className="eval-proto-run" id={`proto-run-${run.runId}`}>
      <button
        className="eval-proto-run-summary"
        type="button"
        aria-expanded={expanded}
        aria-controls={`proto-run-detail-${run.runId}`}
        onClick={onToggle}
      >
        {expanded ? (
          <ChevronDown size={14} aria-hidden="true" />
        ) : (
          <ChevronRight size={14} aria-hidden="true" />
        )}
        <span className="eval-proto-run-id">{run.runId}</span>
        <span className="eval-proto-run-date">{formatTimestamp(run.startedAt)}</span>
        <OriginTag origin={run.origin} />
        <CoverageChip coverage={run.dispatchCoverage} />
        {representative && <span className="lb-measured-pill">Representative</span>}
        {corrected && currentRevision && (
          <span className="eval-demo-label">r{currentRevision.revision} · corrected</span>
        )}
        <span className="eval-proto-run-tail">
          <HeadlineValue headline={headlineFor(run)} />
        </span>
      </button>
      {expanded && (
        <div id={`proto-run-detail-${run.runId}`}>
          <RunDetail run={run} />
        </div>
      )}
    </div>
  );
}

function ConfigurationGroup({
  runs,
  expandedRuns,
  representativeRunId,
  onToggle,
}: {
  runs: readonly CanonicalRun[];
  expandedRuns: ReadonlySet<string>;
  representativeRunId: string | undefined;
  onToggle: (runId: string) => void;
}) {
  const configuration = runs[0]!.configuration;
  const labelsOnly = configuration.availability === "labels_only";
  return (
    <section className="eval-proto-group" aria-label={`Configuration ${configuration.candidate}`}>
      <h3 className="eval-proto-group-heading">
        {labelsOnly ? (
          <>
            <span className="eval-demo-label">labels only</span>
            <code>{configuration.configurationId}</code>
          </>
        ) : (
          <>
            <span className="eval-demo-label">pinned</span>
            <code>{shortSha(configuration.pinnedSha256 ?? "")}</code>
          </>
        )}
        <span className="eval-muted">
          candidate <code>{configuration.candidate}</code> · model{" "}
          <code>{configuration.model}</code>
          {configuration.reasoning ? ` · reasoning ${configuration.reasoning}` : ""}
        </span>
        <span className="eval-muted">
          {runs.length} run{runs.length === 1 ? "" : "s"}
        </span>
      </h3>
      {labelsOnly && (
        <p className="eval-proto-group-note">{eligibilityText("labels_only_configuration")}</p>
      )}
      <div className="eval-proto-run-list">
        {runs.map((run) => (
          <RunSummaryRow
            key={run.runId}
            run={run}
            expanded={expandedRuns.has(run.runId)}
            representative={run.runId === representativeRunId}
            onToggle={() => onToggle(run.runId)}
          />
        ))}
      </div>
    </section>
  );
}

function FamilySection({
  modelId,
  family,
  expandedRuns,
  representativeRunId,
  onToggle,
}: {
  modelId: string;
  family: PrototypeFamily;
  expandedRuns: ReadonlySet<string>;
  representativeRunId: string | undefined;
  onToggle: (runId: string) => void;
}) {
  const history = runHistoryFor(modelId, family);
  const withdrawn = canonicalWithdrawnRuns.filter(
    (entry) => entry.modelId === modelId && entry.family === family,
  );
  if (history.length === 0 && withdrawn.length === 0) return null;

  const groups = new Map<string, CanonicalRun[]>();
  for (const run of history) {
    const key = configurationGroupKey(run);
    const group = groups.get(key) ?? [];
    group.push(run);
    groups.set(key, group);
  }
  const pinnedGroups = [...groups.entries()].filter(
    ([, groupRuns]) => groupRuns[0]!.configuration.availability === "pinned",
  );
  const labelsOnlyGroups = [...groups.entries()].filter(
    ([, groupRuns]) => groupRuns[0]!.configuration.availability === "labels_only",
  );
  const representativeRun = representativeRunId ? getRun(representativeRunId) : undefined;

  return (
    <Panel
      title={`${family} runs`}
      description={`${history.length} run${history.length === 1 ? "" : "s"} · ${groups.size} configuration group${groups.size === 1 ? "" : "s"}${withdrawn.length > 0 ? ` · ${withdrawn.length} withdrawn` : ""} · history newest first`}
    >
      <div className="eval-proto-panel-body eval-proto-stack">
        {representativeRun && (
          <div className="eval-proto-detail-block">
            <h3 className="eval-proto-detail-heading">
              Case consistency · representative run {representativeRun.runId}
            </h3>
            <CaseConsistencyGrid run={representativeRun} />
          </div>
        )}
        {pinnedGroups.map(([key, groupRuns]) => (
          <ConfigurationGroup
            key={key}
            runs={groupRuns}
            expandedRuns={expandedRuns}
            representativeRunId={representativeRunId}
            onToggle={onToggle}
          />
        ))}
        {labelsOnlyGroups.map(([key, groupRuns]) => (
          <ConfigurationGroup
            key={key}
            runs={groupRuns}
            expandedRuns={expandedRuns}
            representativeRunId={representativeRunId}
            onToggle={onToggle}
          />
        ))}
        {withdrawn.length > 0 && (
          <section className="eval-proto-group" aria-label={`${family} withdrawn publications`}>
            <h3 className="eval-proto-group-heading">
              <span className="eval-demo-label">withdrawn</span>
              <span className="eval-muted">
                Withdrawn publications stay in history and are excluded from the representative
                pick.
              </span>
            </h3>
            <div className="eval-proto-run-list">
              {withdrawn
                .slice()
                .sort((a, b) => (a.startedAt >= b.startedAt ? -1 : 1))
                .map((entry) => (
                  <WithdrawnRunRow key={entry.runId} withdrawn={entry} />
                ))}
            </div>
          </section>
        )}
      </div>
    </Panel>
  );
}

export function PrototypeModelProfilePage({ modelId, runId }: { modelId: string; runId?: string }) {
  const model = getModel(modelId);
  const deepLinkedRun = runId !== undefined ? getRun(runId) : undefined;
  const deepLinkedWithdrawn = runId !== undefined ? getWithdrawnRun(runId) : undefined;
  const deepLinkTargetsThisModel =
    (deepLinkedRun !== undefined && deepLinkedRun.modelId === modelId) ||
    (deepLinkedWithdrawn !== undefined && deepLinkedWithdrawn.modelId === modelId);
  const unknownDeepLink =
    runId !== undefined && deepLinkedRun === undefined && deepLinkedWithdrawn === undefined;

  const initialExpanded = useMemo(() => {
    const expanded = new Set<string>();
    if (model) {
      for (const family of MEASURED_FAMILIES) {
        const representative = representativeRuns(family).find((row) => row.modelId === model.id);
        if (representative) expanded.add(representative.run.runId);
      }
    }
    if (deepLinkedRun !== undefined && deepLinkedRun.modelId === modelId) {
      expanded.add(deepLinkedRun.runId);
    }
    return expanded;
    // Page remounts per route (key={route}); the initializer captures the deep link.
  }, [deepLinkedRun, model, modelId]);

  const [expandedRuns, setExpandedRuns] = useState<ReadonlySet<string>>(initialExpanded);

  useEffect(() => {
    if (!deepLinkTargetsThisModel || runId === undefined) return;
    document.getElementById(`proto-run-${runId}`)?.scrollIntoView({ block: "start" });
  }, [deepLinkTargetsThisModel, runId]);

  const toggleRun = (toggledRunId: string) => {
    setExpandedRuns((current) => {
      const next = new Set(current);
      if (next.has(toggledRunId)) next.delete(toggledRunId);
      else next.add(toggledRunId);
      return next;
    });
  };

  if (!model) {
    return (
      <PageShell active="canary">
        <div className="eval-container eval-proto-model-page">
          <section
            className="eval-hero eval-proto-not-found"
            aria-labelledby="prototype-model-title"
          >
            <nav className="eval-proto-breadcrumbs" aria-label="Breadcrumb">
              <a href="#/prototype/leaderboard">Leaderboard</a>
              <span aria-hidden="true">/</span>
              <span>Models</span>
              <span aria-hidden="true">/</span>
              <span aria-current="page">Not found</span>
            </nav>
            <p className="eval-eyebrow">
              Model profile · <PrototypeTag />
            </p>
            <h1 className="eval-title" id="prototype-model-title">
              Model not found<span>.</span>
            </h1>
            <p className="eval-description">
              The prototype dataset does not include a model with the ID <code>{modelId}</code>.
            </p>
            <a className="eval-text-link" href="#/prototype/leaderboard">
              Back to the prototype leaderboard
            </a>
          </section>
        </div>
      </PageShell>
    );
  }

  const modelRuns = runsForModel(model.id);
  const familyRows = MEASURED_FAMILIES.flatMap((family) => {
    const history = modelRuns.filter((run) => run.family === family);
    if (history.length === 0) return [];
    const representative = representativeRuns(family).find((row) => row.modelId === model.id);
    const groups = new Set(history.map((run) => configurationGroupKey(run)));
    return [{ family, history, representative, configurationGroups: groups.size }];
  });
  const campaigns = [
    ...new Map(
      modelRuns
        .map((run) => canonicalCampaigns.find((campaign) => campaign.campaignId === run.campaignId))
        .filter((campaign) => campaign !== undefined)
        .map((campaign) => [campaign.campaignId, campaign]),
    ).values(),
  ];

  return (
    <PageShell active="canary">
      <div className="eval-container eval-proto-model-page">
        <section
          className="eval-hero eval-proto-model-hero"
          aria-labelledby="prototype-model-title"
        >
          <div className="eval-proto-hero-main">
            <nav className="eval-proto-breadcrumbs" aria-label="Breadcrumb">
              <a href="#/prototype/leaderboard">Leaderboard</a>
              <span aria-hidden="true">/</span>
              <span>Models</span>
              <span aria-hidden="true">/</span>
              <span aria-current="page">{model.name}</span>
            </nav>
            <p className="eval-eyebrow">
              Model profile · <OriginTag origin={model.origin} /> <PrototypeTag />
            </p>
            <div className="eval-proto-title-row">
              <ModelAvatar model={model} size="lg" />
              <h1 className="eval-title" id="prototype-model-title">
                {model.name}
                <span>.</span>
              </h1>
            </div>
            <p className="eval-proto-meta">
              {model.provider} · <code>{model.providerModel}</code>
            </p>
            <p className="eval-description">
              Configuration groups, run history, and attempt-level detail for the canonical
              prototype dataset. Measured counts come from the bundled September campaign artifacts;
              synthetic rows are labelled.
            </p>
          </div>
          <div className="eval-proto-hero-side">
            <strong>Campaigns</strong>
            {campaigns.map((campaign) => (
              <span key={campaign.campaignId}>
                {campaign.campaignId} · {campaign.date} · {campaign.harness}
              </span>
            ))}
          </div>
        </section>

        <div className="eval-proto-stack">
          <PrototypeBanner />

          {runId !== undefined && !deepLinkTargetsThisModel && (
            <p className="eval-panel eval-proto-note">
              {unknownDeepLink
                ? `Requested run ${runId} is not in the canonical dataset.`
                : `Requested run ${runId} belongs to a different model.`}{" "}
              Showing the full history for {model.name}.
            </p>
          )}

          {familyRows.length === 0 ? (
            <Panel title="Runs">
              <p className="eval-proto-note">
                No runs recorded for this model in the prototype dataset.
              </p>
            </Panel>
          ) : (
            <Panel
              title="Family results"
              description="One row per family with retained runs; the representative run is the newest published execution with complete dispatch coverage."
            >
              <div
                className="eval-proto-table-scroll"
                role="region"
                aria-label="Family results"
                tabIndex={0}
              >
                <table className="eval-table eval-proto-table">
                  <thead>
                    <tr>
                      <th scope="col">Family</th>
                      <th scope="col">Representative run</th>
                      <th scope="col">Passes / started</th>
                      <th scope="col">Coverage</th>
                      <th scope="col">Runs</th>
                      <th scope="col">Config groups</th>
                    </tr>
                  </thead>
                  <tbody>
                    {familyRows.map(({ family, history, representative, configurationGroups }) => (
                      <tr key={family}>
                        <th scope="row">{family}</th>
                        <td>
                          {representative ? (
                            <a
                              className="eval-text-link"
                              href={`#/prototype/models/${model.id}?run=${representative.run.runId}`}
                            >
                              {representative.run.runId}
                            </a>
                          ) : (
                            <AvailabilityMark availability="not_retained" />
                          )}
                        </td>
                        <td>
                          {representative ? (
                            <HeadlineValue headline={headlineFor(representative.run)} />
                          ) : (
                            <span className="eval-muted">—</span>
                          )}
                        </td>
                        <td>
                          {representative ? (
                            <CoverageChip coverage={representative.run.dispatchCoverage} />
                          ) : (
                            <span className="eval-muted">—</span>
                          )}
                        </td>
                        <td>{history.length}</td>
                        <td>{configurationGroups}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}

          {MEASURED_FAMILIES.map((family) => {
            const representative = representativeRuns(family).find(
              (row) => row.modelId === model.id,
            );
            return (
              <FamilySection
                key={family}
                modelId={model.id}
                family={family}
                expandedRuns={expandedRuns}
                representativeRunId={representative?.run.runId}
                onToggle={toggleRun}
              />
            );
          })}
        </div>
      </div>
    </PageShell>
  );
}
