import { Fragment, useEffect, useMemo, useState } from "react";
import { clientDisplayName } from "../lib/client-labels";
import { ArrowUpRight, ChevronDown, ChevronRight, Download } from "lucide-react";
import {
  canonicalCampaigns,
  withdrawnRuns,
  type CanonicalAttempt,
  type CanonicalCampaign,
  type CanonicalRun,
  type WithdrawnRunRef,
} from "../canonical/canonical";
import {
  cohortLabel,
  campaignDisplayLabel,
  runDisplayLabel,
  configurationGroupKey,
  derivedCostPerTask,
  getModel,
  gradedOnlyRate,
  headlineFor,
  outcomeMatrixFor,
  publicationFor,
  recordedBudgetLabel,
  recordedOutcomes,
  configurationLeaderboardRows,
  modelProfileRows,
  resolveBaselineRun,
  runHistoryFor,
  type DerivedCost,
  type OutcomeMatrixRow,
} from "../canonical/selectors";
import {
  AvailabilityMark,
  CheckMark,
  CoverageChip,
  ExecutionChip,
  GradedOnlyRateValue,
  HeadlineValue,
  LatencyValue,
  OriginTag,
  OutcomeMatrixCell,
  SampleCount,
  TokenUsageValue,
  VerdictChip,
} from "../canonical/components";
import { CheckDimensionPanel } from "../components/check-dimension-radar";
import { ModelAvatar, PageShell, Panel } from "../components/eval-ui";
import { ModelSettingResults } from "../components/model-setting-results";
import { ModelProfileOverview } from "../components/model-profile-overview";
import { Button } from "../components/ui/button";
import { rowKey } from "../components/leaderboard-results";
import { selectProfileSetting } from "../lib/model-profile-selection";
import type { LeaderboardModelRow } from "../canonical/selectors";
import "./model-profile.css";
import "../styles/leaderboard.css";
import "./model-profile-clean.css";

// ---------------------------------------------------------------------------
// Bundled source artifact downloads (decision 13: byte-identical ?url imports)
// ---------------------------------------------------------------------------

import gpt55SpotReportUrl from "../results/2026-09-11/spot-comparison/comparison.json?url";
import solReportUrl from "../results/2026-09-11/perps-predictions/report/ask-gina-perps-predictions-evals-2026-09-11.json?url";
import museReportUrl from "../results/2026-09-14/muse-spark-1.3/report/ask-gina-muse-spark-1.3-evals-2026-09-14.json?url";
import claudeComparisonUrl from "../results/2026-09-14/claude-comparison/ask-gina-claude-comparison.json?url";
import reasoningSweepUrl from "../results/2026-09-16/reasoning-sweep/ask-gina-reasoning-sweep.json?url";
import reasoningSweepClaudeUrl from "../results/2026-09-16/reasoning-sweep/ask-gina-reasoning-sweep-claude.json?url";
import opus55ResultsUrl from "../results/2026-09-24/claude-opus-5.5/results.json?url";
import opus55SnapshotUrl from "../results/2026-09-24/claude-opus-5.5/snapshot.json?url";
import grok47ResultsUrl from "../results/2026-09-22/grok-4.7/results.json?url";
import grok47SnapshotUrl from "../results/2026-09-22/grok-4.7/snapshot.json?url";
import grok47LowRecoveryUrl from "../results/2026-09-22/grok-4.7/low-recovery.json?url";
import grok47LowRecoverySnapshotUrl from "../results/2026-09-22/grok-4.7/low-recovery-snapshot.json?url";

interface BundledArtifact {
  readonly url: string;
  readonly filename: string;
  readonly description: string;
}

const REASONING_SWEEP_ARTIFACT: BundledArtifact = {
  url: reasoningSweepUrl,
  filename: "ask-gina-reasoning-sweep-2026-09-16.json",
  description: "Reasoning sweep (2026-09-16)",
};
const REASONING_SWEEP_CLAUDE_ARTIFACT: BundledArtifact = {
  url: reasoningSweepClaudeUrl,
  filename: "ask-gina-reasoning-sweep-claude-2026-09-16.json",
  description: "Claude reasoning sweep (2026-09-16)",
};

