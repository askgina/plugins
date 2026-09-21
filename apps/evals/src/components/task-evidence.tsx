import {
  CHECK_NAMES,
  type CanonicalAttempt,
  type CanonicalCaseDefinition,
  type CanonicalRun,
} from "../canonical/canonical";
import { CheckMark, EvidenceValue } from "../canonical/components";
import { RunDetails, seconds } from "./results-ui";
import { attemptLabel } from "../lib/task-workspace";
import { runDisplayLabel } from "../canonical/selectors";

const checkNames = {
  routing: "Tool selection",
  arguments: "Arguments",
  safety: "Restrictions",
  completion: "Completion",
  skillActivation: "Skill activation",
};

export function AttemptChecks({ attempt }: { attempt: CanonicalAttempt }) {
  return (
    <div className="task-attempt-details">
      <h4>
        Attempt {attempt.repetition}: {attemptLabel(attempt)}
      </h4>
      {attempt.gradingRevision && (
        <p>
          {attempt.gradingRevision.kind === "provider_error"
            ? "Corrected execution status: the provider rejected this request before a valid answer. This attempt is ungraded."
            : attempt.gradingRevision.kind === "perps_price"
              ? `Regraded under the price-evidence rule. Original verdict: ${attempt.gradingRevision.previousVerdict}; original tool selection: ${attempt.gradingRevision.previousChecks.routing}; original arguments: ${attempt.gradingRevision.previousChecks.arguments}. Restrictions, completion and skill checks are unchanged.`
              : `Regraded under the bounded-search rule. Original verdict: ${attempt.gradingRevision.previousVerdict}; original tool selection: ${attempt.gradingRevision.previousChecks.routing}. Other checks are unchanged.`}{" "}
          <a href="#/methodology">Grading policy ↗</a>
        </p>
      )}
      <EvidenceValue
        evidence={attempt.checks}
        renderValue={(checks) => (
          <dl className="task-checks">
            {CHECK_NAMES.map((name) => (
              <div key={name}>
                <dt>{checkNames[name]}</dt>
                <dd>
                  <CheckMark outcome={checks[name]} />
                </dd>
              </div>
            ))}
            {attempt.gradingRevision?.priceGrounding && (
              <div>
                <dt>Price grounding</dt>
                <dd>
                  <CheckMark outcome={attempt.gradingRevision.priceGrounding.outcome} />
                  <p>{attempt.gradingRevision.priceGrounding.detail}</p>
                </dd>
              </div>
            )}
          </dl>
        )}
      />
      <dl className="results-facts">
        {attempt.recovery && (
          <div>
            <dt>Execution</dt>
            <dd>
              {attempt.recovery.timeoutMs / 1000}s budget ·{" "}
              {attempt.recovery.budgetCohort.replaceAll("-", " ")} ·{" "}
              {Math.max(1, attempt.recovery.history.length)} recorded executions
            </dd>
          </div>
        )}
        <div>
          <dt>Failure reasons</dt>
          <dd>
            {attempt.failureCategories.length
              ? attempt.failureCategories.map((reason) => reason.replaceAll("_", " ")).join(", ")
              : attempt.verdict === "pass"
                ? "None"
                : "No further reason recorded"}
          </dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd>
            <EvidenceValue evidence={attempt.durationMs} renderValue={seconds} />
          </dd>
        </div>
        {attempt.execution === "runtime_failure" && (
          <div>
            <dt>Wall time</dt>
            <dd>
              <EvidenceValue evidence={attempt.wallDurationMs} renderValue={seconds} />
            </dd>
          </div>
        )}
        <div>
          <dt>Token usage</dt>
          <dd>
            <EvidenceValue
              evidence={attempt.tokenUsage}
              renderValue={(usage) =>
                `${usage.inputTokens.toLocaleString()} input / ${usage.outputTokens.toLocaleString()} output`
              }
            />
          </dd>
        </div>
        <div>
          <dt>Checks recorded as</dt>
          <dd>
            {attempt.checkSource === "native" ? "Native checks" : "Derived from recorded scores"}
          </dd>
        </div>
        <div>
          <dt>Answer</dt>
          <dd>
            <EvidenceValue
              evidence={attempt.answer}
              renderValue={(answer) => <pre className="task-answer">{answer}</pre>}
            />
          </dd>
        </div>
        <div>
          <dt>Tool calls</dt>
          <dd>
            <EvidenceValue
              evidence={attempt.toolCalls}
              renderValue={(calls) =>
                calls.length ? (
                  <ul>
                    {calls.map((call, index) => (
                      <li key={`${call.name}-${index}`}>
                        <code>{call.name}</code>
                        {call.error ? " (error)" : ""}
                      </li>
                    ))}
                  </ul>
                ) : (
                  "No tool calls"
                )
              }
            />
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function TaskCriteria({ definition }: { definition: CanonicalCaseDefinition }) {
  return (
    <details className="results-accordion">
      <summary>Grading criteria</summary>
      <div>
        <dl className="results-facts">
          <div>
            <dt>Task identifier</dt>
            <dd>
              <code>{definition.caseId}</code>
            </dd>
          </div>
          <div>
            <dt>Suite</dt>
            <dd>
              <code>{definition.suiteId}</code> v{definition.suiteVersion}
            </dd>
          </div>
          <div>
            <dt>Expected behavior</dt>
            <dd>{definition.expectedBehavior}</dd>
          </div>
          <div>
            <dt>Required arguments</dt>
            <dd>
              {definition.requiredArguments ? (
                <pre>{JSON.stringify(definition.requiredArguments, null, 2)}</pre>
              ) : (
                "No task-specific constraints"
              )}
            </dd>
          </div>
          <div>
            <dt>Forbidden tools</dt>
            <dd>{definition.forbiddenTools.join(", ") || "None declared"}</dd>
          </div>
          <div>
            <dt>Forbidden permissions</dt>
            <dd>{definition.forbiddenScopes.join(", ") || "None declared"}</dd>
          </div>
        </dl>
        <h4>Recorded grading rules</h4>
        <ul>
          {definition.gradingCriteria.map((criterion) => (
            <li key={criterion}>{criterion}</li>
          ))}
        </ul>
      </div>
    </details>
  );
}
export function TaskRunEvidence({ run }: { run: CanonicalRun }) {
  return (
    <>
      <RunDetails run={run} />
      <dl className="results-facts">
        <div>
          <dt>Run identifier</dt>
          <dd>
            <code>{runDisplayLabel(run.runId)}</code>
          </dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>
            {run.provenance.sourceLabel}
            <br />
            <code>{run.provenance.sourceCommit}</code>
          </dd>
        </div>
        <div>
          <dt>Artifact hash</dt>
          <dd>
            <code>{run.provenance.sourceArtifactSha256 ?? "Not retained"}</code>
          </dd>
        </div>
      </dl>
      {run.notes.map((note) => (
        <p key={note}>{note}</p>
      ))}
    </>
  );
}
