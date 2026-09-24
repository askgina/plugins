import { PageShell } from "../components/eval-ui";
import { ResultsHeader } from "../components/results-ui";
import { TRANSACTION_TASKS } from "../lib/transaction-evals";

/** Results for the transaction (execution) evals. None have been run yet. */
export function TransactionsPage() {
  return (
    <PageShell
      active="transactions"
      footerNote="Transaction evals have no model results yet. Nothing here is a score."
    >
      <div className="eval-container results-page">
        <ResultsHeader
          title="Transaction evals"
          description="Results for models moving funds: planning a route, getting approval, and executing it step by step."
        />
        <div className="method-content">
          <p className="method-limits" role="status">
            <strong>No transaction evals have been run yet.</strong> 0 models, 0 runs, no scores.{" "}
            {TRANSACTION_TASKS.length} tasks are defined and ready. Results will appear here once
            models are run. They are separate from the leaderboard.
          </p>
          <p>
            <a href="#/methodology?section=transactions">How transaction evals work ↗</a>
          </p>
        </div>
      </div>
    </PageShell>
  );
}
