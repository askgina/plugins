import type { CanonicalCaseDefinition, PrototypeFamily } from "../canonical/canonical";
import { EvidenceValue } from "../canonical/components";
import type { TransactionTask } from "../lib/transaction-evals";
import { TaskCriteria } from "./task-evidence";

/** Keep the selected task's purpose visible before model and attempt controls. */
export function TaskBrief({
  family,
  title,
  definition,
  transaction,
}: {
  family: PrototypeFamily;
  title: string;
  definition?: CanonicalCaseDefinition;
  transaction?: TransactionTask;
}) {
  const prompt = transaction ? (
    <p>{transaction.prompt}</p>
  ) : definition ? (
    <EvidenceValue evidence={definition.prompt} renderValue={(value) => <p>{value}</p>} />
  ) : null;
  return (
    <header className="task-brief">
      <p className="task-brief-category">
        {family} · {transaction ? "Transaction execution" : "Tool use"}
      </p>
      <h2>{title}</h2>
      <details className="task-brief-details" key={transaction?.id ?? definition?.caseId}>
        <summary>
          <div className="task-brief-preview">{prompt}</div>
          <span className="task-brief-toggle">Prompt &amp; grading criteria</span>
        </summary>
        <div className="task-brief-full">
          {prompt}
          {definition && <TaskCriteria definition={definition} inline />}
          {transaction && (
            <p>
              Scripted user replies{" "}
              <strong>{transaction.userReply === "approve" ? "yes" : "no"}</strong>. Correct
              outcome: <code>{transaction.expectedOutcome}</code>. {transaction.tests}{" "}
              <a href="#/methodology?section=transactions">Transaction grading ↗</a>
            </p>
          )}
        </div>
      </details>
      {transaction && (
        <p className="task-brief-scope">Scored separately from Spot tool use and Overall.</p>
      )}
    </header>
  );
}
