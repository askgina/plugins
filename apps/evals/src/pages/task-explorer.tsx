import { Fragment, useEffect, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import {
  CHECK_NAMES,
  PROTOTYPE_FAMILIES,
  type CanonicalAttempt,
  type CanonicalCaseDefinition,
  type CanonicalRun,
  type PrototypeFamily,
} from "../canonical/canonical";
import { CheckMark, EvidenceValue } from "../canonical/components";
import {
  caseDefinitionsForFamily,
  getCaseDefinition,
  sortLeaderboardRows,
  summarizeTask,
  unifiedLeaderboardRows,
  type LeaderboardModelRow,
} from "../canonical/selectors";
import { PageShell } from "../components/eval-ui";
import { InfoPopover, ResultsHeader, RunDetails, seconds } from "../components/results-ui";

const defaultRows = sortLeaderboardRows(unifiedLeaderboardRows());

const taskNames: Record<string, string> = {
  "spot-token-metadata": "Token information",
  "spot-token-chart": "Token price chart",
  "spot-simple-price": "Current token price",
  "spot-fetch-swap-history": "Swap history",
  "perps-account": "Account balance",
  "perps-positions": "Open positions",
  "perps-open-orders": "Open orders",
  "perps-portfolio": "Portfolio performance",
  "perps-markets": "Available markets",
  "perps-single-price": "Single market price",
  "perps-multiple-prices": "Multiple market prices",
  "perps-asset-data": "Asset market data",
  "perps-search-hip3-markets": "Find HIP-3 markets",
  "perps-hip3-dexes": "HIP-3 venues",
  "perps-hip3-markets": "Markets on a HIP-3 venue",
  "perps-hip3-price": "HIP-3 market price",
  "perps-fetch-trades": "Recent trades",
  "perps-fetch-candles": "Price candles",
  "perps-fetch-order-book": "Order book",
  "perps-preview-order-cost": "Order cost estimate",
  "perps-create-table": "Create a market data table",
  "perps-create-and-query-table": "Create and query market data",
  "predictions-focused-fact-search-only": "Find current market odds",
  "predictions-broad-nba-search-only": "Find NBA markets",
  "predictions-broad-football-search-only": "Find football markets",
  "predictions-non-exact-no-render": "Find election markets",
  "predictions-sparse-history-no-render": "Handle limited price history",
  "predictions-multi-series-no-render": "Compare market histories",
  "predictions-expiring-markets": "Find expiring markets",
  "predictions-series-market": "Find a recurring market",
  "predictions-orderbook": "Market order book",
  "predictions-fetch-market-data": "Market data",
  "predictions-fetch-history-data": "Historical market data",
  "predictions-open-positions": "Open positions",
  "predictions-order-history": "Order history",
  "portfolio-crosschain-balances": "Balances across chains",
  "portfolio-account-addresses": "Linked wallet addresses",
  "portfolio-list-scheduled-prompts": "Scheduled prompts",
};
const taskName = (definition: CanonicalCaseDefinition) =>
  taskNames[definition.caseId] ?? definition.title;
const checkNames = {
  routing: "Tool selection",
  arguments: "Arguments",
  safety: "Restrictions",
  completion: "Completion",
  skillActivation: "Skill activation",
};

function attemptLabel(attempt: CanonicalAttempt | undefined): string {
  if (!attempt) return "Not recorded";
  if (attempt.execution === "timed_out") return "Timed out";
  if (attempt.execution === "runtime_failure") return "Run error";
  if (attempt.execution === "pending") return "Pending";
  if (attempt.execution === "unstarted") return "Not started";
  if (attempt.execution === "unknown") return "Unknown";
  return attempt.verdict === "pass"
    ? "Passed"
    : attempt.verdict === "fail"
      ? "Failed"
      : "Not graded";
}

function GradingInfo({ definition }: { definition: CanonicalCaseDefinition }) {
  return (
    <InfoPopover label={`Grading criteria: ${taskName(definition)}`}>
      <ul>
        <li>
          {definition.routingKind === "sequence"
            ? "Call the required tools in order."
            : "Make exactly one call to the required tool."}
        </li>
        <li>
          {definition.requiredArguments
            ? "Use the required argument values. Extra fields are allowed."
            : "No task-specific argument values are required."}
        </li>
        <li>Finish the attempt and tool calls without errors.</li>
        {(definition.forbiddenTools.length > 0 || definition.forbiddenScopes.length > 0) && (
          <li>Avoid the forbidden tools and permissions listed in Technical details.</li>
        )}
      </ul>
      <p>
        Final-answer accuracy is not scored. Exact tool and argument requirements are in Technical
        details.
      </p>
    </InfoPopover>
  );
}

function AttemptDetails({ attempt }: { attempt: CanonicalAttempt }) {
  return (
    <div className="task-attempt-details">
      <h4>
        Attempt {attempt.repetition}: {attemptLabel(attempt)}
      </h4>
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
          </dl>
        )}
      />
      <dl className="results-facts">
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

function TaskDetail({
  definition,
  rows,
  modelId,
  onModel,
}: {
  definition: CanonicalCaseDefinition;
  rows: readonly LeaderboardModelRow[];
  modelId: string;
  onModel: (id: string) => void;
}) {
  const row = rows.find((entry) => entry.model.id === modelId) ?? rows[0];
  const run = row?.runs[definition.family];
  const summary = summarizeTask(run, definition.caseId);
  const [repetition, setRepetition] = useState<number | null>(null);
  const attempt = summary.slots.find((entry) => entry?.repetition === repetition);
  return (
    <div className="results-detail-body task-detail">
      <h3>{taskName(definition)}</h3>
      <h4>Full prompt</h4>
      <EvidenceValue
        evidence={definition.prompt}
        renderValue={(prompt) => <blockquote className="task-full-prompt">{prompt}</blockquote>}
      />
      <div className="task-model-picker">
        <label htmlFor={`model-${definition.caseId}`}>Model</label>
        <select
          id={`model-${definition.caseId}`}
          value={row?.model.id ?? ""}
          onChange={(event) => {
            setRepetition(null);
            onModel(event.target.value);
          }}
        >
          {rows.map((entry) => (
            <option key={entry.model.id} value={entry.model.id}>
              {entry.model.name}
            </option>
          ))}
        </select>
      </div>
      {summary.status !== "available" && (
        <p role="status">
          {summary.status === "not_evaluated"
            ? "Not evaluated"
            : summary.status === "incomplete"
              ? "Incomplete results"
              : "Results unavailable"}
          : {summary.reason}
        </p>
      )}
      <div className="task-attempts" aria-label="Attempts">
        {summary.slots.map((entry, index) => (
          <button
            key={index}
            type="button"
            disabled={!entry}
            aria-pressed={entry !== undefined && repetition === entry.repetition}
            className={`task-attempt ${entry?.verdict === "pass" ? "task-attempt-pass" : ""}`}
            onClick={() => setRepetition(entry?.repetition ?? null)}
          >
            <span>Attempt {index + 1}</span>
            <strong>{attemptLabel(entry)}</strong>
          </button>
        ))}
      </div>
      {attempt && <AttemptDetails attempt={attempt} />}
      <details className="results-accordion">
        <summary>Technical details</summary>
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
          {run && (
            <>
              <RunDetails run={run} />
              <dl className="results-facts">
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
          )}
        </div>
      </details>
    </div>
  );
}

function TaskResult({
  run,
  caseId,
  onClick,
}: {
  run: CanonicalRun | undefined;
  caseId: string;
  onClick: () => void;
}) {
  const summary = summarizeTask(run, caseId);
  if (summary.status === "not_evaluated")
    return <span className="task-unavailable">Not evaluated</span>;
  return (
    <button className="task-result" onClick={onClick}>
      {summary.status === "available" ? (
        <>
          {summary.passed}/{summary.started} <span>passed</span>
        </>
      ) : summary.status === "incomplete" ? (
        "Incomplete results"
      ) : (
        "Results unavailable"
      )}
    </button>
  );
}

export function TaskExplorerPage({
  initialFamily = "Spot",
  initialCaseId,
  initialModelId,
  initialSearch = "",
  onNavigate,
  rows = defaultRows,
}: {
  initialFamily?: PrototypeFamily;
  initialCaseId?: string;
  initialModelId?: string;
  initialSearch?: string;
  onNavigate?: (family: PrototypeFamily, modelId?: string, caseId?: string) => void;
  rows?: readonly LeaderboardModelRow[];
}) {
  const validCase = initialCaseId ? getCaseDefinition(initialCaseId) : undefined;
  const initialCategory = validCase?.family ?? initialFamily;
  const [family, setFamily] = useState<PrototypeFamily>(initialCategory);
  const [search, setSearch] = useState(initialSearch);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    new Set(validCase ? [validCase.caseId] : []),
  );
  const [models, setModels] = useState<Readonly<Record<string, string>>>({});
  // URL changes include browser back/forward, not only actions inside this page.
  useEffect(() => {
    setFamily(initialCategory);
    setSearch(initialSearch);
  }, [initialCategory, initialSearch]);
  useEffect(() => {
    if (validCase) {
      setExpanded((current) => new Set([...current, validCase.caseId]));
      if (initialModelId)
        setModels((current) => ({ ...current, [validCase.caseId]: initialModelId }));
    }
  }, [validCase, initialModelId]);
  const definitions = caseDefinitionsForFamily(family);
  const query = search.trim().toLocaleLowerCase();
  const shown = definitions.filter((definition) =>
    `${taskName(definition)} ${definition.prompt.availability === "available" ? definition.prompt.value : ""}`
      .toLocaleLowerCase()
      .includes(query),
  );
  const defaultModel =
    rows.find((row) => row.model.id === initialModelId)?.model.id ?? rows[0]?.model.id ?? "";
  function select(caseId: string, modelId: string) {
    setExpanded((current) => new Set([...current, caseId]));
    setModels((current) => ({ ...current, [caseId]: modelId }));
    onNavigate?.(family, modelId, caseId);
  }
  function toggle(caseId: string) {
    if (expanded.has(caseId)) {
      setExpanded((current) => {
        const next = new Set(current);
        next.delete(caseId);
        return next;
      });
      onNavigate?.(family, defaultModel);
    } else select(caseId, models[caseId] ?? defaultModel);
  }
  return (
    <PageShell active="tasks">
      <div className="eval-container results-page">
        <ResultsHeader
          title="Tasks"
          description="Read each prompt and compare the models’ results."
        />
        <div className="results-toolbar task-toolbar">
          <nav className="results-category-tabs" aria-label="Task categories">
            {PROTOTYPE_FAMILIES.map((category) => (
              <button
                key={category}
                type="button"
                aria-current={family === category ? "page" : undefined}
                onClick={() => {
                  setFamily(category);
                  setSearch("");
                  onNavigate?.(category, defaultModel);
                }}
              >
                {category} <span>({caseDefinitionsForFamily(category).length})</span>
                {category === "Portfolio" && <small>Not evaluated</small>}
              </button>
            ))}
          </nav>
          <label className="results-search">
            <Search size={17} aria-hidden="true" />
            <span className="results-sr-only">Search tasks or prompts</span>
            <input
              type="search"
              placeholder="Search tasks or prompts"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>
        <p className="results-footnote">
          {family === "Portfolio"
            ? "Portfolio tasks have not been evaluated and do not contribute to Overall."
            : "Each result shows passed attempts out of started attempts. Open a task to see its full prompt and individual attempts."}
        </p>
        <div
          className="results-scroll"
          role="region"
          aria-label={`${family} tasks and model results`}
          tabIndex={0}
        >
          <table className="results-table tasks-table">
            <caption className="results-sr-only">{family} prompts and model results</caption>
            <thead>
              <tr>
                <th scope="col" className="results-sticky">
                  Task
                </th>
                <th scope="col">Prompt</th>
                {rows.map((row) => (
                  <th
                    scope="col"
                    key={row.model.id}
                    className={row.model.id === initialModelId ? "task-highlight" : undefined}
                  >
                    {row.model.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((definition) => (
                <Fragment key={definition.caseId}>
                  <tr>
                    <th scope="row" className="results-sticky">
                      <div className="task-name">
                        <button
                          className="task-name-button"
                          aria-expanded={expanded.has(definition.caseId)}
                          aria-controls={`task-${definition.caseId}`}
                          onClick={() => toggle(definition.caseId)}
                        >
                          <ChevronDown size={16} aria-hidden="true" />
                          <span>{taskName(definition)}</span>
                        </button>
                        <GradingInfo definition={definition} />
                      </div>
                    </th>
                    <td>
                      <EvidenceValue
                        evidence={definition.prompt}
                        renderValue={(prompt) => <p className="task-prompt-preview">{prompt}</p>}
                      />
                    </td>
                    {rows.map((row) => (
                      <td
                        key={row.model.id}
                        className={row.model.id === initialModelId ? "task-highlight" : undefined}
                      >
                        <TaskResult
                          run={row.runs[family]}
                          caseId={definition.caseId}
                          onClick={() => select(definition.caseId, row.model.id)}
                        />
                      </td>
                    ))}
                  </tr>
                  <tr
                    id={`task-${definition.caseId}`}
                    hidden={!expanded.has(definition.caseId)}
                    className="results-expanded"
                  >
                    <td colSpan={rows.length + 2}>
                      {expanded.has(definition.caseId) && (
                        <TaskDetail
                          definition={definition}
                          rows={rows}
                          modelId={models[definition.caseId] ?? defaultModel}
                          onModel={(modelId) => select(definition.caseId, modelId)}
                        />
                      )}
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        {shown.length === 0 && (
          <div className="results-empty" role="status">
            <h2>No matching tasks</h2>
            <p>Search by task name or words in the prompt.</p>
            <button onClick={() => setSearch("")}>Clear search</button>
          </div>
        )}
        <p className="results-footnote">
          Scores check tool use and completion. Final-answer accuracy is not graded.{" "}
          <a href="#/methodology">How scoring works ↗</a>
        </p>
      </div>
    </PageShell>
  );
}
