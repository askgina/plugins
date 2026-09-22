import { useMemo } from "react";
import { ArrowLeftRight, RotateCcw } from "lucide-react";
import { CheckDimensionPanel } from "../../components/check-dimension-radar";
import { ModelAvatar, PageShell, Panel } from "../../components/eval-ui";
import { navigate, useHashRoute } from "../../router";
import {
  canonicalCampaigns,
  canonicalRuns,
  MEASURED_FAMILIES,
  type PrototypeFamily,
  type CanonicalAttempt,
  type CanonicalRun,
  type EligibilityReason,
  type Evidence,
  type MetricUnavailable,
} from "../canonical";
import {
  attemptsFor,
  caseDefinitionsForFamily,
  cohortLabel,
  campaignDisplayLabel,
  runDisplayLabel,
  compareEligibility,
  eligibilityText,
  derivedCostPerTask,
  recordedBudgetLabel,
  getCaseDefinition,
  getModel,
  getPublication,
  getRun,
  getWithdrawnRun,
  headlineFor,
  resolveBaselineRun,
  scoringCoverageFor,
} from "../selectors";
import {
  AvailabilityMark,
  CoverageChip,
  CoverageLabel,
  ExecutionChip,
  LatencyValue,
  OriginTag,
  TokenUsageValue,
  VerdictChip,
} from "../components";
import { RecordedResult } from "../../components/leaderboard-results";
import { dollars } from "../../components/results-ui";
import { clientDisplayName, settingDisplayName } from "../../lib/client-labels";
import { preferredCompareRun } from "../compare-selection";
import "./compare.css";

const numberFormatter = new Intl.NumberFormat("en-US");

function shortSha(sha: string | null | undefined): string | null {
  return sha === null || sha === undefined ? null : `${sha.slice(0, 12)}…`;
}

function comparePath(
  left: string | undefined,
  right: string | undefined,
  category: string,
): string {
  const params = new URLSearchParams();
  if (left !== undefined) params.set("left", left);
  if (right !== undefined) params.set("right", right);
  params.set("category", category);
  const query = params.toString();
  return `/compare${query === "" ? "" : `?${query}`}`;
}

function runOptionLabel(run: CanonicalRun): string {
  const status = run.origin === "synthetic" ? " · demo" : "";
  return `${settingDisplayName(run.configuration.reasoning, run.cohort.target)} · ${run.startedAt.slice(0, 10)} · ${run.counts.graded}/${run.counts.planned} graded${status}`;
}

function comparisonReason(
  reason: EligibilityReason,
  left: CanonicalRun,
  right: CanonicalRun,
): string {
  if (reason === "outside_selected_cohort") {
    if (left.family !== right.family)
      return `These recordings cover different categories: ${left.family} and ${right.family}. Choose one category above.`;
    if (left.cohort.target !== right.cohort.target)
      return `The clients differ: ${clientDisplayName(left.cohort.target)} and ${clientDisplayName(right.cohort.target)}. Their test conditions do not match.`;
    if (left.cohort.recoveryProtocol !== right.cohort.recoveryProtocol)
      return "These recordings used different timeout and retry rules. Choose recordings with matching test conditions.";
    return "These recordings come from different test setups. The task version, access, repetitions and execution rules must match for a direct comparison.";
  }
  if (reason === "incomplete_grading")
    return "Some attempts are still ungraded. Timeouts and run errors are not counted as failed answers.";
  if (reason === "incomplete_coverage")
    return "Some planned attempts were not run. Complete coverage is needed to compare pass rates.";
  if (reason === "coverage_unknown") return "We cannot verify that every planned attempt was run.";
  if (reason === "labels_only_configuration" || reason === "missing_pinned_configuration")
    return "The exact model configuration was not recorded for one or both runs.";
  if (reason === "different_evidence_category")
    return "These recordings measure different things, so their scores cannot be directly compared.";
  return eligibilityText(reason);
}

function sideName(run: CanonicalRun, left: CanonicalRun): string {
  return run.runId === left.runId ? "left" : "right";
}

