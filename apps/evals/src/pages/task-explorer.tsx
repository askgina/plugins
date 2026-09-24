import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ChevronRight, Search, X } from "lucide-react";
import {
  PROTOTYPE_FAMILIES,
  type CanonicalCaseDefinition,
  type PrototypeFamily,
} from "../canonical/canonical";
import { EvidenceValue } from "../canonical/components";
import {
  caseDefinitionsForFamily,
  configurationLeaderboardRows,
  getCaseDefinition,
  summarizeTask,
  unifiedLeaderboardRows,
  type LeaderboardModelRow,
  type TaskSummary,
} from "../canonical/selectors";
import { ModelAvatar, PageShell } from "../components/eval-ui";
import { seconds } from "../components/results-ui";
import { AttemptConversationPanel } from "../components/conversation-panel";
import { AttemptChecks, TaskCriteria, TaskRunEvidence } from "../components/task-evidence";
import {
  attemptLabel,
  taskRunOptions,
  taskSettingLabel,
  type TaskSelection,
  type TaskView,
} from "../lib/task-workspace";
import "../styles/task-workspace.css";
import { TransactionTaskPanels } from "../components/transaction-task-panels";
import { TRANSACTION_TASKS } from "../lib/transaction-evals";

const defaultRows = [...unifiedLeaderboardRows()].sort((a, b) =>
  a.model.name.localeCompare(b.model.name),
);
const configurationRows = configurationLeaderboardRows();
const views = [
  { id: "conversation", label: "Conversation" },
  { id: "checks", label: "Checks" },
  { id: "run", label: "Run details" },
] as const;

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

function TaskOutcome({ summary }: { summary: TaskSummary }) {
  if (summary.status === "available")
    return (
      <span>
        {summary.passed}/{summary.started} passed
      </span>
    );
  if (summary.status === "not_evaluated") return <span>Not evaluated</span>;
  if (summary.status === "unavailable") return <span>Results unavailable</span>;
  const failed = summary.slots.filter((entry) => entry?.verdict === "fail").length;
  const timedOut = summary.slots.filter((entry) => entry?.execution === "timed_out").length;
  const errors = summary.slots.filter((entry) => entry?.execution === "runtime_failure").length;
  return (
    <>
      <span>
        {summary.passed} passed · {failed} failed
      </span>
      <small>
        {[
          timedOut ? `${timedOut} timed out` : "",
          errors ? `${errors} run ${errors === 1 ? "error" : "errors"}` : "",
        ]
          .filter(Boolean)
          .join(" · ") || "Incomplete results"}
      </small>
    </>
  );
}

