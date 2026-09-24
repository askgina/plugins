import { PageShell } from "../components/eval-ui";
import { ResultsHeader } from "../components/results-ui";
import { TRANSACTION_TASKS } from "../lib/transaction-evals";
import grok47Low from "../results/2026-09-24/execution/grok-4.7-low.json";

interface TransactionTrial {
  readonly taskId: string;
  readonly repetition: number;
  readonly passed: boolean;
  readonly failedChecks: readonly { readonly id: string; readonly detail: string }[];
  readonly durationMs: number;
  readonly spendUsdMicros: number;
  readonly identityVerified: boolean;
}

interface TransactionRun {
  readonly runId: string;
  readonly date: string;
  readonly model: string;
  readonly modelId: string;
  readonly reasoning: string;
  readonly client: string;
  readonly environment: string;
  readonly sourceCommit: string;
  readonly repetitions: number;
  readonly trials: readonly TransactionTrial[];
}

const RUNS: readonly TransactionRun[] = [grok47Low];

const CHECK_LABEL: Readonly<Record<string, string>> = {
  outcome_matches: "Wrong outcome",
  fsm_submit_requires_approval: "Executed without approval",
  fsm_no_submit_after_reject: "Executed after refusal",
  fsm_quote_fresh: "Stale quote",
  fsm_no_resubmit_while_pending: "Resubmitted while pending",
  fsm_verify_after_receipt_and_readback: "Next step before verifying the previous one",
  fsm_cost_within_approval: "Spent above approval",
  fsm_single_retry_per_leg: "Too many retries",
  limits_respected: "Outside policy",
  report_matches_balances: "Dishonest report",
  no_stranded_funds: "Stranded funds",
  no_refused_actions: "Blocked action",
};

const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`;
const seconds = (ms: number) => `${Math.round(ms / 1000)}s`;
const mean = (values: readonly number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

/** Results for the transaction (execution) evals. Separate from the leaderboard. */
export function TransactionsPage() {
  return (
    <PageShell
      active="transactions"
      footerNote="Transaction evals use a simulated ledger and a scripted user. They are not part of the leaderboard."
    >
      <div className="eval-container results-page">
        <ResultsHeader
          title="Transaction evals"
          description="Results for models moving funds: planning a route, getting approval, and executing it step by step."
        />
        <div className="method-content">
          <p className="method-limits" role="status">
            <strong>
              {RUNS.length} run · {RUNS.reduce((sum, run) => sum + run.trials.length, 0)} trials ·{" "}
              {TRANSACTION_TASKS.length} tasks.
            </strong>{" "}
            Pilot results on a simulated ledger, not live chains. A trial passes only if every check
            passes. <a href="#/methodology?section=transactions">How transaction evals work ↗</a>
          </p>

          {RUNS.map((run) => {
            const passed = run.trials.filter((trial) => trial.passed).length;
            return (
              <section
                className="method-part"
                key={run.runId}
                aria-labelledby={`${run.runId}-title`}
              >
                <h2 id={`${run.runId}-title`} className="method-part-title">
                  {run.model} · {run.reasoning} reasoning
                </h2>
                <p>
                  <strong>
                    {passed}/{run.trials.length} trials passed
                  </strong>{" "}
                  ({run.repetitions} attempts per task). {run.date} · {run.client} ·{" "}
                  {run.environment}.
                  {run.trials.every((trial) => trial.identityVerified)
                    ? " OMP session records confirm every trial ran on "
                    : " Model identity not confirmed for every trial; "}
                  <code>{run.modelId}</code> at {run.reasoning} thinking with no fallback.
                </p>

                <h3 className="method-subtitle">By task</h3>
                <div className="results-scroll">
                  <table
                    className="eval-table method-task-table"
                    aria-label={`${run.model} results by task`}
                  >
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
                      {TRANSACTION_TASKS.map((task) => {
                        const trials = run.trials.filter((trial) => trial.taskId === task.id);
                        if (trials.length === 0) return null;
                        const reasons = [
                          ...new Set(
                            trials.flatMap((trial) =>
                              trial.failedChecks.map((check) => CHECK_LABEL[check.id] ?? check.id),
                            ),
                          ),
                        ];
                        return (
                          <tr key={task.id}>
                            <th scope="row">
                              <code>{task.id}</code>
                              <br />
                              <span className="eval-muted">{task.tier}</span>
                            </th>
                            <td>
                              {trials.filter((trial) => trial.passed).length}/{trials.length}
                            </td>
                            <td>{seconds(mean(trials.map((trial) => trial.durationMs)))}</td>
                            <td>{usd(mean(trials.map((trial) => trial.spendUsdMicros)))}</td>
                            <td>{reasons.length === 0 ? "None" : reasons.join("; ")}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="method-reference">
                  <details className="results-accordion">
                    <summary>Every trial</summary>
                    <div className="results-scroll">
                      <table className="eval-table" aria-label={`${run.model} individual trials`}>
                        <thead>
                          <tr>
                            <th scope="col">Task</th>
                            <th scope="col">Attempt</th>
                            <th scope="col">Result</th>
                            <th scope="col">Time</th>
                            <th scope="col">Spend</th>
                            <th scope="col">Failed check</th>
                          </tr>
                        </thead>
                        <tbody>
                          {run.trials.map((trial) => (
                            <tr key={`${trial.taskId}-${trial.repetition}`}>
                              <th scope="row">
                                <code>{trial.taskId}</code>
                              </th>
                              <td>{trial.repetition}</td>
                              <td>{trial.passed ? "Pass" : "Fail"}</td>
                              <td>{seconds(trial.durationMs)}</td>
                              <td>{usd(trial.spendUsdMicros)}</td>
                              <td>
                                {trial.failedChecks.length === 0
                                  ? "None"
                                  : trial.failedChecks.map((check) => check.detail).join("; ")}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p>
                      Source commit <code>{run.sourceCommit}</code>. Raw trials and identity
                      evidence are retained internally.
                    </p>
                  </details>
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </PageShell>
  );
}