const MODEL_ARTIFACTS: Readonly<Record<string, readonly BundledArtifact[]>> = {
  "gpt-5.5": [
    {
      url: gpt55SpotReportUrl,
      filename: "ask-gina-spot-comparison-2026-09-11.json",
      description: "Spot comparison (2026-09-11)",
    },
  ],
  "gpt-sol": [
    {
      url: solReportUrl,
      filename: "ask-gina-perps-predictions-evals-2026-09-11.json",
      description: "Perps and predictions (2026-09-11)",
    },
    REASONING_SWEEP_ARTIFACT,
  ],
  "muse-spark": [
    {
      url: museReportUrl,
      filename: "ask-gina-muse-spark-1.3-evals-2026-09-14.json",
      description: "Muse campaign (2026-09-14)",
    },
    REASONING_SWEEP_ARTIFACT,
  ],
  "claude-fable": [
    {
      url: claudeComparisonUrl,
      filename: "ask-gina-claude-comparison-2026-09-14.json",
      description: "Claude comparison (2026-09-14)",
    },
    REASONING_SWEEP_CLAUDE_ARTIFACT,
  ],
  "claude-opus-5-5": [
    {
      url: opus55ResultsUrl,
      filename: "claude-opus-5.5-results-2026-09-24.json",
      description: "Opus 5.5 results · all five thinking levels",
    },
    {
      url: opus55SnapshotUrl,
      filename: "claude-opus-5.5-snapshot-2026-09-24.json",
      description: "Opus 5.5 evidence hashes",
    },
  ],
  "claude-opus": [
    {
      url: claudeComparisonUrl,
      filename: "ask-gina-claude-comparison-2026-09-14.json",
      description: "Claude comparison (2026-09-14)",
    },
    REASONING_SWEEP_CLAUDE_ARTIFACT,
  ],
  "gpt-terra": [REASONING_SWEEP_ARTIFACT],
  astra: [REASONING_SWEEP_ARTIFACT],
  grok: [REASONING_SWEEP_ARTIFACT],
  "grok-4-7": [
    {
      url: grok47LowRecoveryUrl,
      filename: "grok-4.7-low-recovery-2026-09-22.json",
      description: "Grok 4.7 Low completed recovery · 92/105 graded",
    },
    {
      url: grok47LowRecoverySnapshotUrl,
      filename: "grok-4.7-low-recovery-snapshot-2026-09-22.json",
      description: "Low recovery evidence hashes and coverage",
    },
    {
      url: grok47ResultsUrl,
      filename: "grok-4.7-results-2026-09-22.json",
      description: "Grok 4.7 numeric results (2026-09-22)",
    },
    {
      url: grok47SnapshotUrl,
      filename: "grok-4.7-snapshot-2026-09-22.json",
      description: "Grok 4.7 evidence hashes and coverage (2026-09-22)",
    },
  ],
  gemini: [REASONING_SWEEP_ARTIFACT],
  "swe-2": [REASONING_SWEEP_ARTIFACT],
};

export interface ModelProfilePageProps {
  modelId?: string;
  initialRunId?: string;
  includeSynthetic?: boolean;
}

function shortSha(sha: string | null | undefined): string | null {
  return sha === null || sha === undefined ? null : `${sha.slice(0, 12)}…`;
}

function readRunQueryParam(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const hash = window.location.hash;
  const queryIndex = hash.indexOf("?");
  if (queryIndex === -1) return undefined;
  const params = new URLSearchParams(hash.slice(queryIndex + 1));
  return params.get("run") ?? undefined;
}

// ---------------------------------------------------------------------------
// Derived cost row
// ---------------------------------------------------------------------------

