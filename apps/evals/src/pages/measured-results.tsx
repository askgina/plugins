import type { ReactNode } from "react";
import { PageShell, Panel } from "../components/eval-ui";
import { perpsPredictionsReport, spotComparison } from "../results";
import "../styles/handoff.css";

const INTEGER = new Intl.NumberFormat("en-US");

function number(value: number) {
  return INTEGER.format(value);
}

function milliseconds(value: number) {
  return `${number(value)} ms`;
}

function Timestamp({ value }: { value: string }) {
  return <time dateTime={value}>{value}</time>;
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

function DimensionTable({
  dimensions,
}: {
  dimensions: {
    routing: { passed: number; failed: number };
    arguments: { passed: number; failed: number };
    completion: { passed: number; failed: number };
    safety: { passed: number; failed: number };
  };
}) {
  return (
    <div className="eval-handoff-table-scroll">
      <table className="eval-table">
        <thead>
          <tr>
            <th scope="col">Dimension</th>
            <th scope="col">Passed</th>
            <th scope="col">Failed</th>
          </tr>
        </thead>
        <tbody>
          {(["routing", "arguments", "completion", "safety"] as const).map((name) => (
            <tr key={name}>
              <th scope="row">{name}</th>
              <td>{number(dimensions[name].passed)}</td>
              <td>{number(dimensions[name].failed)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SpotComparisonTable() {
  const runs = spotComparison.runs;
  const rows: readonly [string, (run: (typeof runs)[number]) => ReactNode][] = [
    ["Model", (run) => <code>{run.report.model}</code>],
    ["Run id", (run) => <code>{run.report.runId}</code>],
    ["Started at", (run) => <Timestamp value={run.report.startedAt} />],
    [
      "Passed / total",
      (run) =>
        `${number(run.report.aggregate.overall.passed)} / ${number(run.report.aggregate.overall.total)}`,
    ],
    [
      "Routing passed · failed",
      (run) =>
        `${number(run.report.aggregate.dimensions.routing.passed)} · ${number(run.report.aggregate.dimensions.routing.failed)}`,
    ],
    [
      "Arguments passed · failed",
      (run) =>
        `${number(run.report.aggregate.dimensions.arguments.passed)} · ${number(run.report.aggregate.dimensions.arguments.failed)}`,
    ],
    [
      "Completion passed · failed",
      (run) =>
        `${number(run.report.aggregate.dimensions.completion.passed)} · ${number(run.report.aggregate.dimensions.completion.failed)}`,
    ],
    [
      "Safety passed · failed",
      (run) =>
        `${number(run.report.aggregate.dimensions.safety.passed)} · ${number(run.report.aggregate.dimensions.safety.failed)}`,
    ],
    [
      "Latency p50 · p95 · max",
      (run) =>
        `${milliseconds(run.report.aggregate.latencyMs.p50)} · ${milliseconds(run.report.aggregate.latencyMs.p95)} · ${milliseconds(run.report.aggregate.latencyMs.max)}`,
    ],
    [
      "Tokens input · output · total",
      (run) =>
        `${number(run.report.aggregate.tokenUsage.inputTokens)} · ${number(run.report.aggregate.tokenUsage.outputTokens)} · ${number(run.report.aggregate.tokenUsage.totalTokens)}`,
    ],
    ["Token observations", (run) => number(run.report.aggregate.tokenUsage.observations)],
  ];
  return (
    <div className="eval-handoff-table-scroll">
      <table className="eval-table">
        <thead>
          <tr>
            <th scope="col">Metric</th>
            {runs.map((run) => (
              <th scope="col" key={run.report.runId}>
                {run.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, render]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              {runs.map((run) => (
                <td key={run.report.runId}>{render(run)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SpotAttemptMatrix() {
  const runs = spotComparison.runs;
  const caseIds = Array.from(
    new Set(runs.flatMap((run) => run.attempts.attempts.map((attempt) => attempt.caseId))),
  );
  return (
    <div className="eval-handoff-table-scroll">
      <table className="eval-table">
        <thead>
          <tr>
            <th scope="col">Case id</th>
            {runs.flatMap((run) =>
              [1, 2, 3].map((repetition) => (
                <th scope="col" key={`${run.report.runId}-${repetition}`}>
                  {run.label} · R{repetition}
                </th>
              )),
            )}
          </tr>
        </thead>
        <tbody>
          {caseIds.map((caseId) => (
            <tr key={caseId}>
              <th scope="row">
                <code>{caseId}</code>
              </th>
              {runs.flatMap((run) =>
                [1, 2, 3].map((repetition) => {
                  const attempt = run.attempts.attempts.find(
                    (candidate) =>
                      candidate.caseId === caseId && candidate.repetition === repetition,
                  );
                  return (
                    <td key={`${run.report.runId}-${caseId}-${repetition}`}>
                      {attempt ? (
                        <>
                          {attempt.verdict}
                          {attempt.failureCategories.length > 0 && (
                            <small>{attempt.failureCategories.join(", ")}</small>
                          )}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  );
                }),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SpotDetails() {
  return (
    <>
      <Panel title="Spot comparison — GPT-5.5 vs GPT-5.6-sol">
        <SpotComparisonTable />
      </Panel>
      <Panel
        title="Spot attempt matrix"
        description="Verdicts and exported failure categories by case and repetition."
      >
        <SpotAttemptMatrix />
      </Panel>
      <Panel title="Case prompts">
        <div className="eval-handoff-body">
          <Fields>
            {Object.entries(spotComparison.casePrompts).map(([caseId, prompt]) => (
              <Field key={caseId} label={caseId}>
                {prompt}
              </Field>
            ))}
          </Fields>
        </div>
      </Panel>
      <Panel title="Comparison notes">
        <div className="eval-handoff-body">
          <details>
            <summary>Scoring and artifact notes</summary>
            <h3>Scoring notes</h3>
            <ul>
              {spotComparison.scoringNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
            <h3>Artifact notes</h3>
            <ul>
              {spotComparison.artifactNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </details>
        </div>
      </Panel>
    </>
  );
}

function PerpsRunPanel({ run }: { run: (typeof perpsPredictionsReport.runs)[number] }) {
  return (
    <Panel
      title={`${run.family[0]?.toUpperCase() ?? ""}${run.family.slice(1)} · ${run.runId}`}
      description="Conformance counts and diagnostics reported by the harness."
    >
      <div className="eval-handoff-body">
        <Fields>
          <Field label="Run id">
            <code>{run.runId}</code>
          </Field>
          <Field label="Planned">{number(run.planned)}</Field>
          <Field label="Dispatched">{number(run.dispatched)}</Field>
          <Field label="Graded">{number(run.graded)}</Field>
          <Field label="Passed">{number(run.passed)}</Field>
          <Field label="Failed">{number(run.failed)}</Field>
          <Field label="Unscored timeouts">{number(run.unscoredTimeouts)}</Field>
          <Field label="Latency">
            p50 {milliseconds(run.latencyMs.p50)} · p95 {milliseconds(run.latencyMs.p95)} · max{" "}
            {milliseconds(run.latencyMs.max)}
          </Field>
          <Field label="Token usage">
            {number(run.tokenUsage.input)} input · {number(run.tokenUsage.output)} output ·{" "}
            {number(run.tokenUsage.total)} total ({number(run.tokenUsage.observations)}{" "}
            observations)
          </Field>
          <Field label="Within 30 seconds">{number(run.within30s)}</Field>
          <Field label="Argument-constrained trials">{number(run.argumentConstrainedTrials)}</Field>
          <Field label="Skill observed count">{number(run.skillObservedCount)}</Field>
        </Fields>
        <h3>Dimensions</h3>
        <DimensionTable dimensions={run.dimensions} />
        <h3>Cases</h3>
        <div className="eval-handoff-table-scroll">
          <table className="eval-table">
            <thead>
              <tr>
                <th scope="col">Case id</th>
                <th scope="col">Results</th>
                <th scope="col">Passed / graded</th>
                <th scope="col">Notes</th>
              </tr>
            </thead>
            <tbody>
              {run.cases.map((entry) => (
                <tr key={entry.id}>
                  <th scope="row">
                    <code>{entry.id}</code>
                  </th>
                  <td>{entry.results.join(" · ")}</td>
                  <td>
                    {number(entry.passed)} / {number(entry.graded)}
                  </td>
                  <td>{entry.notes || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Panel>
  );
}

function AbortedRunPanel() {
  const run = perpsPredictionsReport.abortedRun;
  return (
    <Panel title="Aborted original predictions run">
      <div className="eval-handoff-body">
        <Fields>
          <Field label="Run id">
            <code>{run.runId}</code>
          </Field>
          <Field label="Planned">{number(run.planned)}</Field>
          <Field label="Dispatched">{number(run.dispatched)}</Field>
          <Field label="Completed">{number(run.completed)}</Field>
          <Field label="Failed">{number(run.failed)}</Field>
          <Field label="Timeouts">{number(run.timeouts)}</Field>
          <Field label="Graded">{number(run.graded)}</Field>
          <Field label="Note">{run.note}</Field>
        </Fields>
      </div>
    </Panel>
  );
}

function PerpsPredictionsDetails() {
  return (
    <>
      <section>
        <h2>Perps and Predictions — GPT-5.6-sol</h2>
        <div className="eval-handoff-stack">
          {perpsPredictionsReport.runs.map((run) => (
            <PerpsRunPanel key={run.runId} run={run} />
          ))}
          <AbortedRunPanel />
          <Panel title="Limitations">
            <div className="eval-handoff-body">
              <ul>
                {perpsPredictionsReport.limitations.map((limitation) => (
                  <li key={limitation}>{limitation}</li>
                ))}
              </ul>
            </div>
          </Panel>
        </div>
      </section>
    </>
  );
}

export function MeasuredResultsPage() {
  return (
    <PageShell active="results">
      <div className="eval-container eval-handoff">
        <section className="eval-hero">
          <p className="eval-eyebrow">Measured results · {perpsPredictionsReport.date}</p>
          <h1 className="eval-title">
            Measured, not illustrative<span className="eval-dot">.</span>
          </h1>
          <p className="eval-description">
            These are conformance runs of the OMP harness with native OpenAI OAuth (Gina{" "}
            <code>tools:read</code>), three repetitions per case. They are unranked, small live
            samples.
          </p>
          <p className="eval-description">
            <a
              className="eval-text-link"
              href={perpsPredictionsReport.prUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open GitHub PR #85
            </a>{" "}
            · source <code>{perpsPredictionsReport.sourceCommit}</code> · executable source{" "}
            <code>{perpsPredictionsReport.executableSourceCommit}</code>
          </p>
        </section>
        <div className="eval-handoff-stack">
          <div className="eval-handoff-notice" role="note">
            <strong>These runs are unranked.</strong> They are small samples of conformance, not
            answer accuracy. Safety N/A means the dimension was not scored.
          </div>
          <section>
            <h2>Spot comparison — GPT-5.5 vs GPT-5.6-sol</h2>
            <div className="eval-handoff-stack">
              <SpotDetails />
            </div>
          </section>
          <PerpsPredictionsDetails />
        </div>
      </div>
    </PageShell>
  );
}
