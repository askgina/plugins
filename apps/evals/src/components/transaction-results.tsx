import type { LeaderboardModelRow } from "../canonical/selectors";
import {
  plannedTrials,
  transactionRunForRow,
  transactionScore,
  transactionTaskSummaries,
} from "../lib/transaction-results";
import { TRANSACTION_TASKS } from "../lib/transaction-evals";
import { percent } from "./results-ui";

const spotTransactionsHref = (row: LeaderboardModelRow) =>
  `#/tasks?category=Spot&task=${TRANSACTION_TASKS[0]?.id ?? ""}&model=${row.model.id}`;

const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`;
const secondsLabel = (ms: number) => `${Math.round(ms / 1000)}s`;

/** Spot cell sub-line: the Spot transactions score owned by this row. Not part of the Spot score. */
export function TransactionResult({ row }: { row: LeaderboardModelRow }) {
  const run = transactionRunForRow(row);
  if (run === undefined) return null;
  const score = transactionScore(run);
  const passed = run.trials.filter((trial) => trial.passed).length;
  return (
    <a className="results-transactions-line" href={spotTransactionsHref(row)}>
      Transactions {score === null ? "incomplete" : percent(score)} · {passed}/{plannedTrials(run)}{" "}
      passed
    </a>
  );
}

/** Expanded-row detail: per-task outcome of this row's transaction run. */
export function TransactionDetails({ row }: { row: LeaderboardModelRow }) {
  const run = transactionRunForRow(row);
  if (run === undefined) return null;
  const identity = run.trials.every((trial) => trial.identityVerified);
  return (
    <section className="results-transactions" aria-label="Transaction results">
      <h3>Spot transactions</h3>
      <p>
        {run.date} · {run.client} · {run.environment} · {run.repetitions} attempts per task. Not
        included in the Spot score or Overall.{" "}
        {identity
          ? `OMP session records confirm every trial ran on ${run.modelId} at ${run.reasoning} thinking with no fallback.`
          : "Model identity is not confirmed for every trial."}
      </p>
      <div className="results-scroll">
        <table className="eval-table" aria-label="Transaction results by task">
          <thead>
            <tr>
              <th scope="col">Task</th>
              <th scope="col">Passed</th>
              <th scope="col">Avg time</th>
              <th scope="col">Spend per trial</th>
              <th scope="col">Why trials failed</th>
            </tr>
          </thead>
          <tbody>
            {transactionTaskSummaries(run).map((task) => (
              <tr key={task.taskId}>
                <th scope="row">
                  <code>{task.taskId}</code> <span className="eval-muted">{task.tier}</span>
                </th>
                <td>
                  {task.passed}/{task.trials}
                </td>
                <td>{secondsLabel(task.meanDurationMs)}</td>
                <td>{usd(task.meanSpendUsdMicros)}</td>
                <td>
                  {task.failureReasons.length === 0 ? "None" : task.failureReasons.join("; ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <a className="results-score-link" href={spotTransactionsHref(row)}>
        View Spot transaction tasks and trials ↗
      </a>
    </section>
  );
}
