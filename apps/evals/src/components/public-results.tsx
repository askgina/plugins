import { useState, type ReactNode } from "react";
import type {
  PublicEvalAttemptSummary,
  PublicEvalCheckName,
  PublicEvalDataOrigin,
  PublicEvalEvidenceAvailability,
  PublicEvalIndex,
  PublicEvalPublication,
  PublicEvalResult,
  PublicEvalUnrankedReason,
} from "@askgina/contracts";
import { Panel } from "./eval-ui";

/**
 * Read-only views over already-parsed public eval artifacts. Every value is
 * rendered as exported: nothing here derives scores, categories, or ratios,
 * and no artifact path is ever turned into a link or fetched.
 */

type Review = PublicEvalPublication["review"];
type Supersedes = NonNullable<PublicEvalPublication["supersedes"]>;
type Withdrawal = Extract<PublicEvalPublication["content"], { kind: "withdrawal_notice" }>;
type MetricUnavailable = PublicEvalResult["metrics"]["answerAccuracy"];
type IndexEntry = PublicEvalIndex["publications"][number];
type IndexRevision = IndexEntry["revisions"][number];

const INTEGER = new Intl.NumberFormat("en-US");

const ORIGIN_LABELS: Readonly<Record<PublicEvalDataOrigin, string>> = {
  synthetic: "Synthetic preview data",
  measured: "Measured, as declared by this artifact",
};

const CHECK_LABELS = {
  routing: "Routing",
  arguments: "Arguments",
  safety: "Safety",
  completion: "Completion",
  skillActivation: "Skill activation",
} as const satisfies Readonly<Record<PublicEvalCheckName, string>>;
// Only these approved check keys are rendered, in contract order.
const CHECK_NAMES = Object.keys(CHECK_LABELS) as readonly (keyof typeof CHECK_LABELS)[];

const AVAILABILITY_LABELS: Readonly<Record<MetricUnavailable["availability"], string>> = {
  not_evaluated: "Not evaluated",
  not_applicable: "Not applicable",
  not_retained: "Not retained",
  withheld: "Withheld",
};

const UNAVAILABLE_REASON_LABELS: Readonly<Record<MetricUnavailable["reason"], string>> = {
  no_declared_method: "no declared method",
  incomplete_coverage: "incomplete coverage",
  not_captured: "not captured",
  privacy_review: "privacy review",
};

const EVIDENCE_LABELS: Readonly<Record<PublicEvalEvidenceAvailability, string>> = {
  available: "Available",
  aggregate_only: "Aggregate only",
  not_retained: "Not retained",
  withheld: "Withheld",
  not_evaluated: "Not evaluated",
  not_applicable: "Not applicable",
};

const UNRANKED_REASON_LABELS: Readonly<Record<PublicEvalUnrankedReason, string>> = {
  pilot: "Pilot benchmark",
  synthetic: "Synthetic data origin",
  incomplete_coverage: "Incomplete coverage",
  missing_pinned_configuration: "Configuration not pinned",
};

const WITHDRAWAL_REASON_LABELS: Readonly<Record<Withdrawal["reason"], string>> = {
  privacy: "privacy",
  data_integrity: "data integrity",
  owner_request: "owner request",
};

const SUPERSEDES_LABELS: Readonly<Record<Supersedes["reason"], string>> = {
  correction: "Correction",
  withdrawal: "Withdrawal",
};

const REVISION_STATE_LABELS: Readonly<Record<IndexRevision["state"], string>> = {
  current: "Current",
  superseded: "Superseded",
  removed: "Removed",
};

const ms = (value: number): string => `${INTEGER.format(value)} ms`;
const tokens = (value: number): string => `${INTEGER.format(value)} tokens`;

function Timestamp({ value }: { value: string }) {
  return <time dateTime={value}>{value}</time>;
}