function DerivedCostRow({ cost }: { cost: DerivedCost }) {
  if (cost.availability !== "available") {
    return (
      <tr>
        <th scope="row">est. cost / task (derived)</th>
        <td>
          <AvailabilityMark availability={cost.availability} reason={cost.reason} />
        </td>
      </tr>
    );
  }
  return (
    <tr>
      <th scope="row">est. cost / task (derived)</th>
      <td>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
          <span className="lb-count">${cost.usdPerTask.toFixed(4)}</span>
          {cost.sampleCount !== null ? (
            <SampleCount sampleCount={cost.sampleCount} population={cost.population} />
          ) : (
            <span className="eval-muted">({cost.population} aggregate)</span>
          )}
          <span className="eval-muted" title={cost.priceSource}>
            · price as of {cost.priceAsOf}
          </span>
        </span>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Configuration groups
// ---------------------------------------------------------------------------

function ConfigurationGroupsPanel({
  runs,
  onSelectRun,
}: {
  runs: readonly CanonicalRun[];
  onSelectRun: (runId: string) => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, CanonicalRun[]>();
    for (const run of runs) {
      const key = configurationGroupKey(run);
      const list = map.get(key) ?? [];
      list.push(run);
      map.set(key, list);
    }
    return [...map.entries()].map(([key, groupRuns]) => {
      const first = groupRuns[0]!;
      const isPinned = first.configuration.availability === "pinned";
      const sha = first.configuration.pinnedSha256;
      return {
        key,
        isPinned,
        sha,
        candidate: first.configuration.candidate,
        reasoning: first.configuration.reasoning,
        model: first.configuration.model,
        runs: groupRuns,
      };
    });
  }, [runs]);

  if (groups.length === 0) return null;

  return (
    <Panel
      title="Recorded configurations"
      description="Exact configuration fingerprints for reproducing individual runs. Different fingerprints can belong to the same reasoning level."
    >
      <div className="model-profile-config-groups">
        {groups.map((group) => (
          <article className="model-profile-config-group" key={group.key}>
            <div className="model-profile-config-header">
              <span className="model-profile-config-title">
                {group.isPinned ? (
                  <>
                    <span>Pinned configuration </span>
                    <code>{shortSha(group.sha)}</code>
                  </>
                ) : (
                  <AvailabilityMark
                    availability="not_recorded"
                    reason="labels-only configuration"
                  />
                )}
              </span>
              <span className="eval-muted">
                candidate <code>{group.candidate}</code>
                {group.reasoning !== null && ` · reasoning ${group.reasoning}`}
              </span>
            </div>
            <div className="model-profile-config-runs">
              <span className="eval-muted">Runs ({group.runs.length}):</span>
              {group.runs.map((run) => (
                <Button
                  key={run.runId}
                  variant="outline"
                  size="sm"
                  onClick={() => onSelectRun(run.runId)}
                >
                  <code>{runDisplayLabel(run.runId)}</code> ({run.startedAt.slice(0, 10)})
                </Button>
              ))}
            </div>
          </article>
        ))}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Per-attempt detailed table (inside expandable run detail)
// ---------------------------------------------------------------------------

function AttemptDetailsTable({ attempts }: { attempts: readonly CanonicalAttempt[] }) {
  const [open, setOpen] = useState(false);
  if (attempts.length === 0) return null;

  return (
    <div className="model-profile-detail-section">
      <button
        type="button"
        className="eval-text-link"
        style={{
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          textAlign: "left",
          font: "inherit",
        }}
        onClick={() => setOpen((prev) => !prev)}
      >
        {open ? "Hide" : "Show"} detailed attempt logs ({attempts.length} attempts)
      </button>
      {open && (
        <div className="model-profile-table-scroll">
          <table className="eval-table model-profile-table">
            <thead>
              <tr>
                <th scope="col">Case id</th>
                <th scope="col">Rep</th>
                <th scope="col">Execution</th>
                <th scope="col">Verdict</th>
                <th scope="col">Duration</th>
                <th scope="col">Tokens</th>
                <th scope="col">Checks</th>
              </tr>
            </thead>
            <tbody>
              {attempts.map((attempt) => (
                <tr key={`${attempt.caseId}-${attempt.repetition}`}>
                  <th scope="row">
                    <code>{attempt.caseId}</code>
                  </th>
                  <td>r{attempt.repetition}</td>
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
                    {attempt.durationMs.availability === "available" ? (
                      `${attempt.durationMs.value.toLocaleString("en-US")}ms`
                    ) : (
                      <AvailabilityMark availability={attempt.durationMs.availability} />
                    )}
                  </td>
                  <td>
                    {attempt.tokenUsage.availability === "available" ? (
                      `${attempt.tokenUsage.value.totalTokens.toLocaleString("en-US")} (${attempt.tokenUsage.value.inputTokens.toLocaleString("en-US")} in / ${attempt.tokenUsage.value.outputTokens.toLocaleString("en-US")} out)`
                    ) : (
                      <AvailabilityMark availability={attempt.tokenUsage.availability} />
                    )}
                  </td>
                  <td>
                    {attempt.checks.availability === "available" ? (
                      <span style={{ display: "inline-flex", gap: "4px", flexWrap: "wrap" }}>
                        {Object.entries(attempt.checks.value).map(([name, outcome]) => (
                          <span key={name} title={`${name}: ${outcome}`}>
                            <CheckMark outcome={outcome} />
                          </span>
                        ))}
                      </span>
                    ) : (
                      <AvailabilityMark availability={attempt.checks.availability} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Expandable run detail panel
// ---------------------------------------------------------------------------

function RunDetail({ run }: { run: CanonicalRun }) {
  const publication = publicationFor(run);
  const cost = derivedCostPerTask(run);
  const rate = gradedOnlyRate(run);
  const baseline = resolveBaselineRun(run);
  const matrix: readonly OutcomeMatrixRow[] = useMemo(() => outcomeMatrixFor(run), [run]);
  const attempts: readonly CanonicalAttempt[] = useMemo(() => {
    return run.attempts.availability === "available" ? run.attempts.value : [];
  }, [run]);

  const runtimeFailures = attempts.filter((attempt) => attempt.execution === "runtime_failure");

  return (
    <div className="model-profile-run-detail">
      {/* State chips */}
      <div className="model-profile-detail-section">
        <div className="model-profile-detail-chips">
          <CoverageChip run={run} />
          <span className="eval-demo-label">dispatch {run.dispatchCoverage}</span>
          <span className="eval-demo-label">checks {run.checkSource}</span>
          <span className="eval-demo-label">{run.caseBinding}</span>
          <OriginTag origin={run.origin} />
          {run.withheldFields.map((field) => (
            <AvailabilityMark
              key={field.field}
              availability="withheld"
              reason={`${field.field} · ${field.reason}`}
            />
          ))}
        </div>
      </div>

      {/* Headline & graded-only rate */}
      <div className="model-profile-detail-section">
        <h4 className="model-profile-detail-heading">Headline & grading</h4>
        <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", alignItems: "baseline" }}>
          <div>
            <span className="eval-muted">Headline: </span>
            <strong>
              <HeadlineValue headline={headlineFor(run)} />
            </strong>
          </div>
          {rate !== null && (
            <div>
              <GradedOnlyRateValue rate={rate} />
            </div>
          )}
        </div>
      </div>

      {/* Counts grid */}
      <div className="model-profile-detail-section">
        <h4 className="model-profile-detail-heading">Attempt counts</h4>
        <div className="model-profile-counts-grid">
          <div className="model-profile-count-cell">
            <span className="model-profile-count-label">planned</span>
            <span className="model-profile-count-value">{run.counts.planned}</span>
          </div>
          <div className="model-profile-count-cell">
            <span className="model-profile-count-label">started</span>
            <span className="model-profile-count-value">{run.counts.started}</span>
          </div>
          <div className="model-profile-count-cell">
            <span className="model-profile-count-label">completed</span>
            <span className="model-profile-count-value">{run.counts.completed}</span>
          </div>
          <div className="model-profile-count-cell">
            <span className="model-profile-count-label">passed</span>
            <span className="model-profile-count-value">{run.counts.passed}</span>
          </div>
          <div className="model-profile-count-cell">
            <span className="model-profile-count-label">failed</span>
            <span className="model-profile-count-value">{run.counts.failed}</span>
          </div>
          <div className="model-profile-count-cell">
            <span className="model-profile-count-label">graded</span>
            <span className="model-profile-count-value">{run.counts.graded}</span>
          </div>
          {run.counts.unscored !== undefined && (
            <div className="model-profile-count-cell">
              <span className="model-profile-count-label">unscored</span>
              <span className="model-profile-count-value">{run.counts.unscored}</span>
            </div>
          )}
          <div className="model-profile-count-cell">
            <span className="model-profile-count-label">timed out</span>
            <span className="model-profile-count-value">{run.counts.timedOut}</span>
          </div>
          <div className="model-profile-count-cell">
            <span className="model-profile-count-label">runtime failures</span>
            <span className="model-profile-count-value">{run.counts.runtimeFailure}</span>
          </div>
          <div className="model-profile-count-cell">
            <span className="model-profile-count-label">unstarted</span>
            <span className="model-profile-count-value">{run.counts.unstarted}</span>
          </div>
          <div className="model-profile-count-cell">
            <span className="model-profile-count-label">unknown</span>
            <span className="model-profile-count-value">{run.counts.unknown}</span>
          </div>
        </div>
      </div>

      {/* Runtime failures with attribution */}
      {runtimeFailures.length > 0 && (
        <div className="model-profile-detail-section">
          <h4 className="model-profile-detail-heading">Runtime failures</h4>
          <ul style={{ margin: 0, paddingLeft: "18px" }}>
            {runtimeFailures.map((attempt) => (
              <li key={`${attempt.caseId}-${attempt.repetition}`}>
                <code>{attempt.caseId}</code> rep {attempt.repetition}: attribution{" "}
                <strong>{attempt.failureAttribution ?? "unattributed"}</strong>
                {attempt.wallDurationMs.availability === "available" && (
                  <span className="eval-muted">
                    {" "}
                    (wall {attempt.wallDurationMs.value.toLocaleString("en-US")}ms)
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Run metrics table */}
      <div className="model-profile-detail-section">
        <h4 className="model-profile-detail-heading">Measured metrics</h4>
        <div className="model-profile-table-scroll">
          <table className="eval-table model-profile-table">
            <tbody>
              <tr>
                <th scope="row">latency (p50 · p95 · max)</th>
                <td>
                  <LatencyValue metric={run.metrics.latencyMs} />
                </td>
              </tr>
              <tr>
                <th scope="row">token usage</th>
                <td>
                  <TokenUsageValue metric={run.metrics.tokenUsage} />
                </td>
              </tr>
              <DerivedCostRow cost={cost} />
              <tr>
                <th scope="row">answer accuracy</th>
                <td>
                  <AvailabilityMark
                    availability={run.metrics.answerAccuracy.availability}
                    reason={run.metrics.answerAccuracy.reason}
                  />
                </td>
              </tr>
              <tr>
                <th scope="row">USD cost (measured)</th>
                <td>
                  <AvailabilityMark
                    availability={run.metrics.usdCost.availability}
                    reason={run.metrics.usdCost.reason}
                  />
                </td>
              </tr>
              <tr>
                <th scope="row">uncertainty</th>
                <td>
                  <AvailabilityMark
                    availability={run.metrics.uncertainty.availability}
                    reason={run.metrics.uncertainty.reason}
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <CheckDimensionPanel
        fill
        series={[{ key: "run", label: runDisplayLabel(run.runId), dimensions: run.dimensions }]}
      />

      {/* Per-check outcome matrix */}
      {matrix.length > 0 && (
        <div className="model-profile-detail-section">
          <h4 className="model-profile-detail-heading">Outcome matrix (cases × repetitions)</h4>
          <div className="model-profile-matrix-wrap">
            <table className="model-profile-matrix-table">
              <thead>
                <tr>
                  <th scope="col">Case</th>
                  {Array.from(
                    {
                      length: Math.max(...matrix.map((row) => row.attempts.length), 1),
                    },
                    (_, index) => (
                      <th scope="col" key={index}>
                        r{index + 1}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {matrix.map((row) => (
                  <tr key={row.caseId}>
                    <th scope="row">
                      <span>{row.definition?.title ?? row.caseId}</span>
                      <span className="model-profile-matrix-case-meta">
                        {row.caseId}
                        {row.definition?.category ? ` · ${row.definition.category}` : ""}
                      </span>
                    </th>
                    {row.attempts.map((attempt, index) => (
                      <OutcomeMatrixCell key={index} attempt={attempt} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Attempt log table */}
      <AttemptDetailsTable attempts={attempts} />

      {/* Provenance & publication */}
      <div className="model-profile-detail-section">
        <h4 className="model-profile-detail-heading">Provenance & publication</h4>
        <dl className="model-profile-run-details">
          <div>
            <dt>Recorded run</dt>
            <dd>
              <code>{runDisplayLabel(run.runId)}</code>
            </dd>
          </div>
          <div>
            <dt>Campaign</dt>
            <dd>
              <code>{campaignDisplayLabel(run.campaignId)}</code>
            </dd>
          </div>
          <div>
            <dt>Started at</dt>
            <dd>{run.startedAt}</dd>
          </div>
          <div>
            <dt>Cohort</dt>
            <dd>{cohortLabel(run.cohort)}</dd>
          </div>
          <div>
            <dt>Attempt budgets</dt>
            <dd>{recordedBudgetLabel([run])}</dd>
          </div>
          <div>
            <dt>Source label</dt>
            <dd>{run.provenance.sourceLabel}</dd>
          </div>
          {run.provenance.sourceArtifactSha256 && (
            <div>
              <dt>Source artifact SHA-256</dt>
              <dd>
                <code>{run.provenance.sourceArtifactSha256}</code>
              </dd>
            </div>
          )}
          {run.provenance.sourceCommit && (
            <div>
              <dt>
                {run.provenance.sourceKind === "extracted_snapshot"
                  ? "Snapshot source reference"
                  : "Source commit"}
              </dt>
              <dd>
                <code>{run.provenance.sourceCommit}</code>
              </dd>
            </div>
          )}
          {baseline && (
            <div>
              <dt>Embedded baseline</dt>
              <dd>
                Resolves to canonical run <code>{runDisplayLabel(baseline.runId)}</code>
              </dd>
            </div>
          )}
          {publication && (
            <div>
              <dt>Publication</dt>
              <dd>
                <code>{publication.publicationId}</code> · status:{" "}
                <strong>{publication.status}</strong> · {publication.revisions.length} revision
                {publication.revisions.length === 1 ? "" : "s"}
              </dd>
            </div>
          )}
        </dl>
        {run.notes.length > 0 && (
          <div style={{ padding: "0 20px 8px" }}>
            <span className="eval-muted">Notes:</span>
            <ul style={{ margin: "4px 0 0", paddingLeft: "18px" }}>
              {run.notes.map((note) => (
                <li key={note} className="eval-muted">
                  {note}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Run history table with expandable rows
// ---------------------------------------------------------------------------

function RunHistoryPanel({
  runs,
  withdrawn,
  expandedRunId,
  onToggleRun,
}: {
  runs: readonly CanonicalRun[];
  withdrawn: readonly WithdrawnRunRef[];
  expandedRunId?: string;
  onToggleRun: (runId: string) => void;
}) {
  return (
    <Panel
      className="model-profile-history-panel"
      title="Run history"
      description="All recorded runs, including earlier incomplete attempts. These are historical records, not additional reasoning levels. Expand a row for task outcomes and sources."
    >
      <div className="model-profile-table-scroll">
        <table className="eval-table model-profile-table">
          <thead>
            <tr>
              <th scope="col" style={{ width: "32px" }}></th>
              <th scope="col">Run id</th>
              <th scope="col">Family</th>
              <th scope="col">Date</th>
              <th scope="col">Headline</th>
              <th scope="col">Scoring</th>
              <th scope="col">Configuration</th>
              <th scope="col">Publication</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => {
              const isExpanded = expandedRunId === run.runId;
              const publication = publicationFor(run);
              const headline = headlineFor(run);
              return (
                <Fragment key={run.runId}>
                  <tr
                    id={`run-row-${run.runId}`}
                    className={`model-profile-history-row ${
                      isExpanded ? "model-profile-history-row-expanded" : ""
                    }`}
                    onClick={() => onToggleRun(run.runId)}
                  >
                    <td>
                      <button
                        type="button"
                        className="model-profile-expand-toggle"
                        aria-label={`${isExpanded ? "Collapse" : "Expand"} run details for ${runDisplayLabel(run.runId)}`}
                        aria-expanded={isExpanded}
                        aria-controls={`run-details-${run.runId}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onToggleRun(run.runId);
                        }}
                      >
                        {isExpanded ? (
                          <ChevronDown size={12} aria-hidden="true" />
                        ) : (
                          <ChevronRight size={12} aria-hidden="true" />
                        )}
                      </button>
                    </td>
                    <th scope="row">
                      <div className="model-profile-run-id-cell">
                        <code>{runDisplayLabel(run.runId)}</code>
                        <OriginTag origin={run.origin} />
                      </div>
                    </th>
                    <td>{run.family}</td>
                    <td>{run.startedAt.slice(0, 10)}</td>
                    <td>
                      <HeadlineValue headline={headline} />
                    </td>
                    <td>
                      <CoverageChip run={run} />
                    </td>
                    <td>
                      {run.configuration.availability === "pinned" ? (
                        <code>pin {shortSha(run.configuration.pinnedSha256)}</code>
                      ) : (
                        <AvailabilityMark availability="not_recorded" reason="labels-only" />
                      )}
                    </td>
                    <td>
                      {publication ? (
                        <span>
                          rev {publication.revisions.length}
                          {publication.status === "withdrawn" && " · withdrawn"}
                        </span>
                      ) : (
                        <span className="eval-muted">—</span>
                      )}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan={8} className="model-profile-detail-cell">
                        <section
                          id={`run-details-${run.runId}`}
                          aria-label={`Run details for ${runDisplayLabel(run.runId)}`}
                        >
                          <RunDetail run={run} />
                        </section>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {/* Withdrawn demonstration rows */}
            {withdrawn.map((item) => (
              <tr key={item.runId} className="eval-muted">
                <td></td>
                <th scope="row">
                  <div className="model-profile-run-id-cell">
                    <code>{runDisplayLabel(item.runId)}</code>
                    <OriginTag origin={item.origin} />
                    <span className="eval-demo-label">withdrawn</span>
                  </div>
                </th>
                <td>{item.family}</td>
                <td>{item.startedAt.slice(0, 10)}</td>
                <td colSpan={4}>
                  <span>
                    {item.withdrawal.notice} (reason: {item.withdrawal.reason} ·{" "}
                    {item.withdrawal.withdrawnAt.slice(0, 10)})
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
// Campaigns & limitations panel
// ---------------------------------------------------------------------------

function CampaignsPanel({
  campaigns,
  runs,
}: {
  campaigns: readonly CanonicalCampaign[];
  runs: readonly CanonicalRun[];
}) {
  if (campaigns.length === 0) return null;
  return (
    <Panel
      className="model-profile-campaigns"
      title="Campaigns & limitations"
      description="When these results were recorded, what is complete, and how to interpret the comparison."
    >
      <div className="model-profile-campaign-list">
        {campaigns.map((campaign) => {
          const campaignRuns = runs.filter((run) => run.campaignId === campaign.campaignId);
          const counts = recordedOutcomes(campaignRuns);
          const levels = [
            ...new Set(campaignRuns.map((run) => run.configuration.reasoning ?? "unspecified")),
          ];
          const clients = [
            ...new Set(campaignRuns.map((run) => clientDisplayName(run.cohort.target))),
          ];
          return (
            <article className="model-profile-campaign" key={campaign.campaignId}>
              <div className="model-profile-campaign-heading">
                <h3>
                  <time dateTime={campaign.date}>{campaign.date}</time>
                </h3>
                <span>
                  {counts.graded}/{counts.planned} graded
                </span>
              </div>
              <p>
                {clients.join(" / ")} · {campaign.repetitions} repetitions per task ·{" "}
                {recordedBudgetLabel(campaignRuns)}
              </p>
              <p>Reasoning: {levels.join(", ")}</p>
              <p className="model-profile-campaign-outcomes">
                {counts.passed} passed · {counts.failed} failed
                {counts.planned > counts.graded && ` · ${counts.planned - counts.graded} ungraded`}
                {counts.timedOut > 0 && ` · ${counts.timedOut} timed out`}
                {counts.runtimeFailure > 0 && ` · ${counts.runtimeFailure} run errors`}
              </p>
              <details className="model-profile-campaign-sources">
                <summary>Full campaign notes &amp; sources</summary>
                <dl className="model-profile-run-details">
                  <div>
                    <dt>Campaign identifier</dt>
                    <dd>
                      <code>{campaign.campaignId}</code>
                    </dd>
                  </div>
                  {campaign.sourceCommit && (
                    <div>
                      <dt>Source commit</dt>
                      <dd>
                        <code>{campaign.sourceCommit}</code>
                      </dd>
                    </div>
                  )}
                </dl>
                <ul>
                  {campaign.limitations.map((limitation) => (
                    <li key={limitation}>{limitation}</li>
                  ))}
                </ul>
                {campaign.prUrl && (
                  <a
                    className="eval-text-link"
                    href={campaign.prUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {campaign.prLabel ?? "View source PR"}{" "}
                    <ArrowUpRight size={14} aria-hidden="true" />
                  </a>
                )}
              </details>
            </article>
          );
        })}
      </div>
      <div className="model-profile-limitations">
        <h3>How to read these results</h3>
        <ul>
          <li>
            <strong>Graded does not mean passed.</strong> Each graded attempt has a pass or fail
            verdict. Terminal timeouts and run errors earn zero success credit without becoming
            graded failures. Unfinished processing or missing category coverage keeps Overall
            unavailable.
          </li>
          <li>
            <strong>These are small, live samples.</strong> Results reflect the model, client,
            recorded budget and backend conditions. Reasoning labels describe requested settings,
            not independently verified provider behaviour.
          </li>
          <li>
            <strong>The score measures task checks.</strong> These cover tool use and completion,
            with answer-grounding checks on the reviewed price tasks. They do not establish general
            answer quality.
          </li>
          <li>
            <strong>Costs and timings have exclusions.</strong> Summary metrics cover the selected
            completed attempts with records, excluding failed execution retries and subscription
            charges. Earlier and later campaigns can share attempts; their totals should not be
            added together.
          </li>
        </ul>
        <a className="eval-text-link" href="#/methodology">
          Read the full methodology <ArrowUpRight size={14} aria-hidden="true" />
        </a>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Model profile page
// ---------------------------------------------------------------------------

const MODEL_ID_ALIASES: Readonly<Record<string, string>> = {
  "muse-spark-1-3": "muse-spark",
  "claude-fable-5-1": "claude-fable",
  "claude-opus-5": "claude-opus",
  "gpt-5-5": "gpt-5.5",
  "gpt-5-6-sol": "gpt-sol",
  "gpt-5-6-terra": "gpt-terra",
  "gpt-6-astra": "astra",
  "grok-4-6": "grok",
  "gemini-3-8-flash": "gemini",
};

export function ModelProfilePage({
  modelId: propModelId,
  initialRunId,
  includeSynthetic = false,
}: ModelProfilePageProps) {
  const rawId = propModelId?.split("?")[0] || "gpt-5.5";
  const cleanModelId = MODEL_ID_ALIASES[rawId] ?? rawId;
  const model = getModel(cleanModelId);
  const [selectedRunId, setSelectedRunId] = useState(() => initialRunId ?? readRunQueryParam());
  const [expandedRunId, setExpandedRunId] = useState(() => initialRunId ?? readRunQueryParam());
  const [historyOpen, setHistoryOpen] = useState(Boolean(initialRunId));
  const allSettings = useMemo(
    () => configurationLeaderboardRows().filter((row) => row.model.id === cleanModelId),
    [cleanModelId],
  );
  const settings = useMemo(
    () => modelProfileRows(cleanModelId, allSettings),
    [cleanModelId, allSettings],
  );
  const selected = selectProfileSetting(cleanModelId, selectedRunId, allSettings);
  useEffect(() => {
    if (initialRunId) {
      setSelectedRunId(initialRunId);
      setExpandedRunId(initialRunId);
      setHistoryOpen(true);
    }
  }, [initialRunId]);

  if (!model)
    return (
      <PageShell active="models" className="lb-page mp-page">
        <div className="eval-container mp-content">
          <nav className="mp-breadcrumbs" aria-label="Breadcrumb">
            <a href="#/leaderboard">Leaderboard</a>
            <span>/</span>
            <span>Model not found</span>
          </nav>
          <h1 className="mp-title">Model not found</h1>
          <p>
            No canonical model matches <code>{cleanModelId}</code>.
          </p>
          <a className="mp-inline-link" href="#/models">
            Browse all models <ArrowUpRight size={14} />
          </a>
        </div>
      </PageShell>
    );

  const runs = runHistoryFor(model.id).filter(
    (run) => includeSynthetic || run.origin === "measured",
  );
  const modelWithdrawn = withdrawnRuns.filter(
    (run) => run.modelId === model.id && (includeSynthetic || run.origin === "measured"),
  );
  const campaigns = canonicalCampaigns.filter((campaign) =>
    runs.some((run) => run.campaignId === campaign.campaignId),
  );
  const artifacts = MODEL_ARTIFACTS[model.id] ?? [];
  const historical =
    selected !== undefined && !settings.some((row) => rowKey(row) === rowKey(selected));
  const choices = historical ? [...settings, selected] : settings;
  const selectedRuns = selected ? Object.values(selected.runs) : [];
  const selectedFirst = selected?.runs.Spot ?? selectedRuns[0];
  const requestedUnavailable =
    selectedRunId !== undefined && !selectedRuns.some((run) => run.runId === selectedRunId);

  function chooseRun(runId: string) {
    setSelectedRunId(runId);
    const params = new URLSearchParams(window.location.hash.split("?")[1]);
    params.set("run", runId);
    window.history.replaceState(window.history.state, "", `#/models/${model!.id}?${params}`);
  }
  function chooseSetting(row: LeaderboardModelRow) {
    const run = row.runs.Spot ?? Object.values(row.runs)[0];
    if (run) chooseRun(run.runId);
  }
  function inspectRun(runId: string) {
    chooseRun(runId);
    setExpandedRunId(runId);
    setHistoryOpen(true);
    requestAnimationFrame(() =>
      document.getElementById(`run-row-${runId}`)?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start",
      }),
    );
  }

  return (
    <PageShell
      active="models"
      className="lb-page mp-page"
      footerNote={`Measured financial tool-use evaluations for ${model.name}. Scores reflect the recorded setting, client, and budget.`}
    >
      <div className="eval-container model-profile-page mp-content">
        <nav className="mp-breadcrumbs" aria-label="Breadcrumb">
          <a href="#/leaderboard">Leaderboard</a>
          <span aria-hidden="true">/</span>
          <a href="#/models">Models</a>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{model.name}</span>
        </nav>
        <header className="mp-header">
          <div className="mp-identity">
            <ModelAvatar model={model} size="lg" />
            <div>
              <p className="mp-provider">{model.provider} · Financial evaluations</p>
              <h1 className="mp-title">{model.name}</h1>
            </div>
          </div>
          <a className="mp-inline-link" href="#/methodology">
            Methodology <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        </header>
        {model.origin === "synthetic" && (
          <p className="mp-scope-note" role="note">
            Synthetic demonstration. These are not measured model results.
          </p>
        )}
        <div className="mp-selection-bar">
          <label>
            Recorded setting
            <select
              aria-label="Recorded setting"
              value={selected ? rowKey(selected) : ""}
              disabled={!choices.length}
              onChange={(event) => {
                const row = choices.find((entry) => rowKey(entry) === event.target.value);
                if (row) chooseSetting(row);
              }}
            >
              {choices.length ? (
                choices.map((row) => (
                  <option key={rowKey(row)} value={rowKey(row)}>
                    {row.configurationLabel} · {Object.values(row.runs)[0]?.startedAt.slice(0, 10)}
                    {historical && selected === row ? " · Historical" : ""}
                  </option>
                ))
              ) : (
                <option value="">No measured setting available</option>
              )}
            </select>
          </label>
          <span>
            {historical
              ? "Historical setting"
              : selectedRunId && !requestedUnavailable
                ? "Selected recorded setting"
                : "Latest recorded setting"}
            {selectedFirst ? ` · ${selectedFirst.startedAt.slice(0, 10)}` : ""}
          </span>
        </div>
        {requestedUnavailable && (
          <p className="mp-scope-note" role="status">
            The requested run is unavailable for this model. Showing its latest available recorded
            setting.
          </p>
        )}
        {selected ? (
          <ModelProfileOverview row={selected} onInspectRun={inspectRun} />
        ) : (
          <section className="mp-empty">
            <h2>No measured summary available</h2>
            <p>Recorded history and publication details are available below.</p>
          </section>
        )}
        {model.origin !== "synthetic" && (
          <ModelSettingResults
            modelId={model.id}
            selectedRowId={selected ? rowKey(selected) : undefined}
            onSelectSetting={chooseSetting}
          />
        )}
        <section className="mp-evidence-sections" aria-label="Evidence and sources">
          <details
            className="mp-disclosure"
            open={historyOpen}
            onToggle={(event) => setHistoryOpen(event.currentTarget.open)}
          >
            <summary>
              <span>Run history &amp; task evidence</span>
              <small>{runs.length} recorded runs</small>
            </summary>
            <RunHistoryPanel
              runs={runs}
              withdrawn={modelWithdrawn}
              expandedRunId={historyOpen ? expandedRunId : undefined}
              onToggleRun={(runId) =>
                setExpandedRunId((current) => (current === runId ? undefined : runId))
              }
            />
          </details>
          <details className="mp-disclosure">
            <summary>
              <span>Configuration fingerprints &amp; original downloads</span>
              <small>Sources &amp; provenance</small>
            </summary>
            <ConfigurationGroupsPanel runs={runs} onSelectRun={inspectRun} />
            <div className="mp-downloads">
              <a href="/transcripts/index.json" download="askgina-transcript-index.json">
                <Download size={14} aria-hidden="true" /> Transcript index
              </a>
              {artifacts.map((artifact) => (
                <a key={artifact.filename} href={artifact.url} download={artifact.filename}>
                  <Download size={14} aria-hidden="true" /> Original {artifact.description} JSON
                </a>
              ))}
            </div>
          </details>
          <details className="mp-disclosure">
            <summary>
              <span>Campaigns, coverage &amp; limitations</span>
              <small>{campaigns.length} campaigns</small>
            </summary>
            <CampaignsPanel campaigns={campaigns} runs={runs} />
          </details>
        </section>
        <p className="mp-footer-note">
          Scores describe financial tool use in recorded evaluations. Spot transaction results are
          separate from the three tool-use category scores.{" "}
          <a href="#/methodology">How these evaluations work ↗</a>
        </p>
      </div>
    </PageShell>
  );
}
