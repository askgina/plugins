import { ChevronRight } from "lucide-react";
import type { LeaderboardModelRow } from "../canonical/selectors";
import type { TransactionTask } from "../lib/transaction-evals";
import { TRANSACTION_CHECK_LABEL, TRANSACTION_RUNS } from "../lib/transaction-results";
import { ModelAvatar } from "./eval-ui";

const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`;
const secondsLabel = (ms: number) => `${Math.round(ms / 1000)}s`;

/**
 * Models and inspector panes for a Spot transaction task. Each model owns its transaction run;
 * models without one show "Not run". Transaction trials never change the Spot score.
 */
export function TransactionTaskPanels({
  task,
  rows,
  selectedModelId,
  onSelectModel,
}: {
  readonly task: TransactionTask;
  readonly rows: readonly LeaderboardModelRow[];
  readonly selectedModelId: string | undefined;
  readonly onSelectModel: (modelId: string) => void;
}) {
  const withRun = rows.map((row) => ({
    row,
    run: TRANSACTION_RUNS.find((run) => run.canonicalModelId === row.model.id),
  }));
  const ordered = [
    ...withRun.filter((entry) => entry.run),
    ...withRun.filter((entry) => !entry.run),
  ];
  const selected = ordered.find((entry) => entry.row.model.id === selectedModelId) ?? ordered[0];
  const trials = selected?.run?.trials.filter((trial) => trial.taskId === task.id) ?? [];
  return (
    <>
      <section className="task-workspace-models" aria-labelledby="workspace-models-heading">
        <label className="task-workspace-model-select">
          <span className="results-sr-only">Selected model</span>
          <select
            value={selected?.row.model.id ?? ""}
            onChange={(event) => onSelectModel(event.target.value)}
          >
            {ordered.map(({ row, run }) => (
              <option key={row.model.id} value={row.model.id}>
                {row.model.name}
                {run ? ` (${run.reasoning} reasoning)` : " (not run)"}
              </option>
            ))}
          </select>
        </label>
        <div className="task-workspace-model-tools">
          <div className="task-workspace-heading">
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
                onClick={() => onSelectModel(row.model.id)}
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
      <section className="task-workspace-inspector" aria-labelledby="workspace-model-heading">
        <div className="task-workspace-inspector-header">
          <h2 id="workspace-model-heading">{selected?.row.model.name ?? "No model selected"}</h2>
        </div>
        <div className="task-workspace-evidence">
          <details className="task-workspace-prompt" open>
            <summary>{task.name} · Prompt &amp; criteria</summary>
            <p>{task.prompt}</p>
            <p>
              Scripted user replies <strong>{task.userReply === "approve" ? "yes" : "no"}</strong>.
              Correct outcome: <code>{task.expectedOutcome}</code>. {task.tests}
            </p>
            <p>
              <a href="#/methodology?section=transactions">How transaction evals are graded ↗</a>
            </p>
          </details>
          {selected?.run === undefined ? (
            <p role="status">No transaction run is recorded for this model yet.</p>
          ) : (
            <>
              <p>
                {selected.run.date} · {selected.run.reasoning} reasoning · {selected.run.client} ·{" "}
                {selected.run.environment}.
              </p>
              <div className="results-scroll">
                <table
                  className="eval-table transaction-attempts"
                  aria-label={`${selected.row.model.name} attempts`}
                >
                  <thead>
                    <tr>
                      <th scope="col">Attempt</th>
                      <th scope="col">Result</th>
                      <th scope="col">Time</th>
                      <th scope="col">Spend</th>
                      <th scope="col">Failed check</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trials.map((trial) => (
                      <tr key={trial.repetition}>
                        <th scope="row">{trial.repetition}</th>
                        <td>{trial.passed ? "Passed" : "Failed"}</td>
                        <td>{secondsLabel(trial.durationMs)}</td>
                        <td>{usd(trial.spendUsdMicros)}</td>
                        <td>
                          {trial.failedChecks.length === 0
                            ? "None"
                            : trial.failedChecks
                                .map(
                                  (check) =>
                                    `${TRANSACTION_CHECK_LABEL[check.id] ?? check.id}: ${check.detail}`,
                                )
                                .join("; ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </section>
    </>
  );
}