export function TaskExplorerPage({
  initialFamily = "Spot",
  initialCaseId,
  initialModelId,
  initialRunId,
  initialAttempt,
  initialView = import.meta.env.DEV ? "conversation" : "checks",
  initialSearch = "",
  onNavigate,
  rows: sourceRows = defaultRows,
}: {
  initialFamily?: PrototypeFamily;
  initialCaseId?: string;
  initialModelId?: string;
  initialRunId?: string;
  initialAttempt?: number;
  initialView?: TaskView;
  initialSearch?: string;
  onNavigate?: (selection: TaskSelection) => void;
  rows?: readonly LeaderboardModelRow[];
}) {
  const [selection, setSelection] = useState<TaskSelection>({
    family: initialFamily,
    caseId: initialCaseId,
    modelId: initialModelId,
    runId: initialRunId,
    attempt: initialAttempt,
    view: initialView,
  });
  const [search, setSearch] = useState(initialSearch);
  const [modelSearch, setModelSearch] = useState("");
  const [modelSearchOpen, setModelSearchOpen] = useState(false);
  const evidenceBody = useRef<HTMLDivElement>(null);
  const modelList = useRef<HTMLDivElement>(null);
  const modelSearchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (modelSearchOpen) modelSearchInput.current?.focus();
  }, [modelSearchOpen]);
  useEffect(() => {
    setSelection({
      family: initialFamily,
      caseId: initialCaseId,
      modelId: initialModelId,
      runId: initialRunId,
      attempt: initialAttempt,
      view: initialView,
    });
  }, [initialFamily, initialCaseId, initialModelId, initialRunId, initialAttempt, initialView]);
  useEffect(() => setSearch(initialSearch), [initialSearch]);

  const family =
    (selection.caseId ? getCaseDefinition(selection.caseId)?.family : undefined) ??
    selection.family;
  const definitions = caseDefinitionsForFamily(family);
  // Spot also lists the transaction tasks; they are owned per model and scored separately.
  const transactionTask =
    family === "Spot" ? TRANSACTION_TASKS.find((task) => task.id === selection.caseId) : undefined;
  const query = search.trim().toLocaleLowerCase();
  const shownTasks = definitions.filter((definition) =>
    `${taskName(definition)} ${definition.prompt.availability === "available" ? definition.prompt.value : ""}`
      .toLocaleLowerCase()
      .includes(query),
  );
  const definition = shownTasks.find((entry) => entry.caseId === selection.caseId) ?? shownTasks[0];
  const rows = [...new Map(sourceRows.map((row) => [row.model.id, row])).values()];
  const row = rows.find((entry) => entry.model.id === selection.modelId) ?? rows[0];
  const configurations = sourceRows === defaultRows ? configurationRows : sourceRows;
  const runOptions = row ? taskRunOptions(row, family, configurations) : [];
  const run = runOptions.find((entry) => entry.runId === selection.runId) ?? row?.runs[family];
  const summary = summarizeTask(run, definition?.caseId ?? "");
  const repetition =
    selection.attempt &&
    Number.isInteger(selection.attempt) &&
    selection.attempt > 0 &&
    selection.attempt <= summary.slots.length
      ? selection.attempt
      : (summary.slots.find((entry) => entry)?.repetition ?? 1);
  const attempt = summary.slots[repetition - 1];
  const view = selection.view ?? initialView;
  const modelQuery = modelSearch.trim().toLocaleLowerCase();
  const shownModels = rows.filter((entry) =>
    `${entry.model.name} ${entry.model.provider}`.toLocaleLowerCase().includes(modelQuery),
  );
  useEffect(() => {
    const body = evidenceBody.current;
    if (!body) return;
    body.scrollTo({ top: 0 });
    // On phones the document scrolls, so advancing at the end of a transcript
    // should bring the new evidence into view without skipping the initial pickers.
    if (getComputedStyle(body).overflowY === "visible" && body.getBoundingClientRect().top < 0)
      body.scrollIntoView({ block: "start" });
  }, [definition?.caseId, run?.runId, repetition, view]);
  useEffect(() => {
    const list = modelList.current;
    const selected = list?.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
    if (!list || !selected) return;
    const revealSelection = () => {
      if (!list.clientHeight) return;
      const top = selected.offsetTop;
      const bottom = top + selected.offsetHeight;
      if (top < list.scrollTop) list.scrollTop = top;
      else if (bottom > list.scrollTop + list.clientHeight)
        list.scrollTop = bottom - list.clientHeight;
    };
    revealSelection();
    const observer = new ResizeObserver(revealSelection);
    observer.observe(list);
    return () => observer.disconnect();
  }, [row?.model.id, modelQuery]);

  function move(next: Partial<TaskSelection>) {
    const updated = {
      family,
      caseId: definition?.caseId,
      modelId: row?.model.id,
      runId: run?.runId,
      attempt: repetition,
      view,
      ...next,
    };
    setSelection(updated);
    onNavigate?.(updated);
  }
  function chooseFamily(next: PrototypeFamily) {
    const configuration = configurations.find((entry) =>
      Object.values(entry.runs).some((candidate) => candidate.runId === run?.runId),
    );
    setSearch("");
    move({
      family: next,
      caseId: caseDefinitionsForFamily(next)[0]?.caseId,
      runId: configuration?.runs[next]?.runId ?? row?.runs[next]?.runId,
      attempt: undefined,
    });
  }
  function chooseModel(modelId: string) {
    if (modelId === row?.model.id) return;
    move({
      modelId,
      runId: rows.find((entry) => entry.model.id === modelId)?.runs[family]?.runId,
      attempt: undefined,
    });
  }

  return (
    <PageShell active="tasks" className="task-workspace-shell">
      <div className="eval-container results-page task-workspace-page">
        <header className="task-workspace-page-heading">
          <h1>Tasks</h1>
          <p>Compare model responses and inspect the evidence.</p>
        </header>
        <div className="results-toolbar task-toolbar">
          <nav className="results-category-tabs" aria-label="Task categories">
            {PROTOTYPE_FAMILIES.map((category) => (
              <button
                key={category}
                type="button"
                aria-current={family === category ? "page" : undefined}
                onClick={() => chooseFamily(category)}
              >
                {category} <span>({caseDefinitionsForFamily(category).length})</span>
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
        {!definition ? (
          <div className="task-workspace-empty" role="status">
            <h2>No tasks match “{search}”</h2>
            <p>Search a task name or a phrase from its prompt.</p>
            <button type="button" onClick={() => setSearch("")}>
              Clear task search
            </button>
          </div>
        ) : (
          <div className="task-workspace">
            <section className="task-workspace-tasks" aria-labelledby="workspace-tasks-heading">
              <div className="task-workspace-heading">
                <h2 id="workspace-tasks-heading">{family} tasks</h2>
                <span>
                  {shownTasks.length + (family === "Spot" ? TRANSACTION_TASKS.length : 0)} tasks
                </span>
              </div>
              <label className="task-workspace-task-select">
                <span className="results-sr-only">Selected task</span>
                <select
                  value={transactionTask?.id ?? definition.caseId}
                  onChange={(event) => move({ caseId: event.target.value, attempt: undefined })}
                >
                  {shownTasks.map((entry) => (
                    <option key={entry.caseId} value={entry.caseId}>
                      {taskName(entry)}
                    </option>
                  ))}
                  {family === "Spot" &&
                    TRANSACTION_TASKS.map((task) => (
                      <option key={task.id} value={task.id}>
                        Transactions: {task.name}
                      </option>
                    ))}
                </select>
              </label>
              <nav className="task-workspace-task-list" aria-label={`${family} tasks`}>
                {shownTasks.map((entry) => (
                  <button
                    type="button"
                    key={entry.caseId}
                    aria-current={
                      !transactionTask && definition.caseId === entry.caseId ? "true" : undefined
                    }
                    onClick={() => move({ caseId: entry.caseId, attempt: undefined })}
                  >
                    <span>{taskName(entry)}</span>
                  </button>
                ))}
                {family === "Spot" && (
                  <>
                    <h3 className="task-workspace-task-group">Transactions</h3>
                    {TRANSACTION_TASKS.map((task) => (
                      <button
                        type="button"
                        key={task.id}
                        aria-current={transactionTask?.id === task.id ? "true" : undefined}
                        onClick={() => move({ caseId: task.id, attempt: undefined })}
                      >
                        <span>{task.name}</span>
                      </button>
                    ))}
                  </>
                )}
              </nav>
            </section>
            {transactionTask ? (
              <TransactionTaskPanels
                task={transactionTask}
                rows={rows}
                selectedModelId={selection.modelId}
                onSelectModel={(modelId) => move({ modelId, attempt: undefined })}
              />
            ) : (
              <>
                <section
                  className="task-workspace-models"
                  aria-labelledby="workspace-models-heading"
                  data-search-open={modelSearchOpen || Boolean(modelSearch)}
                >
                  {rows.length > 0 && (
                    <label className="task-workspace-model-select">
                      <span className="results-sr-only">Selected model</span>
                      <select
                        value={row?.model.id ?? ""}
                        onChange={(event) => chooseModel(event.target.value)}
                      >
                        {row && !shownModels.includes(row) && (
                          <option value={row.model.id}>{row.model.name} (selected)</option>
                        )}
                        {shownModels.map((entry) => (
                          <option key={entry.model.id} value={entry.model.id}>
                            {entry.model.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <div className="task-workspace-model-tools">
                    <div className="task-workspace-heading">
                      <h2 id="workspace-models-heading">Models</h2>
                      <span>
                        {modelQuery ? `${shownModels.length} of ${rows.length}` : rows.length}{" "}
                        models
                      </span>
                    </div>
                    <button
                      type="button"
                      className="task-workspace-model-search-toggle"
                      aria-label="Search models"
                      aria-expanded={modelSearchOpen || Boolean(modelSearch)}
                      aria-controls="workspace-model-search"
                      onClick={() => {
                        const expanded = modelSearchOpen || Boolean(modelSearch);
                        setModelSearchOpen(!expanded);
                        if (expanded) setModelSearch("");
                      }}
                    >
                      <Search size={17} aria-hidden="true" />
                    </button>
                    <label id="workspace-model-search" className="task-workspace-model-search">
                      <Search size={15} aria-hidden="true" />
                      <span className="results-sr-only">Search models</span>
                      <input
                        type="search"
                        ref={modelSearchInput}
                        placeholder="Search models"
                        value={modelSearch}
                        onChange={(event) => setModelSearch(event.target.value)}
                      />
                    </label>
                  </div>
                  {shownModels.length ? (
                    <>
                      <div
                        ref={modelList}
                        className="task-workspace-model-list"
                        role="group"
                        aria-label="Model results"
                      >
                        {shownModels.map((entry) => {
                          const selected = row?.model.id === entry.model.id;
                          const modelRun = selected ? run : entry.runs[family];
                          return (
                            <button
                              key={entry.model.id}
                              type="button"
                              className="task-workspace-model"
                              aria-label={`View ${entry.model.name} results`}
                              aria-pressed={selected}
                              onClick={() => chooseModel(entry.model.id)}
                            >
                              <ModelAvatar model={entry.model} />
                              <span className="task-workspace-model-name">
                                <strong>{entry.model.name}</strong>
                                <small>
                                  {modelRun ? taskSettingLabel(modelRun) : "No measured run"}
                                </small>
                                <span className="task-workspace-outcome">
                                  <TaskOutcome
                                    summary={summarizeTask(modelRun, definition.caseId)}
                                  />
                                </span>
                              </span>
                              <ChevronRight size={15} aria-hidden="true" />
                            </button>
                          );
                        })}
                      </div>
                    </>
                  ) : (
                    <div className="task-workspace-empty-models" role="status">
                      <p>
                        {rows.length
                          ? `No models match “${modelSearch}”.`
                          : "No models have recorded results yet."}
                      </p>
                      {modelSearch && (
                        <button type="button" onClick={() => setModelSearch("")}>
                          <X size={14} aria-hidden="true" /> Clear model search
                        </button>
                      )}
                    </div>
                  )}
                  <p className="task-workspace-hint">
                    Latest setting per model. History in Recorded setting.
                  </p>
                </section>
                <section
                  className="task-workspace-inspector"
                  aria-labelledby="workspace-model-heading"
                >
                  <div className="task-workspace-inspector-header">
                    <div className="task-workspace-model-heading">
                      <h2 id="workspace-model-heading">{row?.model.name ?? "No model selected"}</h2>
                      {run && (
                        <label className="task-workspace-setting">
                          <span>Recorded setting</span>
                          <select
                            value={run.runId}
                            onChange={(event) =>
                              move({ runId: event.target.value, attempt: undefined })
                            }
                          >
                            {runOptions.map((entry) => (
                              <option key={entry.runId} value={entry.runId}>
                                {taskSettingLabel(entry)} · {entry.startedAt.slice(0, 10)}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    </div>
                    {summary.slots.length > 0 && (
                      <div className="task-attempts" role="group" aria-label="Attempts">
                        {summary.slots.map((entry, index) => (
                          <button
                            key={index}
                            type="button"
                            className={`task-attempt ${entry?.verdict === "pass" ? "task-attempt-pass" : ""}`}
                            aria-pressed={repetition === index + 1}
                            disabled={!entry}
                            onClick={() => move({ attempt: index + 1 })}
                          >
                            <span>Attempt {index + 1}</span>
                            <strong>{attemptLabel(entry)}</strong>
                          </button>
                        ))}
                      </div>
                    )}
                    {attempt && (
                      <p className="task-workspace-attempt-meta">
                        <EvidenceValue evidence={attempt.durationMs} renderValue={seconds} />
                      </p>
                    )}
                    <div
                      className="task-workspace-tabs"
                      role="tablist"
                      aria-label="Attempt evidence"
                    >
                      {views.map((entry, index) => (
                        <button
                          key={entry.id}
                          id={`task-tab-${entry.id}`}
                          role="tab"
                          type="button"
                          aria-selected={view === entry.id}
                          aria-controls="task-evidence-panel"
                          tabIndex={view === entry.id ? 0 : -1}
                          onClick={() => move({ view: entry.id })}
                          onKeyDown={(event) => {
                            const next =
                              event.key === "ArrowRight"
                                ? (index + 1) % views.length
                                : event.key === "ArrowLeft"
                                  ? (index + views.length - 1) % views.length
                                  : event.key === "Home"
                                    ? 0
                                    : event.key === "End"
                                      ? views.length - 1
                                      : null;
                            if (next === null) return;
                            event.preventDefault();
                            move({ view: views[next]!.id });
                            document.getElementById(`task-tab-${views[next]!.id}`)?.focus();
                          }}
                        >
                          {entry.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div
                    ref={evidenceBody}
                    id="task-evidence-panel"
                    className="task-workspace-evidence"
                    role="tabpanel"
                    aria-labelledby={`task-tab-${view}`}
                    tabIndex={0}
                  >
                    <details className="task-workspace-prompt" key={definition.caseId}>
                      <summary>
                        {taskName(definition)} <span>· Prompt & criteria</span>
                      </summary>
                      <EvidenceValue
                        evidence={definition.prompt}
                        renderValue={(prompt) => <p>{prompt}</p>}
                      />
                      <TaskCriteria definition={definition} />
                    </details>
                    {summary.status !== "available" && (
                      <p className="task-workspace-status" role="status">
                        <strong>
                          {summary.status === "not_evaluated"
                            ? "Not evaluated"
                            : summary.status === "incomplete"
                              ? "Incomplete results"
                              : "Results unavailable"}
                          .
                        </strong>{" "}
                        {summary.reason}
                      </p>
                    )}
                    {view === "run" ? (
                      run ? (
                        <TaskRunEvidence run={run} />
                      ) : (
                        <p>No measured run is available for this model and category.</p>
                      )
                    ) : attempt ? (
                      view === "checks" ? (
                        <AttemptChecks attempt={attempt} />
                      ) : (
                        <AttemptConversationPanel attempt={attempt} model={row?.model} compact />
                      )
                    ) : (
                      <p>
                        {summary.slots.length
                          ? `Attempt ${repetition} was not recorded.`
                          : "Individual attempts are not available for this selection."}
                      </p>
                    )}
                  </div>
                  {summary.slots.length > 0 && (
                    <div className="task-workspace-attempt-navigation">
                      <button
                        type="button"
                        disabled={!summary.slots.slice(0, repetition - 1).some(Boolean)}
                        onClick={() => {
                          const previous = summary.slots
                            .slice(0, repetition - 1)
                            .reverse()
                            .find((entry) => entry);
                          if (previous) move({ attempt: previous.repetition });
                        }}
                      >
                        <ArrowLeft size={14} aria-hidden="true" />
                        Previous attempt
                      </button>
                      <button
                        type="button"
                        disabled={!summary.slots.slice(repetition).some(Boolean)}
                        onClick={() => {
                          const next = summary.slots.slice(repetition).find((entry) => entry);
                          if (next) move({ attempt: next.repetition });
                        }}
                      >
                        Next attempt
                        <ArrowRight size={14} aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </section>
              </>
            )}
          </div>
        )}
        <p className="results-footnote task-workspace-footnote">
          Scores measure tool-use checks, with price grounding on three revised Perps tasks.{" "}
          <a href="#/methodology">How scoring works ↗</a>
        </p>
      </div>
    </PageShell>
  );
}