function Hash({ value, missing }: { value: string | null; missing: string }) {
  return value === null ? <>{missing}</> : <code>{value}</code>;
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="eval-handoff-notice" role="note">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

function SyntheticNotice({ origin }: { origin: PublicEvalDataOrigin }) {
  if (origin !== "synthetic") return null;
  return (
    <Notice title="Synthetic preview data">
      <p>
        This artifact contains synthetic preview data, not measured evaluation results.
        Do not use these values to assess model or harness performance.
      </p>
    </Notice>
  );
}

function Fields({ children }: { children: ReactNode }) {
  return <dl className="eval-handoff-fields">{children}</dl>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

function Unavailable({ metric }: { metric: MetricUnavailable }) {
  return (
    <>
      {AVAILABILITY_LABELS[metric.availability]}. Reason: {UNAVAILABLE_REASON_LABELS[metric.reason]}.
    </>
  );
}

function ReviewText({ review }: { review: Review }) {
  if (review.status === "synthetic_preview") {
    return <>Synthetic preview, not a recorded manual approval</>;
  }
  return (
    <>
      Manual approval recorded by this artifact: <code>{review.approvedBy}</code> at{" "}
      <Timestamp value={review.approvedAt} />
    </>
  );
}

function ReviewFields({ review }: { review: Review }) {
  return (
    <>
      <Field label="Review">
        <ReviewText review={review} />
      </Field>
      {review.status === "approved" && (
        <>
          <Field label="Reviewed subject SHA-256"><code>{review.subjectSha256}</code></Field>
          <Field label="Review record">{review.record}</Field>
        </>
      )}
    </>
  );
}

function SupersedesField({ supersedes }: { supersedes: PublicEvalPublication["supersedes"] }) {
  if (supersedes === null) {
    return <Field label="Supersedes">None recorded</Field>;
  }
  return (
    <Field label="Supersedes">
      {SUPERSEDES_LABELS[supersedes.reason]} of revision {supersedes.revision} (
      <code>{supersedes.revisionId}</code>): {supersedes.summary}
    </Field>
  );
}

function WithdrawalNotice({ content }: { content: Withdrawal }) {
  return (
    <Notice title="Withdrawn publication">
      <p>
        This revision withdraws the previously published result. Reason:{" "}
        {WITHDRAWAL_REASON_LABELS[content.reason]}. Withdrawn at{" "}
        <Timestamp value={content.withdrawnAt} />.
      </p>
      <p>{content.notice}</p>
      <p>No result is shown for a withdrawn publication.</p>
    </Notice>
  );
}

export function PublicPublicationView({ publication }: { publication: PublicEvalPublication }) {
  const { content } = publication;
  return (
    <div className="eval-handoff-stack">
      {content.kind === "withdrawal_notice" ? <WithdrawalNotice content={content} /> : null}
      <SyntheticNotice origin={publication.dataOrigin} />
      <Panel title="Publication" description="Snapshot metadata recorded by the publisher.">
        <div className="eval-handoff-body">
          <Fields>
            <Field label="Publication">
              <code>{publication.publicationId}</code>
            </Field>
            <Field label="Revision">
              {publication.revision} (<code>{publication.revisionId}</code>)
            </Field>
            <Field label="Run">
              <code>{publication.runId}</code>
            </Field>
            <Field label="Data origin">{ORIGIN_LABELS[publication.dataOrigin]}</Field>
            <Field label="Published at">
              <Timestamp value={publication.publishedAt} />
            </Field>
            <ReviewFields review={publication.review} />
            <SupersedesField supersedes={publication.supersedes} />
            <Field label="Content">
              {content.kind === "result" ? "Result" : "Withdrawal notice"}
            </Field>
            <Field label="Schema">
              <code>{publication.schemaVersion}</code>
            </Field>
          </Fields>
          <p className="eval-muted">
            This page describes one snapshot file. On its own, a local file does not establish
            whether this revision is still current, corrected, or withdrawn; only the publisher's
            index records that lifecycle.
          </p>
        </div>
      </Panel>
      {content.kind === "result" ? <ResultSections result={content.result} /> : null}
    </div>
  );
}

function PassRateFields({ passRate }: { passRate: PublicEvalResult["metrics"]["passRate"] }) {
  if (passRate.availability !== "available") {
    return (
      <Fields>
        <Field label="Pass rate">
          <Unavailable metric={passRate} />
        </Field>
      </Fields>
    );
  }
  return (
    <Fields>
      <Field label="Ratio">{passRate.value}</Field>
      <Field label="Numerator (passed attempts)">{INTEGER.format(passRate.numerator)}</Field>
      <Field label="Denominator (attempts)">{INTEGER.format(passRate.denominator)}</Field>
      <Field label="Unit">{passRate.unit}</Field>
    </Fields>
  );
}

function LatencyFields({ latency }: { latency: PublicEvalResult["metrics"]["latencyMs"] }) {
  if (latency.availability !== "available") {
    return (
      <Fields>
        <Field label="Latency">
          <Unavailable metric={latency} />
        </Field>
      </Fields>
    );
  }
  return (
    <Fields>
      <Field label="p50">{ms(latency.p50)}</Field>
      <Field label="p95">{ms(latency.p95)}</Field>
      <Field label="Max">{ms(latency.max)}</Field>
      <Field label="Sample count">{INTEGER.format(latency.sampleCount)} attempts</Field>
    </Fields>
  );
}

function TokenFields({ usage }: { usage: PublicEvalResult["metrics"]["tokenUsage"] }) {
  if (usage.availability !== "available") {
    return (
      <Fields>
        <Field label="Token usage">
          <Unavailable metric={usage} />
        </Field>
      </Fields>
    );
  }
  return (
    <Fields>
      <Field label="Input">{tokens(usage.inputTokens)}</Field>
      <Field label="Output">{tokens(usage.outputTokens)}</Field>
      <Field label="Total">{tokens(usage.totalTokens)}</Field>
      <Field label="Sample count">
        {INTEGER.format(usage.sampleCount)} attempts with token usage
      </Field>
    </Fields>
  );
}

function ResultSections({ result }: { result: PublicEvalResult }) {
  const synthetic = result.dataOrigin === "synthetic";
  const { benchmark, configuration, counts, coverage, metrics } = result;
  return (
    <>
      <Panel
        title="Result"
        description={
          synthetic
            ? "Synthetic preview values, not measured evaluation results."
            : "Conformance measurements reported by this artifact."
        }
      >
        <div className="eval-handoff-body">
          <Fields>
            <Field label="Result">
              <code>{result.resultId}</code>
            </Field>
            <Field label="Run">
              <code>{result.run.runId}</code>, started at <Timestamp value={result.run.startedAt} />
            </Field>
            <Field label="Measures">
              <code>{result.measures}</code>
            </Field>
            <Field label="Data origin">{ORIGIN_LABELS[result.dataOrigin]}</Field>
            <Field label="Source">
              {result.source.kind === "sanitized_aggregate_with_attempts"
                ? "Sanitized aggregate with retained attempts"
                : "Sanitized aggregate"}
              ; report schema {result.source.reportSchemaVersion}
            </Field>
            <Field label="Report SHA-256">
              <code>{result.source.reportSha256}</code>
            </Field>
            <Field label="Attempt capture SHA-256">
              <Hash
                value={result.source.attemptCaptureSha256}
                missing="Not available in this artifact"
              />
            </Field>
            <Field label="Schema">
              <code>{result.schemaVersion}</code>
            </Field>
          </Fields>
        </div>
      </Panel>

      <div className="eval-handoff-grid">
        <Panel title="Pass rate" description="Exporter ratio, shown as a ratio rather than a score.">
          <div className="eval-handoff-body">
            <PassRateFields passRate={metrics.passRate} />
          </div>
        </Panel>
        <Panel
          title="Coverage and counts"
          description="Attempt counts and unique-case counts are reported separately."
        >
          <div className="eval-handoff-body">
            <Fields>
              <Field label="Coverage status">
                {coverage.status === "complete" ? "Complete" : "Incomplete"}
              </Field>
              <Field label="Plan source">
                {coverage.planSource === "run_manifest" ? "Run manifest" : "Declared plan"}
              </Field>
              <Field label="Planned cases">{INTEGER.format(coverage.plannedCases)}</Field>
              <Field label="Planned attempts">{INTEGER.format(coverage.plannedAttempts)}</Field>
              <Field label="Repetitions per case">{benchmark.repetitions}</Field>
              <Field label="Attempts observed">
                {INTEGER.format(counts.attempts.total)} total · {INTEGER.format(counts.attempts.passed)}{" "}
                passed · {INTEGER.format(counts.attempts.failed)} failed
              </Field>
              <Field label="Unique cases observed">{INTEGER.format(counts.cases.total)}</Field>
              <Field label="Cases passing every attempt">
                {counts.cases.passedEveryAttempt === null
                  ? "Not available"
                  : INTEGER.format(counts.cases.passedEveryAttempt)}
              </Field>
              <Field label="Cases failing any attempt">
                {counts.cases.failedAnyAttempt === null
                  ? "Not available"
                  : INTEGER.format(counts.cases.failedAnyAttempt)}
              </Field>
            </Fields>
            <details>
              <summary>Plan and status hashes</summary>
              <Fields>
                <Field label="Plan SHA-256">
                  <Hash value={coverage.planSha256} missing="Not supplied" />
                </Field>
                <Field label="Status SHA-256">
                  <Hash
                    value={coverage.statusSha256}
                    missing="Not supplied"
                  />
                </Field>
              </Fields>
            </details>
            <p className="eval-muted">
              Missing per-case counts remain unavailable, not zero.
            </p>
          </div>
        </Panel>
      </div>

      <Panel title="Check dimensions" description="Verdict counts per grader check across observed attempts.">
        <div className="eval-handoff-table-scroll">
          <table className="eval-table" aria-label="Check verdict counts per dimension">
            <thead>
              <tr>
                <th scope="col">Check</th>
                <th scope="col">Passed</th>
                <th scope="col">Failed</th>
                <th scope="col">Not applicable</th>
              </tr>
            </thead>
            <tbody>
              {CHECK_NAMES.map((name) => {
                const dimension = result.dimensions[name];
                return (
                  <tr key={name}>
                    <th scope="row">{CHECK_LABELS[name]}</th>
                    <td>{INTEGER.format(dimension.passed)}</td>
                    <td>{INTEGER.format(dimension.failed)}</td>
                    <td>{INTEGER.format(dimension.notApplicable)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="eval-handoff-grid">
        <Panel title="Latency" description="Attempt durations in milliseconds, as exported.">
          <div className="eval-handoff-body">
            <LatencyFields latency={metrics.latencyMs} />
          </div>
        </Panel>
        <Panel title="Token usage" description="Token totals over attempts that reported usage.">
          <div className="eval-handoff-body">
            <TokenFields usage={metrics.tokenUsage} />
          </div>
        </Panel>
      </div>

      <div className="eval-handoff-grid">
        <Panel
          title="Metrics not reported"
          description="Each metric states why it is unavailable; nothing here is estimated."
        >
          <div className="eval-handoff-body">
            <Fields>
              <Field label="Answer accuracy">
                <Unavailable metric={metrics.answerAccuracy} />
              </Field>
              <Field label="USD cost">
                <Unavailable metric={metrics.usdCost} />
              </Field>
              <Field label="Uncertainty">
                <Unavailable metric={metrics.uncertainty} />
              </Field>
            </Fields>
          </div>
        </Panel>
        <Panel
          title="Ranking and evidence"
          description="This result is unranked; the reasons are recorded by the exporter."
        >
          <div className="eval-handoff-body">
            <Fields>
              <Field label="Ranking status">{result.ranking.status}</Field>
              <Field label="Unranked because">
                <ul>
                  {result.ranking.reasons.map((reason) => (
                    <li key={reason}>
                      {UNRANKED_REASON_LABELS[reason]} (<code>{reason}</code>)
                    </li>
                  ))}
                </ul>
              </Field>
              <Field label="Attempt detail evidence">
                {EVIDENCE_LABELS[result.evidence.attemptDetail]} (
                <code>{result.evidence.attemptDetail}</code>)
              </Field>
            </Fields>
          </div>
        </Panel>
      </div>

      <div className="eval-handoff-grid">
        <Panel title="Configuration" description="Candidate configuration provenance, as exported.">
          <div className="eval-handoff-body">
            <Fields>
              <Field label="Availability">
                {configuration.availability === "pinned"
                  ? "Pinned"
                  : "Labels only. Configuration not pinned"}
              </Field>
              <Field label="Pinned SHA-256">
                <Hash
                  value={configuration.pinnedSha256}
                  missing="Not supplied"
                />
              </Field>
              <Field label="Candidate">
                <code>{configuration.candidate}</code>
              </Field>
              <Field label="Model">
                <code>{configuration.model}</code>
              </Field>
              <Field label="Reasoning">
                {configuration.reasoning === null ? (
                  "None recorded"
                ) : (
                  <code>{configuration.reasoning}</code>
                )}
              </Field>
            </Fields>
          </div>
        </Panel>
        <Panel title="Benchmark conditions" description="Suite, fixtures, and run conditions, as exported.">
          <div className="eval-handoff-body">
            <Fields>
              <Field label="Suite">
                <code>{benchmark.suiteId}</code> version {benchmark.suiteVersion}
              </Field>
              <Field label="Fixture version">{benchmark.fixtureVersion}</Field>
              <Field label="Target">
                <code>{benchmark.target}</code>
              </Field>
              <Field label="Account class">
                <code>{benchmark.accountClass}</code>
              </Field>
              <Field label="Clean chat">{benchmark.cleanChat ? "Yes" : "No"}</Field>
              <Field label="Repetitions per case">{benchmark.repetitions}</Field>
            </Fields>
            <details>
              <summary>Catalog hash</summary>
              <Fields>
                <Field label="Catalog SHA-256">
                  <code>{benchmark.catalogSha}</code>
                </Field>
              </Fields>
            </details>
          </div>
        </Panel>
      </div>

      <AttemptsSection result={result} />
    </>
  );
}

function AttemptRow({ attempt }: { attempt: PublicEvalAttemptSummary }) {
  const usage = attempt.tokenUsage;
  return (
    <tr>
      <th scope="row">
        <code>{attempt.caseId}</code>, repetition {attempt.repetition}
        <details>
          <summary>Attempt identity</summary>
          <Fields>
            <Field label="Attempt"><code>{attempt.id}</code></Field>
            <Field label="Run"><code>{attempt.runId}</code></Field>
          </Fields>
        </details>
      </th>
      <td>{attempt.verdict}</td>
      <td>{attempt.validity}</td>
      <td>{attempt.evidenceAvailability}</td>
      <td>
        <details>
          <summary>Checks and failure categories</summary>
          <Fields>
            {CHECK_NAMES.map((name) => (
              <Field key={name} label={CHECK_LABELS[name]}>{attempt.checks[name]}</Field>
            ))}
            <Field label="Approved failure categories">
              {attempt.failureCategories.length === 0 ? "None listed" : attempt.failureCategories.join(", ")}
            </Field>
          </Fields>
        </details>
      </td>
      <td>{ms(attempt.durationMs)}</td>
      <td>
        {usage === null ? (
          "Not available"
        ) : (
          <>
            <div>Input: {tokens(usage.inputTokens)}</div>
            <div>Output: {tokens(usage.outputTokens)}</div>
            <div>Total: {tokens(usage.totalTokens)}</div>
          </>
        )}
      </td>
    </tr>
  );
}

function AttemptsSection({ result }: { result: PublicEvalResult }) {
  const [open, setOpen] = useState(false);
  const { attempts } = result;
  if (attempts === null) {
    return (
      <Panel title="Attempts" description="Per-attempt rows are included only when attempt detail is retained.">
        <p className="eval-handoff-body">
          Attempt detail: {EVIDENCE_LABELS[result.evidence.attemptDetail]}. No per-attempt rows are
          included in this result.
        </p>
      </Panel>
    );
  }
  const total = INTEGER.format(attempts.length);
  return (
    <Panel
      title="Attempts"
      description={`${total} retained attempt rows for run ${result.run.runId}. Failure categories are listed exactly as exported.`}
    >
      <div className="eval-handoff-body">
        <details onToggle={(event) => setOpen(event.currentTarget.open)}>
          <summary>Show {total} attempts</summary>
          {open && (
            <div className="eval-handoff-table-scroll">
              <table className="eval-table" aria-label="Retained attempts">
                <thead>
                  <tr>
                    <th scope="col">Case / repetition</th>
                    <th scope="col">Verdict</th>
                    <th scope="col">Validity</th>
                    <th scope="col">Evidence</th>
                    <th scope="col">Check details</th>
                    <th scope="col">Duration, ms</th>
                    <th scope="col">Token usage</th>
                  </tr>
                </thead>
                <tbody>
                  {attempts.length === 0 ? (
                    <tr>
                      <td colSpan={7}>No attempts retained.</td>
                    </tr>
                  ) : (
                    attempts.map((attempt) => <AttemptRow key={attempt.id} attempt={attempt} />)
                  )}
                </tbody>
              </table>
            </div>
          )}
        </details>
      </div>
    </Panel>
  );
}

function IndexEntryRow({ entry }: { entry: IndexEntry }) {
  const { summary } = entry;
  return (
    <tr>
      <td>
        <code>{entry.publicationId}</code>
      </td>
      <td>
        <code>{entry.runId}</code>
      </td>
      <td>{entry.status === "current" ? "Current" : "Withdrawn"}</td>
      <td>
        <ReviewText review={entry.review} />
        {entry.review.status === "approved" ? (
          <details>
            <summary>Review record</summary>
            <p>Reviewed subject SHA-256: <code>{entry.review.subjectSha256}</code></p>
            <p>{entry.review.record}</p>
          </details>
        ) : null}
      </td>
      <td>
        <code>{entry.currentRevisionId}</code>
      </td>
      <td>{entry.revisions.length}</td>
      <td>
        {entry.status === "withdrawn" || summary === null ? (
          "Not listed"
        ) : (
          <>
            <code>{summary.suiteId}</code> · <code>{summary.candidate}</code> ·{" "}
            <code>{summary.model}</code> · started <Timestamp value={summary.startedAt} />
          </>
        )}
      </td>
    </tr>
  );
}

function RevisionRow({ revision }: { revision: IndexRevision }) {
  return (
    <tr>
      <td>{revision.revision}</td>
      <td>
        <code>{revision.revisionId}</code>
      </td>
      <td>{revision.kind === "result" ? "Result" : "Withdrawal notice"}</td>
      <td>{REVISION_STATE_LABELS[revision.state]}</td>
      <td>
        <Timestamp value={revision.publishedAt} />
      </td>
      <td>{revision.state === "removed" || revision.path === null ? "Removed" : <code>{revision.path}</code>}</td>
      <td>{revision.state === "removed" || revision.sha256 === null ? "Removed" : <code>{revision.sha256}</code>}</td>
    </tr>
  );
}

function RevisionHistory({ entry }: { entry: IndexEntry }) {
  const revisions = entry.revisions.length;
  return (
    <details>
      <summary>
        <code>{entry.publicationId}</code>, {revisions} {revisions === 1 ? "revision" : "revisions"},{" "}
        {entry.status === "current" ? "current" : "withdrawn"}
      </summary>
      <div className="eval-handoff-table-scroll">
        <table className="eval-table" aria-label={`Revisions of ${entry.publicationId}`}>
          <thead>
            <tr>
              <th scope="col">Revision</th>
              <th scope="col">Revision id</th>
              <th scope="col">Kind</th>
              <th scope="col">State</th>
              <th scope="col">Published at</th>
              <th scope="col">Snapshot path</th>
              <th scope="col">SHA-256</th>
            </tr>
          </thead>
          <tbody>
            {entry.revisions.map((revision) => (
              <RevisionRow key={revision.revisionId} revision={revision} />
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export function PublicIndexView({ index }: { index: PublicEvalIndex }) {
  const { publications } = index;
  return (
    <div className="eval-handoff-stack">
      <SyntheticNotice origin={index.dataOrigin} />
      <Panel title="Index" description="Publications and revisions as recorded by the publisher.">
        <div className="eval-handoff-body">
          <Fields>
            <Field label="Generated at">
              <Timestamp value={index.generatedAt} />
            </Field>
            <Field label="Data origin">{ORIGIN_LABELS[index.dataOrigin]}</Field>
            <Field label="Publications listed">{INTEGER.format(publications.length)}</Field>
            <Field label="Schema">
              <code>{index.schemaVersion}</code>
            </Field>
          </Fields>
          <p className="eval-muted">
            This index reflects what the publisher recorded at generation time. On its own, a
            local copy does not establish the current lifecycle of any publication; a newer index
            may record later corrections or withdrawals.
          </p>
        </div>
      </Panel>
      <Panel title="Publications" description="Status, review, and current revision per publication.">
        {publications.length === 0 ? (
          <p className="eval-handoff-body">No publications are listed.</p>
        ) : (
          <div className="eval-handoff-table-scroll">
            <table className="eval-table" aria-label="Indexed publications">
              <thead>
                <tr>
                  <th scope="col">Publication</th>
                  <th scope="col">Run</th>
                  <th scope="col">Status</th>
                  <th scope="col">Review</th>
                  <th scope="col">Current revision</th>
                  <th scope="col">Revisions</th>
                  <th scope="col">Summary</th>
                </tr>
              </thead>
              <tbody>
                {publications.map((entry) => (
                  <IndexEntryRow key={entry.publicationId} entry={entry} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {publications.length > 0 ? (
        <Panel
          title="Revision history"
          description="Corrections and withdrawals per publication. Paths and hashes are listed as text only; this page does not fetch them."
        >
          <div className="eval-handoff-body">
            {publications.map((entry) => (
              <RevisionHistory key={entry.publicationId} entry={entry} />
            ))}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
