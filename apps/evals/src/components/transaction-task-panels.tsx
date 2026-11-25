import { ArrowLeft, ArrowRight, ChevronRight } from "lucide-react";
import { useRef, useState } from "react";
import type { LeaderboardModelRow } from "../canonical/selectors";
import type { TransactionTask } from "../lib/transaction-evals";
import { TRANSACTION_CHECK_LABEL, TRANSACTION_RUNS } from "../lib/transaction-results";
import type { TaskSelection, TaskView } from "../lib/task-workspace";
import { ConversationPanel } from "./conversation-panel";
import { ModelAvatar } from "./eval-ui";
import { TaskEvidenceTabs } from "./task-evidence-tabs";

const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`;
const secondsLabel = (ms: number) => `${Math.round(ms / 1000)}s`;

/**
 * Models and inspector panes for a Spot transaction task, with the same attempt picker and
 * Conversation / Checks / Run details views as the other tasks. Each model owns its transaction
 * run; models without one show "Not run". Transaction trials never change the Spot score.
 */
export function TransactionTaskPanels({
  task,
  rows,
  selectedModelId,
  attempt,
  view,
  onMove,
}: {
  readonly task: TransactionTask;
  readonly rows: readonly LeaderboardModelRow[];
  readonly selectedModelId: string | undefined;
  readonly attempt: number | undefined;
  readonly view: TaskView;
  readonly onMove: (next: Partial<TaskSelection>) => void;
}) {
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const modelSelect = useRef<HTMLSelectElement>(null);
  function chooseModel(modelId: string) {
    onMove({ modelId, attempt: undefined });
    setComparisonOpen(false);
    modelSelect.current?.focus();
  }
  const withRun = rows.map((row) => ({
    row,
    run: TRANSACTION_RUNS.find((run) => run.canonicalModelId === row.model.id),
  }));
  const ordered = [
    ...withRun.filter((entry) => entry.run),
    ...withRun.filter((entry) => !entry.run),
  ];
  const selected = ordered.find((entry) => entry.row.model.id === selectedModelId) ?? ordered[0];
  const run = selected?.run;
  const trials = (run?.trials.filter((trial) => trial.taskId === task.id) ?? []).sort(
    (a, b) => a.repetition - b.repetition,
  );
  const index = Math.max(
    0,
    trials.findIndex((trial) => trial.repetition === attempt),
  );
  const trial = trials[index];
  const failed = new Map(trial?.failedChecks.map((check) => [check.id, check.detail]));
  return (
    <>
      <details
        className="task-model-comparison"
        open={comparisonOpen}
        onToggle={(event) => setComparisonOpen(event.currentTarget.open)}
      >
        <summary>
          Compare model results <small>{rows.length} models</small>
        </summary>
        <section className="task-workspace-models" aria-labelledby="workspace-models-heading">
          <div className="task-workspace-model-tools">
            <div className="task-workspace-heading results-sr-only">
              <h2 id="workspace-models-heading">Models</h2>
              <span>{rows.length} models</span>
            </div>
          </div>
          <div className="task-workspace-model-list" role="group" aria-label="Model results">
            {ordered.map(({ row, run }) => {
              const own = run?.trials.filter((trial) => trial.taskId === task.id) ?? [];
              return (
                <button
                  key={row.model.id}
                  type="button"
                  className="task-workspace-model"
                  aria-label={`View ${row.model.name} results`}
                  aria-pressed={selected?.row.model.id === row.model.id}
                  onClick={() => chooseModel(row.model.id)}
                >
                  <ModelAvatar model={row.model} />
                  <span className="task-workspace-model-name">
                    <strong>{row.model.name}</strong>
                    <small>{run ? `${run.reasoning} reasoning` : "No transaction run"}</small>
                  </span>
                  <span className="task-workspace-outcome">
                    <small>
                      {run
                        ? `${own.filter((trial) => trial.passed).length}/${own.length} passed`
                        : "Not run"}
                    </small>
                  </span>
                  <ChevronRight size={15} aria-hidden="true" />
                </button>
              );
            })}
          </div>
          <p className="task-workspace-hint">
            Spot transactions: scored separately, not part of the Spot score.
          </p>
        </section>
      </details>
      <section className="task-workspace-inspector" aria-labelledby="workspace-model-heading">
        <div className="task-workspace-inspector-header">
          <div className="task-workspace-model-heading">
            <h3 id="workspace-model-heading" className="results-sr-only">
              {selected?.row.model.name ?? "No model selected"} attempt evidence
            </h3>
            <div className="task-model-picker">
              {selected && <ModelAvatar model={selected.row.model} />}
              <label className="task-workspace-model-select">
                <span>Model</span>
                <select
                  aria-label="Selected model"
                  ref={modelSelect}
                  value={selected?.row.model.id ?? ""}
                  onChange={(event) => chooseModel(event.target.value)}
                >
                  {ordered.map(({ row, run }) => (
                    <option key={row.model.id} value={row.model.id}>
                      {row.model.name}
                      {run ? ` (${run.reasoning} reasoning)` : " (not run)"}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {run && (
              <p className="task-transaction-setting">
                {run.reasoning} reasoning · {run.date}
              </p>
            )}
          </div>
          {trials.length > 0 && (
            <div className="task-attempts" role="group" aria-label="Attempts">
              {trials.map((entry) => (
                <button
                  key={entry.repetition}
                  type="button"
                  className={`task-attempt ${entry.passed ? "task-attempt-pass" : ""}`}
                  aria-pressed={entry === trial}
                  onClick={() => onMove({ attempt: entry.repetition })}
                >
                  <span>Attempt {entry.repetition}</span>
                  <strong>{entry.passed ? "Passed" : "Failed"}</strong>
                </button>
              ))}
            </div>
          )}
          {trial && (
            <p className="task-workspace-attempt-meta">
              {secondsLabel(trial.durationMs)} · {usd(trial.spendUsdMicros)} spent
            </p>
          )}
          <TaskEvidenceTabs view={view} onSelect={(next) => onMove({ view: next })} />
        </div>
        <div
          id="task-evidence-panel"
          className="task-workspace-evidence"
          role="tabpanel"
          aria-labelledby={`task-tab-${view}`}
          tabIndex={0}
        >
          {run === undefined ? (
            <p role="status">No transaction run is recorded for this model yet.</p>
          ) : view === "run" ? (
            <dl className="results-facts">
              <div>
                <dt>Run identifier</dt>
                <dd>
                  <code>{run.runId}</code> · {run.date}
                </dd>
              </div>
              <div>
                <dt>Setting</dt>
                <dd>
                  {run.modelId} · {run.reasoning} reasoning · {run.client}
                </dd>
              </div>
              <div>
                <dt>Environment</dt>
                <dd>{run.environment}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>
                  <code>{run.conversations.sourceCommit}</code>
                </dd>
              </div>
              {trial && (
                <>
                  <div>
                    <dt>Attempt {trial.repetition}</dt>
                    <dd>
                      {secondsLabel(trial.durationMs)} · {usd(trial.spendUsdMicros)} spent ·{" "}
                      {trial.submits} {trial.submits === 1 ? "transaction" : "transactions"}{" "}
                      submitted
                    </dd>
                  </div>
                  <div>
                    <dt>Model identity</dt>
                    <dd>
                      {trial.identityVerified ? "Verified from the native session" : "Unverified"}
                    </dd>
                  </div>
                </>
              )}
            </dl>
          ) : !trial ? (
            <p>No attempts are recorded for this task.</p>
          ) : view === "checks" ? (
            <div className="results-scroll">
              <table className="eval-table" aria-label={`Attempt ${trial.repetition} checks`}>
                <thead>
                  <tr>
                    <th scope="col">Failure check</th>
                    <th scope="col">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(TRANSACTION_CHECK_LABEL).map(([id, label]) => (
                    <tr key={id}>
                      <th scope="row">{label}</th>
                      <td>{failed.has(id) ? `Failed: ${failed.get(id)}` : "Passed"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <ConversationPanel
              key={`${run.runId}-${task.id}-${trial.repetition}`}
              reference={{
                ...run.conversations,
                family: "spot",
                caseId: task.id,
                repetition: trial.repetition,
              }}
              model={selected?.row.model}
              compact
              inline
            />
          )}
        </div>
        {trials.length > 0 && (
          <div className="task-workspace-attempt-navigation">
            <button
              type="button"
              disabled={index === 0}
              onClick={() => onMove({ attempt: trials[index - 1]!.repetition })}
            >
              <ArrowLeft size={14} aria-hidden="true" />
              Previous attempt
            </button>
            <button
              type="button"
              disabled={index >= trials.length - 1}
              onClick={() => onMove({ attempt: trials[index + 1]!.repetition })}
            >
              Next attempt
              <ArrowRight size={14} aria-hidden="true" />
            </button>
          </div>
        )}
      </section>
    </>
  );
}
