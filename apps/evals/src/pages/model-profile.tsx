import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, ChevronDown, ChevronRight, Download } from "lucide-react";
import {
  canonicalCampaigns,
  MEASURED_FAMILIES,
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
import { Button } from "../components/ui/button";
import "./model-profile.css";

// ---------------------------------------------------------------------------
// Bundled source artifact downloads (decision 13: byte-identical ?url imports)
// ---------------------------------------------------------------------------

import gpt55SpotReportUrl from "../results/2026-09-11/spot-comparison/comparison.json?url";
import solReportUrl from "../results/2026-09-11/perps-predictions/report/ask-gina-perps-predictions-evals-2026-09-11.json?url";
import museReportUrl from "../results/2026-09-14/muse-spark-1.3/report/ask-gina-muse-spark-1.3-evals-2026-09-14.json?url";
import claudeComparisonUrl from "../results/2026-09-14/claude-comparison/ask-gina-claude-comparison.json?url";
import reasoningSweepUrl from "../results/2026-09-16/reasoning-sweep/ask-gina-reasoning-sweep.json?url";
import reasoningSweepClaudeUrl from "../results/2026-09-16/reasoning-sweep/ask-gina-reasoning-sweep-claude.json?url";

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
// Metric cards per family (newest representative measured run)
// ---------------------------------------------------------------------------

function FamilyMetricCards({
  modelId,
  includeSynthetic,
  onSelectRun,
}: {
  modelId: string;
  includeSynthetic: boolean;
  onSelectRun: (runId: string) => void;
}) {
  const cards = useMemo(() => {
    return MEASURED_FAMILIES.map((family) => {
      const runs = runHistoryFor(modelId, family).filter(
        (run) => includeSynthetic || run.origin === "measured",
      );
      const representative = runs[0];
      return { family, representative, count: runs.length };
    }).filter((entry) => entry.representative !== undefined);
  }, [modelId, includeSynthetic]);

  if (cards.length === 0) return null;

  return (
    <>
      <p className="eval-muted">Latest recorded run per family, not an overall or best score.</p>
      <section className="model-profile-metrics" aria-label="Latest recorded run per task family">
        {cards.map(({ family, representative }) => {
          if (!representative) return null;
          const headline = headlineFor(representative);
          const unscored = representative.counts.started - representative.counts.graded;
          const timeoutMs =
            representative.timeoutMs ??
            canonicalCampaigns.find((campaign) => campaign.campaignId === representative.campaignId)
              ?.timeoutMs;
          return (
            <article className="model-profile-metric" key={family}>
              <div className="model-profile-metric-header">
                <span className="model-profile-metric-label">{family}</span>
                <CoverageChip run={representative} />
              </div>
              <p className="model-profile-metric-unscored">
                Reasoning {representative.configuration.reasoning ?? "not recorded"} ·{" "}
                <code>{representative.cohort.target}</code> ·{" "}
                {timeoutMs === null || timeoutMs === undefined
                  ? "timeout not recorded"
                  : `${timeoutMs / 1000}s timeout`}
              </p>
              <div className="model-profile-metric-headline">
                <strong>
                  <HeadlineValue headline={headline} />
                </strong>
                {headline.kind === "rate" && <span className="eval-muted">passes / started</span>}
              </div>
              <dl className="model-profile-metric-details">
                <div className="model-profile-metric-row">
                  <dt className="eval-muted">Graded / planned:</dt>
                  <dd>
                    {representative.counts.graded} / {representative.counts.planned}
                  </dd>
                </div>
                <div className="model-profile-metric-row">
                  <dt className="eval-muted">Latency:</dt>
                  <dd>
                    <LatencyValue metric={representative.metrics.latencyMs} />
                  </dd>
                </div>
                <div className="model-profile-metric-row">
                  <dt className="eval-muted">Tokens:</dt>
                  <dd>
                    <TokenUsageValue metric={representative.metrics.tokenUsage} />
                  </dd>
                </div>
              </dl>
              <div className="model-profile-metric-unscored">
                {unscored > 0 ? (
                  <span>
                    {unscored} unscored (
                    {[
                      representative.counts.timedOut > 0
                        ? `${representative.counts.timedOut} timed out`
                        : null,
                      representative.counts.runtimeFailure > 0
                        ? `${representative.counts.runtimeFailure} runtime failure`
                        : null,
                      representative.counts.pending > 0
                        ? `${representative.counts.pending} pending`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                    )
                  </span>
                ) : (
                  <span className="eval-muted">All started attempts graded</span>
                )}
              </div>
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
                onClick={() => onSelectRun(representative.runId)}
              >
                Inspect run <code>{runDisplayLabel(representative.runId)}</code> →
              </button>
            </article>
          );
        })}
      </section>
    </>
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
      title="Configuration groups"
      description="Runs are grouped by exact pinnedSha256 identity. Labels-only configurations stand alone and cannot match a pinned group."
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
          {run.timeoutMs !== undefined && (
            <div>
              <dt>Trial timeout</dt>
              <dd>{run.timeoutMs / 1000}s</dd>
            </div>
          )}
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
      description="All evaluations for this model, ordered newest first. Click any row to expand attempt counts, per-case outcomes, and provenance."
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
                <tr
                  key={run.runId}
                  className={`model-profile-history-row ${
                    isExpanded ? "model-profile-history-row-expanded" : ""
                  }`}
                  onClick={() => onToggleRun(run.runId)}
                >
                  <td>
                    <button
                      type="button"
                      className="model-profile-expand-toggle"
                      aria-label={isExpanded ? "Collapse run details" : "Expand run details"}
                      aria-expanded={isExpanded}
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

      {/* Expanded detail row container */}
      {expandedRunId &&
        (() => {
          const run = runs.find((r) => r.runId === expandedRunId);
          if (!run) return null;
          return <RunDetail run={run} />;
        })()}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Campaigns & limitations panel
// ---------------------------------------------------------------------------

function CampaignsPanel({ campaigns }: { campaigns: readonly CanonicalCampaign[] }) {
  if (campaigns.length === 0) return null;
  return (
    <Panel
      title="Campaigns & limitations"
      description="Harness versions, execution dates, and known review limitations."
    >
      <dl className="model-profile-run-details">
        {campaigns.map((campaign) => (
          <div key={campaign.campaignId}>
            <dt>{campaignDisplayLabel(campaign.campaignId)}</dt>
            <dd>
              {campaign.date} · {campaign.harness} · {campaign.repetitions} reps ·{" "}
              {campaign.timeoutMs === null
                ? "route-specific timeouts"
                : `${campaign.timeoutMs / 1000}s timeout`}
              {campaign.sourceCommit && (
                <>
                  {" "}
                  · commit <code>{campaign.sourceCommit.slice(0, 7)}</code>
                </>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {campaigns.some((c) => c.limitations.length > 0) && (
        <div style={{ padding: "0 20px 18px" }}>
          <span className="eval-muted">Limitations:</span>
          <ul style={{ margin: "4px 0 0", paddingLeft: "18px" }}>
            {campaigns
              .flatMap((c) => c.limitations)
              .map((limitation, index) => (
                <li key={index}>{limitation}</li>
              ))}
          </ul>
        </div>
      )}
      {campaigns.some((c) => c.prUrl) && (
        <div style={{ padding: "0 20px 18px" }}>
          {campaigns
            .filter((c) => c.prUrl)
            .map((c) => (
              <a
                key={c.campaignId}
                className="eval-text-link model-profile-run-link"
                href={c.prUrl}
                target="_blank"
                rel="noreferrer"
              >
                {c.prLabel ?? "Open GitHub PR"} ({campaignDisplayLabel(c.campaignId)}){" "}
                <ArrowUpRight size={14} aria-hidden="true" />
              </a>
            ))}
        </div>
      )}
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
  // Strip any query string attached to the prop (e.g. `gpt-5.5?run=…`)
  const rawId = propModelId?.split("?")[0] || "gpt-5.5";
  const cleanModelId = MODEL_ID_ALIASES[rawId] ?? rawId;
  const model = getModel(cleanModelId);

  const [expandedRunId, setExpandedRunId] = useState<string | undefined>(() => {
    return initialRunId ?? readRunQueryParam();
  });

  useEffect(() => {
    if (initialRunId) setExpandedRunId(initialRunId);
  }, [initialRunId]);

  if (!model) {
    return (
      <PageShell active="models">
        <div className="eval-container model-profile-page">
          <section
            className="eval-hero model-profile-not-found"
            aria-labelledby="model-profile-not-found-title"
          >
            <img className="eval-hero-art" src="/images/hero-watercolor-landscape.webp" alt="" />
            <nav className="model-profile-breadcrumbs" aria-label="Breadcrumb">
              <a href="#/leaderboard">Leaderboard</a>
              <span aria-hidden="true">/</span>
              <a href="#/models">Models</a>
              <span aria-hidden="true">/</span>
              <span aria-current="page">Not found</span>
            </nav>
            <p className="eval-eyebrow">Model profile · Conformance harness</p>
            <h1 className="eval-title" id="model-profile-not-found-title">
              Model not found<span>.</span>
            </h1>
            <p className="eval-description">
              No canonical model matches the identifier <code>{cleanModelId}</code>.
            </p>
            <a className="eval-text-link" href="#/models">
              Browse all models <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          </section>
        </div>
      </PageShell>
    );
  }

  // Filter runs by origin: synthetic runs are excluded from app pages (decision 9).
  // They remain reachable when includeSynthetic is true (Storybook).
  const runs = runHistoryFor(model.id).filter(
    (run) => includeSynthetic || run.origin === "measured",
  );
  const museSweepCounts =
    model.id === "muse-spark"
      ? runs.reduce(
          (sum, run) => {
            if (run.campaignId !== "reasoning-sweep-2026-09-16") return sum;
            sum.planned += run.counts.planned;
            sum.graded += run.counts.graded;
            sum.passed += run.counts.passed;
            sum.failed += run.counts.failed;
            sum.unscored += run.counts.timedOut + run.counts.runtimeFailure;
            return sum;
          },
          { planned: 0, graded: 0, passed: 0, failed: 0, unscored: 0 },
        )
      : null;

  const modelWithdrawn = withdrawnRuns.filter(
    (w) => w.modelId === model.id && (includeSynthetic || w.origin === "measured"),
  );

  const campaignIds = [...new Set(runs.map((run) => run.campaignId))];
  const campaigns = canonicalCampaigns.filter((c) => campaignIds.includes(c.campaignId));

  const artifacts = MODEL_ARTIFACTS[model.id] ?? [];

  const handleSelectRun = (runId: string) => {
    setExpandedRunId(runId);
    // Smooth scroll down to the history section
    const el = document.querySelector(".model-profile-history-panel");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleToggleRun = (runId: string) => {
    setExpandedRunId((prev) => (prev === runId ? undefined : runId));
  };

  return (
    <PageShell
      active="models"
      footerNote={`Canonical evaluation profile for ${model.name}. Conformance results from bundled campaign artifacts.`}
    >
      <div className="eval-container model-profile-page">
        {/* Hero section */}
        <section className="eval-hero model-profile-hero" aria-labelledby="model-profile-title">
          <img className="eval-hero-art" src="/images/hero-watercolor-landscape.webp" alt="" />
          <div className="model-profile-intro">
            <nav className="model-profile-breadcrumbs" aria-label="Breadcrumb">
              <a href="#/leaderboard">Leaderboard</a>
              <span aria-hidden="true">/</span>
              <a href="#/models">Models</a>
              <span aria-hidden="true">/</span>
              <span aria-current="page">{model.name}</span>
            </nav>
            <p className="eval-eyebrow">
              Model profile ·{" "}
              {model.origin === "synthetic" ? "Synthetic demonstration" : "Measured conformance"}
            </p>
            <div className="model-profile-title-row">
              <ModelAvatar model={model} size="lg" />
              <h1 className="eval-title" id="model-profile-title">
                {model.name}
                <span>.</span>
              </h1>
              <OriginTag origin={model.origin} />
            </div>
            <p className="model-profile-provider">
              {model.provider} · <code>{model.providerModel}</code>
            </p>
            <p className="eval-description">
              {campaigns.length > 0
                ? campaigns.map((c) => `${c.harness} (${c.date}, ${c.repetitions} reps)`).join("; ")
                : "Canonical evaluation profile"}
              . Small live samples; measures tool routing, arguments, completion and safety.
            </p>
            {museSweepCounts !== null && museSweepCounts.planned > 0 && (
              <p className="eval-description" role="note">
                <strong>Quota-limited Muse scoring.</strong> {museSweepCounts.graded} of{" "}
                {museSweepCounts.planned} planned sweep trials were graded: {museSweepCounts.passed}{" "}
                passed, {museSweepCounts.failed} failed and {museSweepCounts.unscored} remain
                unscored. Complete dispatch is not complete grading. Sequential cases leave
                different graded case mixes across reasoning levels. Do not rank or compare their
                graded-only pass percentages. The quota scope is not established.
              </p>
            )}
          </div>

          <div className="model-profile-actions">
            {artifacts.map((artifact) => (
              <Button
                asChild
                className="model-profile-download-button"
                variant="secondary"
                key={artifact.filename}
              >
                <a
                  href={artifact.url}
                  download={artifact.filename}
                  title={`Download bundled JSON artifact (${artifact.description})`}
                >
                  <Download size={15} aria-hidden="true" /> Download {artifact.description}
                </a>
              </Button>
            ))}
            <a className="eval-text-link" href="#/methodology">
              View methodology <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          </div>
        </section>

        {/* Metric cards per family */}
        <FamilyMetricCards
          modelId={model.id}
          includeSynthetic={includeSynthetic}
          onSelectRun={handleSelectRun}
        />

        {/* Configuration groups */}
        <ConfigurationGroupsPanel runs={runs} onSelectRun={handleSelectRun} />

        {/* Run history table with expandable rows */}
        <RunHistoryPanel
          runs={runs}
          withdrawn={modelWithdrawn}
          expandedRunId={expandedRunId}
          onToggleRun={handleToggleRun}
        />

        {/* Campaigns & limitations */}
        <CampaignsPanel campaigns={campaigns} />
      </div>
    </PageShell>
  );
}