/** Where a blocking reason applies — derives from reason codes, not free text. */
function reasonContext(
  reason: EligibilityReason,
  left: CanonicalRun,
  right: CanonicalRun,
): string | null {
  switch (reason) {
    case "different_evidence_category":
      return `left measures ${left.cohort.evidenceCategory} · right measures ${right.cohort.evidenceCategory}`;
    case "outside_selected_cohort":
      return `left: ${cohortLabel(left.cohort)} · right: ${cohortLabel(right.cohort)}`;
    case "labels_only_configuration":
    case "missing_pinned_configuration": {
      const sides = [left, right].filter((run) => run.configuration.availability !== "pinned");
      return `applies to ${sides
        .map((run) => `${sideName(run, left)} (${run.configuration.availability})`)
        .join(", ")}`;
    }
    case "incomplete_coverage":
    case "coverage_unknown": {
      const sides = [left, right].filter((run) => run.dispatchCoverage !== "complete");
      return `applies to ${sides
        .map((run) => `${sideName(run, left)} (${run.dispatchCoverage} coverage)`)
        .join(", ")}`;
    }
    case "incomplete_grading": {
      const sides = [left, right].flatMap((run, index) =>
        scoringCoverageFor(run) === "complete"
          ? []
          : [
              `${index === 0 ? "left" : "right"} (${run.counts.graded}/${run.counts.started} graded/started)`,
            ],
      );
      return `applies to ${sides.join(", ")}`;
    }
    case "synthetic": {
      const sides = [left, right].filter((run) => run.origin === "synthetic");
      return `applies to ${sides.map((run) => sideName(run, left)).join(", ")}`;
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Run summary card
// ---------------------------------------------------------------------------

function RunSummaryCard({ title, runId }: { title: string; runId: string | undefined }) {
  if (runId === undefined) {
    return (
      <Panel title={title}>
        <div className="eval-compare-run-card">
          <p className="eval-muted">Choose a model above to see its recorded results.</p>
        </div>
      </Panel>
    );
  }
  const run = getRun(runId);
  if (run === undefined) {
    const withdrawn = getWithdrawnRun(runId);
    return (
      <Panel title={title}>
        <div className="eval-compare-run-card">
          {withdrawn === undefined ? (
            <>
              <p className="eval-muted">
                <code className="eval-compare-mono">{runId}</code> was not found. Choose an
                available recording above.
              </p>
            </>
          ) : (
            <>
              <div className="eval-compare-chip-row">
                <span className="eval-compare-run-name">{withdrawn.runId}</span>
                <OriginTag origin={withdrawn.origin} />
                <span className="eval-compare-condition">withdrawn</span>
              </div>
              <p className="eval-muted">
                {withdrawn.withdrawal.notice} Reason: {withdrawn.withdrawal.reason} · withdrawn{" "}
                {withdrawn.withdrawal.withdrawnAt.slice(0, 10)}. Result bytes are removed; the
                identifier stays visible in history.
              </p>
            </>
          )}
        </div>
      </Panel>
    );
  }
  const model = getModel(run.modelId);
  const campaign = canonicalCampaigns.find((entry) => entry.campaignId === run.campaignId);
  const baseline = resolveBaselineRun(run);
  const headline = headlineFor(run);
  const cost = derivedCostPerTask(run);
  return (
    <Panel title={title}>
      <div className="eval-compare-run-card">
        <div className="eval-compare-run-heading">
          {model && <ModelAvatar model={model} />}
          <span>
            <span className="eval-compare-run-name">{model?.name ?? run.modelId}</span>{" "}
            <span className="eval-compare-run-sub">
              {settingDisplayName(run.configuration.reasoning, run.cohort.target)}
            </span>
          </span>
          {run.origin === "synthetic" && <OriginTag origin={run.origin} />}
        </div>
        <p className="eval-compare-recording">
          {run.family} · {run.startedAt.slice(0, 10)} · {run.cohort.repetitions} repetitions
          <br />
          {recordedBudgetLabel([run])}
        </p>
        <div className="eval-compare-result">
          <span className="eval-compare-field-label">{run.family} pass rate</span>
          <RecordedResult
            runs={[run]}
            score={
              headline.kind === "rate" && headline.started > 0
                ? headline.passed / headline.started
                : null
            }
          />
          {headline.kind === "counts_only" && (
            <p className="eval-muted">{comparisonReason(headline.reason, run, run)}</p>
          )}
        </div>
        <p className="eval-compare-cost">
          Est. cost / task:{" "}
          <strong>
            {cost.availability === "available" ? dollars(cost.usdPerTask) : "Not recorded"}
          </strong>
          {cost.availability === "available" && (
            <small>
              {cost.sampleCount ?? "Unknown number of"} {cost.population} attempts ·{" "}
              {cost.sampleCount === null
                ? "exclusions unknown"
                : `${Math.max(0, run.counts.started - cost.sampleCount)} excluded`}
            </small>
          )}
          {cost.availability === "available" && cost.basis === "catalogue_free_tier" && (
            <small>Free model tier</small>
          )}
        </p>
        <a
          className="eval-compare-task-link"
          href={`#/tasks?category=${run.family}&model=${run.modelId}&run=${encodeURIComponent(run.runId)}&view=conversation`}
        >
          Browse tasks &amp; transcripts →
        </a>
        <details className="eval-compare-run-evidence">
          <summary>Run conditions &amp; sources</summary>
          <div className="eval-compare-chip-row">
            <CoverageChip run={run} />
            <span className="eval-compare-condition">dispatch {run.dispatchCoverage}</span>
            <span className="eval-compare-condition">checks {run.checkSource}</span>
            <span className="eval-compare-condition">{run.caseBinding}</span>
            {run.withheldFields.map((field) => (
              <AvailabilityMark
                key={field.field}
                availability="withheld"
                reason={`${field.field} · ${field.reason}`}
              />
            ))}
          </div>
          <dl className="eval-compare-kv">
            <div>
              <dt>Configuration</dt>
              <dd>
                {run.configuration.availability === "pinned" ? (
                  <code className="eval-compare-mono">
                    pin {shortSha(run.configuration.pinnedSha256)}
                  </code>
                ) : (
                  <AvailabilityMark
                    availability="not_recorded"
                    reason="labels-only configuration"
                  />
                )}{" "}
                {run.configuration.candidate} · reasoning {run.configuration.reasoning ?? "unset"}
              </dd>
            </div>
            <div>
              <dt>Cohort</dt>
              <dd>{cohortLabel(run.cohort)}</dd>
            </div>
            <div>
              <dt>Campaign</dt>
              <dd title={campaign?.harness}>
                <code className="eval-compare-mono">{campaignDisplayLabel(run.campaignId)}</code>
              </dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>
                {run.provenance.sourceLabel}
                {baseline !== undefined && (
                  <>
                    {" "}
                    · Sol baseline imported once as{" "}
                    <code className="eval-compare-mono">{runDisplayLabel(baseline.runId)}</code>
                  </>
                )}
              </dd>
            </div>
          </dl>
        </details>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Eligible comparison sections
// ---------------------------------------------------------------------------

const COUNT_ROWS: readonly { label: string; pick: (run: CanonicalRun) => number }[] = [
  { label: "planned", pick: (run) => run.counts.planned },
  { label: "started", pick: (run) => run.counts.started },
  { label: "completed", pick: (run) => run.counts.completed },
  { label: "timed out", pick: (run) => run.counts.timedOut },
  { label: "runtime failures", pick: (run) => run.counts.runtimeFailure },
  { label: "pending", pick: (run) => run.counts.pending },
  { label: "unstarted", pick: (run) => run.counts.unstarted },
  { label: "unknown", pick: (run) => run.counts.unknown },
  { label: "passed", pick: (run) => run.counts.passed },
  { label: "failed", pick: (run) => run.counts.failed },
  { label: "graded", pick: (run) => run.counts.graded },
];

function runtimeFailureNote(run: CanonicalRun): string | null {
  const failures = attemptsFor(run).filter((attempt) => attempt.execution === "runtime_failure");
  if (failures.length === 0) return null;
  return failures
    .map(
      (attempt) =>
        `${attempt.caseId} rep ${attempt.repetition} · ${attempt.failureAttribution ?? "unattributed"}`,
    )
    .join("; ");
}

function DifferenceSummary({ left, right }: { left: CanonicalRun; right: CanonicalRun }) {
  if (left.runId === right.runId)
    return (
      <p className="eval-compare-status">
        The same recording is selected twice. Choose another setting to compare results.
      </p>
    );
  if (left.counts.started === 0 || right.counts.started === 0) return null;
  const difference =
    100 * (left.counts.passed / left.counts.started - right.counts.passed / right.counts.started);
  const higher = difference > 0 ? left : right;
  return (
    <p className="eval-compare-status" role="status">
      <strong>Matching test conditions.</strong>{" "}
      {difference === 0
        ? "Both recordings have the same pass rate."
        : `${getModel(higher.modelId)?.name ?? higher.modelId} (${higher.configuration.reasoning ?? "unspecified"} reasoning) is ${Math.abs(difference).toFixed(1)} percentage points higher on ${left.family} in these recordings.`}
      <span>Descriptive results from these runs; not a claim of statistical significance.</span>
    </p>
  );
}

function CoveragePanel({ left, right }: { left: CanonicalRun; right: CanonicalRun }) {
  const leftFailures = runtimeFailureNote(left);
  const rightFailures = runtimeFailureNote(right);
  return (
    <Panel
      title="Coverage & counts"
      description="Dispatch and grading coverage with the full attempt counts for each run."
    >
      <div className="eval-compare-table-wrap">
        <table className="eval-table eval-compare-table">
          <thead>
            <tr>
              <th scope="col">Count</th>
              <th scope="col">Model A</th>
              <th scope="col">Model B</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">dispatch coverage</th>
              <td>
                <CoverageLabel coverage={left.dispatchCoverage} />
              </td>
              <td>
                <CoverageLabel coverage={right.dispatchCoverage} />
              </td>
            </tr>
            <tr>
              <th scope="row">scoring coverage</th>
              <td>
                <CoverageChip run={left} />
              </td>
              <td>
                <CoverageChip run={right} />
              </td>
            </tr>
            {COUNT_ROWS.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                <td className="lb-count">{numberFormatter.format(row.pick(left))}</td>
                <td className="lb-count">{numberFormatter.format(row.pick(right))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(leftFailures !== null || rightFailures !== null) && (
        <div className="eval-compare-run-card">
          <span className="eval-muted">
            runtime failures — left: {leftFailures ?? "none"} · right: {rightFailures ?? "none"}
          </span>
        </div>
      )}
    </Panel>
  );
}

const UNAVAILABLE_METRIC_ROWS: readonly {
  label: string;
  pick: (run: CanonicalRun) => MetricUnavailable;
}[] = [
  { label: "answer accuracy", pick: (run) => run.metrics.answerAccuracy },
  { label: "uncertainty", pick: (run) => run.metrics.uncertainty },
];

function MetricsPanel({ left, right }: { left: CanonicalRun; right: CanonicalRun }) {
  return (
    <Panel
      title="Metrics"
      description="Run-level statistics; every value carries its sample count and population."
    >
      <div className="eval-compare-table-wrap">
        <table className="eval-table eval-compare-table">
          <thead>
            <tr>
              <th scope="col">Metric</th>
              <th scope="col">Model A</th>
              <th scope="col">Model B</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">latency (p50 · p95 · max)</th>
              <td>
                <LatencyValue metric={left.metrics.latencyMs} />
              </td>
              <td>
                <LatencyValue metric={right.metrics.latencyMs} />
              </td>
            </tr>
            <tr>
              <th scope="row">token usage</th>
              <td>
                <TokenUsageValue metric={left.metrics.tokenUsage} />
              </td>
              <td>
                <TokenUsageValue metric={right.metrics.tokenUsage} />
              </td>
            </tr>
            <tr>
              <th scope="row">Est. cost / task</th>
              {[left, right].map((run, index) => {
                const cost = derivedCostPerTask(run);
                return (
                  <td key={index}>
                    {cost.availability === "available" ? (
                      <>
                        {dollars(cost.usdPerTask)}
                        <div className="eval-muted">
                          {cost.sampleCount ?? "Unknown number of"} {cost.population} attempts
                        </div>
                        <div className="eval-muted">{cost.priceSource}; not billed spend</div>
                      </>
                    ) : (
                      <AvailabilityMark availability={cost.availability} reason={cost.reason} />
                    )}
                  </td>
                );
              })}
            </tr>
            {UNAVAILABLE_METRIC_ROWS.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                {[left, right].map((run, index) => {
                  const metric = row.pick(run);
                  return (
                    <td key={index}>
                      <AvailabilityMark availability={metric.availability} reason={metric.reason} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Per-case outcome comparison
// ---------------------------------------------------------------------------

const EXECUTION_TEXT: Record<CanonicalAttempt["execution"], string> = {
  completed: "completed",
  timed_out: "timed out",
  runtime_failure: "runtime failure",
  pending: "pending",
  unstarted: "unstarted",
  unknown: "unknown",
};

function attemptLabel(attempt: CanonicalAttempt): string {
  const state =
    attempt.execution === "completed" ? attempt.verdict : EXECUTION_TEXT[attempt.execution];
  const attribution =
    attempt.execution === "runtime_failure" && attempt.failureAttribution
      ? ` (${attempt.failureAttribution})`
      : "";
  return `${attempt.caseId} rep ${attempt.repetition}: ${state}${attribution}`;
}

function AttemptOutcome({ attempt }: { attempt: CanonicalAttempt | undefined }) {
  if (attempt === undefined) {
    return <span className="eval-muted">—</span>;
  }
  return (
    <span className="eval-compare-rep" title={attemptLabel(attempt)}>
      <span className="eval-muted eval-compare-rep-num">r{attempt.repetition}</span>
      {attempt.execution === "completed" ? (
        <VerdictChip verdict={attempt.verdict} />
      ) : (
        <ExecutionChip
          execution={attempt.execution}
          failureAttribution={attempt.failureAttribution}
        />
      )}
    </span>
  );
}

interface CaseCompareRow {
  readonly caseId: string;
  readonly title: string;
  readonly category: string | undefined;
  readonly left: readonly (CanonicalAttempt | undefined)[];
  readonly right: readonly (CanonicalAttempt | undefined)[];
}

function caseCompareRows(left: CanonicalRun, right: CanonicalRun): readonly CaseCompareRow[] {
  const byCase = (run: CanonicalRun) => {
    const map = new Map<string, CanonicalAttempt[]>();
    for (const attempt of attemptsFor(run)) {
      const list = map.get(attempt.caseId) ?? [];
      list.push(attempt);
      map.set(attempt.caseId, list);
    }
    return map;
  };
  const leftMap = byCase(left);
  const rightMap = byCase(right);
  const definitionOrder = caseDefinitionsForFamily(left.family).map((def) => def.caseId);
  const seen = new Set<string>();
  const orderedIds = [
    ...definitionOrder,
    ...[...leftMap.keys(), ...rightMap.keys()].filter(
      (caseId) => !definitionOrder.includes(caseId),
    ),
  ];
  return orderedIds
    .filter((caseId) => {
      if (seen.has(caseId)) return false;
      seen.add(caseId);
      return true;
    })
    .map((caseId) => {
      const leftAttempts = leftMap.get(caseId) ?? [];
      const rightAttempts = rightMap.get(caseId) ?? [];
      const slots = Math.max(
        left.cohort.repetitions,
        right.cohort.repetitions,
        ...leftAttempts.map((attempt) => attempt.repetition),
        ...rightAttempts.map((attempt) => attempt.repetition),
      );
      const fill = (attempts: readonly CanonicalAttempt[]) =>
        Array.from({ length: slots }, (_, index) =>
          attempts.find((attempt) => attempt.repetition === index + 1),
        );
      const definition = getCaseDefinition(caseId);
      return {
        caseId,
        title: definition?.title ?? caseId,
        category: definition?.category,
        left: fill(leftAttempts),
        right: fill(rightAttempts),
      };
    });
}

function OutcomePanel({ left, right }: { left: CanonicalRun; right: CanonicalRun }) {
  const rows = caseCompareRows(left, right);
  const leftModel = getModel(left.modelId);
  const rightModel = getModel(right.modelId);
  return (
    <Panel
      title="Task outcomes"
      description="Each task shows its recorded repetitions side by side. Ungraded attempts keep their timeout or error status."
    >
      <div className="eval-compare-table-wrap">
        <table className="eval-table eval-compare-table">
          <thead>
            <tr>
              <th scope="col">Case</th>
              <th scope="col">Model A · {leftModel?.name ?? left.modelId}</th>
              <th scope="col">Model B · {rightModel?.name ?? right.modelId}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.caseId}>
                <th scope="row">
                  {row.title}
                  <div className="eval-compare-run-sub">
                    <code className="eval-compare-mono">{row.caseId}</code>
                    {row.category ? ` · ${row.category}` : ""}
                  </div>
                </th>
                <td>
                  <span className="eval-compare-rep-list">
                    {row.left.map((attempt, index) => (
                      <AttemptOutcome key={index} attempt={attempt} />
                    ))}
                  </span>
                </td>
                <td>
                  <span className="eval-compare-rep-list">
                    {row.right.map((attempt, index) => (
                      <AttemptOutcome key={index} attempt={attempt} />
                    ))}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Availability & provenance
// ---------------------------------------------------------------------------

const ATTEMPT_FIELDS: readonly {
  label: string;
  pick: (attempt: CanonicalAttempt) => Evidence<unknown>;
}[] = [
  { label: "checks", pick: (attempt) => attempt.checks },
  { label: "durationMs", pick: (attempt) => attempt.durationMs },
  { label: "wallDurationMs", pick: (attempt) => attempt.wallDurationMs },
  { label: "tokenUsage", pick: (attempt) => attempt.tokenUsage },
  { label: "answer", pick: (attempt) => attempt.answer },
  { label: "toolCalls", pick: (attempt) => attempt.toolCalls },
];

function attemptFieldAvailability(run: CanonicalRun): readonly string[] {
  if (run.attempts.availability !== "available") return [`attempts ${run.attempts.availability}`];
  const attempts = run.attempts.value;
  const lines: string[] = [];
  for (const field of ATTEMPT_FIELDS) {
    const counts = new Map<string, number>();
    for (const attempt of attempts) {
      const evidence = field.pick(attempt);
      const key =
        evidence.availability === "withheld"
          ? `withheld · ${evidence.reason}`
          : evidence.availability;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const parts = [...counts.entries()]
      .filter(([key]) => key !== "available")
      .map(([key, count]) => `${key} ×${count}`);
    if (parts.length > 0) lines.push(`${field.label}: ${parts.join(", ")}`);
  }
  return lines;
}

function SideFacts({ run }: { run: CanonicalRun }) {
  const publication = getPublication(run.runId);
  const currentRevision = publication?.revisions.find(
    (revision) => revision.revisionId === publication.currentRevisionId,
  );
  const artifactSha = shortSha(run.provenance.sourceArtifactSha256);
  const availability = attemptFieldAvailability(run);
  return (
    <div className="eval-compare-side">
      <h4>
        <code className="eval-compare-mono">{runDisplayLabel(run.runId)}</code>
      </h4>
      {availability.length > 0 && (
        <ul className="eval-compare-note-list" aria-label="Field availability">
          {availability.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {run.notes.length > 0 && (
        <ul className="eval-compare-note-list" aria-label="Run notes">
          {run.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
      <span className="eval-muted">
        source {run.provenance.sourceLabel}
        {artifactSha !== null ? (
          <>
            {" "}
            · sha <code className="eval-compare-mono">{artifactSha}</code>
          </>
        ) : (
          " · no source artifact retained"
        )}
        {run.provenance.sourceCommit !== "" && (
          <>
            {" "}
            · commit{" "}
            <code className="eval-compare-mono">{run.provenance.sourceCommit.slice(0, 7)}</code>
          </>
        )}
      </span>
      {publication !== undefined && (
        <span className="eval-muted">
          <code className="eval-compare-mono">{publication.publicationId}</code> ·{" "}
          {publication.status} · {publication.revisions.length} revision
          {publication.revisions.length === 1 ? "" : "s"}
          {currentRevision?.supersedes
            ? ` (r${currentRevision.revision} ${currentRevision.supersedes.reason})`
            : ""}
          {run.origin === "synthetic" ? " · synthetic preview" : ""}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function ComparePage({
  left,
  right,
  includeSynthetic = false,
}: {
  left?: string;
  right?: string;
  includeSynthetic?: boolean;
}) {
  const route = useHashRoute();
  const leftRun = left === undefined ? undefined : getRun(left);
  const rightRun = right === undefined ? undefined : getRun(right);
  const requestedCategory = new URLSearchParams(route.split("?")[1] ?? "").get("category");
  const categories: readonly PrototypeFamily[] = [
    ...new Set<PrototypeFamily>([
      ...MEASURED_FAMILIES,
      ...(leftRun ? [leftRun.family] : []),
      ...(rightRun ? [rightRun.family] : []),
    ]),
  ];
  const category =
    categories.find((family) => family === requestedCategory) ??
    leftRun?.family ??
    rightRun?.family ??
    "Perps";
  const runs = useMemo(
    () => canonicalRuns.filter((run) => includeSynthetic || run.origin === "measured"),
    [includeSynthetic],
  );
  const familyRuns = runs.filter((run) => run.family === category);
  const modelIds = [
    ...new Set([
      ...familyRuns.map((run) => run.modelId),
      ...(leftRun ? [leftRun.modelId] : []),
      ...(rightRun ? [rightRun.modelId] : []),
    ]),
  ].sort((a, b) => (getModel(a)?.name ?? a).localeCompare(getModel(b)?.name ?? b));
  const eligibility = leftRun && rightRun ? compareEligibility(leftRun, rightRun) : undefined;

  const selectRun = (side: "left" | "right", runId: string | undefined) => {
    navigate(
      comparePath(side === "left" ? runId : left, side === "right" ? runId : right, category),
    );
  };
  const changeCategory = (family: PrototypeFamily) => {
    const nextLeft = leftRun
      ? preferredCompareRun(
          runs,
          leftRun.modelId,
          family,
          undefined,
          leftRun.configuration.reasoning,
        )
      : undefined;
    const nextRight = rightRun
      ? preferredCompareRun(
          runs,
          rightRun.modelId,
          family,
          nextLeft,
          rightRun.configuration.reasoning,
        )
      : undefined;
    navigate(comparePath(nextLeft?.runId, nextRight?.runId, family));
  };
  const picker = (side: "left" | "right", selected: CanonicalRun | undefined) => {
    const other = side === "left" ? rightRun : leftRun;
    const options = familyRuns
      .filter((run) => run.modelId === selected?.modelId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || a.runId.localeCompare(b.runId));
    if (selected && !options.some((run) => run.runId === selected.runId)) options.unshift(selected);
    const label = side === "left" ? "Model A" : "Model B";
    return (
      <div className="eval-compare-model-picker">
        <div className="eval-compare-field">
          <label className="eval-compare-field-label" htmlFor={`eval-compare-${side}-model`}>
            {label}
          </label>
          <select
            id={`eval-compare-${side}-model`}
            className="eval-compare-select"
            value={selected?.modelId ?? ""}
            onChange={(event) =>
              selectRun(
                side,
                preferredCompareRun(runs, event.currentTarget.value, category, other)?.runId,
              )
            }
          >
            <option value="">Choose a model…</option>
            {modelIds.map((modelId) => (
              <option
                key={modelId}
                value={modelId}
                disabled={!familyRuns.some((run) => run.modelId === modelId)}
              >
                {getModel(modelId)?.name ?? modelId}
              </option>
            ))}
          </select>
        </div>
        <div className="eval-compare-field">
          <label className="eval-compare-field-label" htmlFor={`eval-compare-${side}-picker`}>
            {label} reasoning &amp; recording
          </label>
          <select
            id={`eval-compare-${side}-picker`}
            className="eval-compare-select"
            value={selected?.runId ?? ""}
            disabled={!selected}
            onChange={(event) => selectRun(side, event.currentTarget.value || undefined)}
          >
            {!selected && <option value="">Choose a model first</option>}
            {options.map((run) => (
              <option key={run.runId} value={run.runId}>
                {runOptionLabel(run)} · {recordedBudgetLabel([run])}
                {run.family !== category ? ` · ${run.family}` : ""}
              </option>
            ))}
          </select>
        </div>
      </div>
    );
  };

  return (
    <PageShell
      active="compare"
      footerNote="Compare recorded category results. See each model profile for Overall scores and full run history."
    >
      <div className="eval-container eval-compare-page">
        <section className="eval-hero" aria-labelledby="compare-title">
          <img className="eval-hero-art" src="/images/hero-watercolor-landscape.webp" alt="" />
          <p className="eval-eyebrow">Side-by-side results</p>
          <h1 className="eval-title" id="compare-title">
            Compare models<span className="eval-dot">.</span>
          </h1>
          <p className="eval-description">
            Choose a task category, then two models and their reasoning settings. Compare pass
            rates, individual task outcomes, and recorded costs.
          </p>
        </section>

        <Panel
          title="Choose what to compare"
          description="You can compare different models or two reasoning levels of the same model. All recorded runs remain available."
        >
          <div className="eval-compare-toolbar">
            <div className="eval-compare-field">
              <label className="eval-compare-field-label" htmlFor="eval-compare-category">
                Task category
              </label>
              <select
                id="eval-compare-category"
                className="eval-compare-select"
                value={category}
                onChange={(event) => changeCategory(event.currentTarget.value as PrototypeFamily)}
              >
                {categories.map((family) => {
                  const missing = [leftRun, rightRun].find(
                    (run) =>
                      run &&
                      !runs.some(
                        (candidate) =>
                          candidate.modelId === run.modelId && candidate.family === family,
                      ),
                  );
                  return (
                    <option key={family} value={family} disabled={Boolean(missing)}>
                      {family}
                      {missing
                        ? ` (no recordings for ${getModel(missing.modelId)?.name ?? missing.modelId})`
                        : ""}
                    </option>
                  );
                })}
              </select>
            </div>
            <div className="eval-compare-picker-actions">
              <button
                type="button"
                className="eval-compare-button"
                disabled={!left && !right}
                aria-label="Swap models and settings"
                onClick={() => navigate(comparePath(right, left, category))}
              >
                <ArrowLeftRight size={13} aria-hidden="true" /> Swap
              </button>
              <button
                type="button"
                className="eval-compare-button"
                disabled={!left && !right}
                aria-label="Clear comparison"
                onClick={() => navigate(comparePath(undefined, undefined, category))}
              >
                <RotateCcw size={13} aria-hidden="true" /> Clear
              </button>
            </div>
          </div>
          <div className="eval-compare-pickers">
            {picker("left", leftRun)}
            {picker("right", rightRun)}
          </div>
          {!left && !right && (
            <div className="eval-compare-examples">
              <span>Start with Perps:</span>
              <a href="#/compare?category=Perps&left=astra-high-perps-1&right=grok-low-perps-1">
                Astra high vs Grok low
              </a>
              <a href="#/compare?category=Perps&left=astra-high-perps-1&right=astra-medium-perps-1">
                Astra high vs medium
              </a>
            </div>
          )}
        </Panel>

        {(left !== undefined || right !== undefined) && (
          <div className="eval-two-column eval-compare-section">
            <RunSummaryCard title="Model A" runId={left} />
            <RunSummaryCard title="Model B" runId={right} />
          </div>
        )}
        {leftRun &&
          rightRun &&
          eligibility &&
          (eligibility.eligible ? (
            <DifferenceSummary left={leftRun} right={rightRun} />
          ) : (
            <section className="eval-compare-status" aria-labelledby="compare-unavailable-title">
              <h2 id="compare-unavailable-title">Results shown separately</h2>
              <p>A direct score difference and task comparison are unavailable for this pair.</p>
              <ul>
                {eligibility.reasons.map((reason) => (
                  <li key={reason}>{comparisonReason(reason, leftRun, rightRun)}</li>
                ))}
              </ul>
            </section>
          ))}

        {eligibility?.eligible && leftRun && rightRun && (
          <>
            <div className="eval-compare-section">
              <OutcomePanel left={leftRun} right={rightRun} />
            </div>
            <div className="eval-compare-section">
              <CheckDimensionPanel
                fill={false}
                series={[
                  {
                    key: "left",
                    label: `${getModel(leftRun.modelId)?.name ?? leftRun.modelId} · ${leftRun.configuration.reasoning ?? "unspecified"}`,
                    dimensions: leftRun.dimensions,
                  },
                  {
                    key: "right",
                    label: `${getModel(rightRun.modelId)?.name ?? rightRun.modelId} · ${rightRun.configuration.reasoning ?? "unspecified"}`,
                    dimensions: rightRun.dimensions,
                  },
                ]}
              />
            </div>
          </>
        )}

        {leftRun && rightRun && (
          <>
            <details className="eval-compare-disclosure">
              <summary>Detailed counts, timing &amp; costs</summary>
              <div className="eval-compare-section">
                <CoveragePanel left={leftRun} right={rightRun} />
              </div>
              <div className="eval-compare-section">
                <MetricsPanel left={leftRun} right={rightRun} />
              </div>
            </details>
            <details className="eval-compare-disclosure">
              <summary>Comparison rules &amp; evidence</summary>
              <div className="eval-compare-section">
                <Panel
                  title="Recorded conditions"
                  description="Direct differences require matching task versions, clients, access, repetitions and execution rules, plus complete grading."
                >
                  <div className="eval-compare-verdict">
                    {eligibility?.reasons.map((reason) => (
                      <p key={reason}>
                        <code className="eval-compare-mono">{reason}</code> ·{" "}
                        {reasonContext(reason, leftRun, rightRun) ?? eligibilityText(reason)}
                      </p>
                    ))}
                    {eligibility?.conditions.length ? (
                      <ul className="eval-compare-note-list">
                        {eligibility.conditions.map((condition) => (
                          <li key={condition}>{condition}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>Recorded configurations match.</p>
                    )}
                  </div>
                  <div className="eval-compare-side-grid">
                    <SideFacts run={leftRun} />
                    <SideFacts run={rightRun} />
                  </div>
                </Panel>
              </div>
            </details>
          </>
        )}
      </div>
    </PageShell>
  );
}
