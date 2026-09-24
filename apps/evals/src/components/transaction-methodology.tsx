import { TRANSACTION_CHECKS, TRANSACTION_TASKS, TRANSACTION_TIERS } from "../lib/transaction-evals";

/** Methodology for the transaction (execution) evals. Rendered inside the Methodology page. */
export function TransactionMethodology() {
  return (
    <>
      <p className="method-limits" role="status">
        <strong>Pilot stage.</strong> One model has been run (Grok 4.7, low reasoning) on a
        simulated ledger; see <a href="#/transactions">Transactions</a> for results. These evals are
        separate from the tool-use scores above and never enter the leaderboard.
      </p>

      <ol className="method-steps">
        <li>
          <h3>Start from the goal alone</h3>
          <p>
            The first message is only the user's goal, such as "swap 0.2 ETH to USDC on my Base
            wallet". Accounts, available actions, and the user's spending policy come from read-only
            tools, not from the prompt.
          </p>
        </li>
        <li>
          <h3>Quote, then ask for approval</h3>
          <p>
            The model prices each step and requests approval for the whole route. Its turn ends
            there. A scripted user answers in the next turn: yes, no, or a lower cost cap. There is
            no tool that lets the model approve itself.
          </p>
        </li>
        <li>
          <h3>Execute one step at a time</h3>
          <p>
            Each step is submitted, polled until confirmed, and its balance read back before the
            next one starts. A simulated signer blocks unsafe actions, and a blocked attempt still
            counts against the model.
          </p>
        </li>
        <li>
          <h3>Finish or stop, then report</h3>
          <p>
            The model either reaches the target or declares a stop with a reason. It ends with a
            report of where every balance stands, which the grader compares with the true final
            balances.
          </p>
        </li>
      </ol>

      <h3 className="method-subtitle">Tasks</h3>
      <div className="results-scroll">
        <table className="eval-table method-task-table" aria-label="Transaction eval tasks">
          <thead>
            <tr>
              <th scope="col">Task</th>
              <th scope="col">Tier</th>
              <th scope="col">Prompt</th>
              <th scope="col">User replies</th>
              <th scope="col">Correct outcome</th>
              <th scope="col">What it tests</th>
            </tr>
          </thead>
          <tbody>
            {TRANSACTION_TASKS.map((task) => (
              <tr key={task.id}>
                <th scope="row">
                  <code>{task.id}</code>
                </th>
                <td>{task.tier}</td>
                <td>{task.prompt}</td>
                <td>{task.userReply === "approve" ? "Yes" : "No"}</td>
                <td>
                  <code>{task.expectedOutcome}</code>
                </td>
                <td>{task.tests}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="method-subtitle">Coverage by tier</h3>
      <div className="results-scroll">
        <table className="eval-table" aria-label="Transaction task coverage by tier">
          <thead>
            <tr>
              <th scope="col">Tier</th>
              <th scope="col">What it adds</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {TRANSACTION_TIERS.map((row) => (
              <tr key={row.tier}>
                <th scope="row">{row.tier}</th>
                <td>{row.label}</td>
                <td>{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="method-subtitle">How a trial is graded</h3>
      <p>A trial passes only if every check passes. Infrastructure failures are not graded.</p>
      <div className="results-scroll">
        <table className="eval-table" aria-label="Transaction eval hard checks">
          <thead>
            <tr>
              <th scope="col">Check</th>
              <th scope="col">Fails when</th>
            </tr>
          </thead>
          <tbody>
            {TRANSACTION_CHECKS.map((check) => (
              <tr key={check.name}>
                <th scope="row">{check.name}</th>
                <td>{check.fails}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="method-reference">
        <details className="results-accordion">
          <summary>Not built yet</summary>
          <div>
            <ul>
              <li>Running real models through the harness (multi-turn OMP sessions).</li>
              <li>
                Simulated chains and the real signer. Blocked on whether Gina's execute tools return
                unsigned transactions or sign on the server.
              </li>
              <li>The prepare, approve, execute flow in production Gina.</li>
              <li>The route solver needed to score cross-network and consolidation tasks.</li>
            </ul>
            <p>
              Harness source: <code>packages/evals/src/execution</code>. Design notes:{" "}
              <code>ai_docs/execution-evals-flow.md</code>.
            </p>
          </div>
        </details>
      </div>
    </>
  );
}
