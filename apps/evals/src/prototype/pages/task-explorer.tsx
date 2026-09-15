// Page 3 — `#/prototype/tasks?family=`.
//
// Versioned case definitions per family plus a model × repetition outcome
// matrix over every retained run. Detail depth follows capability: the Sol
// Perps run drills down to per-attempt checks, durations and tokens; Sol
// Predictions keeps repetition outcomes and category notes with
// `not_retained` marks; the September 14 catalog-hash runs are labelled
// native vs derived_from_scores. Portfolio shows definitions only — no
// measured Portfolio evidence exists and none is fabricated.

import { Fragment, useState } from "react";

import { FamilyTabs, ModelAvatar, PageShell, Panel } from "../../components/eval-ui";
import {
  CHECK_NAMES,
  PROTOTYPE_FAMILIES,
  canonicalRuns,
  withdrawnRuns,
  type CanonicalAttempt,
  type CanonicalCaseDefinition,
  type CanonicalRun,
  type ExecutionStatus,
  type PrototypeFamily,
  type WithdrawnRunRef,
} from "../canonical";
import {
  attemptsFor,
  caseDefinitionsForFamily,
  eligibilityText,
  getModel,
  headlineFor,
} from "../selectors";
import {
  AvailabilityMark,
  CheckMark,
  EvidenceValue,
  ExecutionChip,
  HeadlineValue,
  OriginTag,
  OutcomeMatrixCell,
  PrototypeBanner,
  VerdictChip,
} from "../components";
import "./task-explorer.css";

// Started = completed + timed_out + runtime_failure + pending (the resolved
// semantics); unstarted/unknown stay out of every denominator.
const STARTED_STATUSES: readonly ExecutionStatus[] = [
  "completed",
  "timed_out",
  "runtime_failure",
  "pending",
];

// One matrix cell per case × repetition slot. The synthetic coverage-gap
// rows carry an extra unstarted/unknown slot beside a completed attempt at
// the same repetition; the state-bearing attempt wins the cell so the gap
// stays visible (the run's own counts agree with that reading — e.g. 11 of
// 12 started, not 12 of 12).
const CELL_STATE_PRIORITY: readonly ExecutionStatus[] = [
  "unstarted",
  "unknown",
  "pending",
  "timed_out",
  "runtime_failure",
  "completed",
];

const GAP_LABELS: Partial<Record<ExecutionStatus, string>> = {
  unstarted: "unstarted",
  unknown: "unknown",
  pending: "pending",
};

function resolveFamily(value: string | undefined): PrototypeFamily {
  const query = (value ?? "").toLowerCase();
  return PROTOTYPE_FAMILIES.find((family) => family.toLowerCase() === query) ?? "Spot";
}

/** The run's attempts for one case, deduped to one entry per repetition slot. */
function caseAttempts(run: CanonicalRun, caseId: string): readonly CanonicalAttempt[] {
  const byRepetition = new Map<number, CanonicalAttempt>();
  for (const attempt of attemptsFor(run)) {
    if (attempt.caseId !== caseId) continue;
    const existing = byRepetition.get(attempt.repetition);
    if (
      existing === undefined ||
      CELL_STATE_PRIORITY.indexOf(attempt.execution) <
        CELL_STATE_PRIORITY.indexOf(existing.execution)
    ) {
      byRepetition.set(attempt.repetition, attempt);
    }
  }
  return [...byRepetition.values()].sort((a, b) => a.repetition - b.repetition);
}

interface CaseOutcome {
  readonly passed: number;
  readonly started: number;
  readonly gaps: readonly string[];
}

/** pass/started counts for one case inside one run — counts only, never a rate. */
function caseOutcome(attempts: readonly CanonicalAttempt[]): CaseOutcome {
  let passed = 0;
  let started = 0;
  const gapCounts = new Map<ExecutionStatus, number>();
  for (const attempt of attempts) {
    if (STARTED_STATUSES.includes(attempt.execution)) {
      started += 1;
      if (attempt.verdict === "pass") passed += 1;
    } else {
      gapCounts.set(attempt.execution, (gapCounts.get(attempt.execution) ?? 0) + 1);
    }
  }
  const gaps = [...gapCounts.entries()].map(
    ([status, count]) => `${count} ${GAP_LABELS[status] ?? status}`,
  );
  return { passed, started, gaps };
}

type ExplorerRow =
  | { readonly kind: "run"; readonly run: CanonicalRun }
  | { readonly kind: "withdrawn"; readonly ref: WithdrawnRunRef };

/** Measured runs first (oldest to newest), then synthetic, then withdrawn refs. */
function rowsForFamily(family: PrototypeFamily): readonly ExplorerRow[] {
  const byStart = (a: CanonicalRun, b: CanonicalRun) =>
    a.startedAt.localeCompare(b.startedAt) || a.runId.localeCompare(b.runId);
  const runs = canonicalRuns.filter((run) => run.family === family);
  const measured = runs.filter((run) => run.origin === "measured").sort(byStart);
  const synthetic = runs.filter((run) => run.origin === "synthetic").sort(byStart);
  return [
    ...measured.map((run): ExplorerRow => ({ kind: "run", run })),
    ...synthetic.map((run): ExplorerRow => ({ kind: "run", run })),
    ...withdrawnRuns
      .filter((ref) => ref.family === family)
      .map((ref): ExplorerRow => ({ kind: "withdrawn", ref })),
  ];
}

function checkSourceLabel(run: CanonicalRun): string {
  return run.checkSource === "native" ? "native checks" : "checks derived from scores";
}

function caseBindingLabel(run: CanonicalRun): string {
  return run.caseBinding === "bound_by_suite"
    ? "bound by suite"
    : "definition matched by catalog hash";
}

function formatMs(value: number): string {
  return `${value.toLocaleString("en-US")} ms`;
}

// ---------------------------------------------------------------------------
// Case index + definition
// ---------------------------------------------------------------------------

function CaseIndex({
  definitions,
  selectedCaseId,
  onSelect,
}: {
  definitions: readonly CanonicalCaseDefinition[];
  selectedCaseId: string | undefined;
  onSelect: (caseId: string) => void;
}) {
  return (
    <div className="eval-proto-scroll">
      <table className="eval-table eval-proto-case-table">
        <thead>
          <tr>
            <th scope="col">Case</th>
            <th scope="col">Title</th>
            <th scope="col">Category</th>
            <th scope="col">Expected route</th>
          </tr>
        </thead>
        <tbody>
          {definitions.map((definition) => {
            const selected = definition.caseId === selectedCaseId;
            return (
              <tr key={definition.caseId} aria-current={selected ? "true" : undefined}>
                <th scope="row">
                  <button
                    type="button"
                    className="eval-proto-case-link"
                    aria-pressed={selected}
                    onClick={() => onSelect(definition.caseId)}
                  >
                    <code>{definition.caseId}</code>
                  </button>
                </th>
                <td>{definition.title}</td>
                <td>{definition.category}</td>
                <td>
                  <code>{definition.expectedTool ?? definition.routingKind}</code>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CaseDefinition({ definition }: { definition: CanonicalCaseDefinition }) {
  return (
    <Panel
      className="eval-proto-panel"
      title={definition.title}
      description={`${definition.caseId} · ${definition.suiteId} · suite v${definition.suiteVersion} · ${definition.category}`}
    >
      <div className="eval-proto-definition">
        <div className="eval-proto-definition-main">
          <EvidenceValue
            evidence={definition.prompt}
            renderValue={(prompt) => (
              <blockquote className="eval-proto-prompt">{prompt}</blockquote>
            )}
          />
          <p>
            <strong>Objective.</strong> {definition.objective}
          </p>
          <p>
            <strong>Expected behavior.</strong> {definition.expectedBehavior}
          </p>
          <p>
            <strong>Grading criteria.</strong>
          </p>
          <ul className="eval-proto-criteria">
            {definition.gradingCriteria.map((criterion) => (
              <li key={criterion}>{criterion}</li>
            ))}
          </ul>
          <p className="eval-muted">
            Definition bound by suite. September 14 runs matched it by catalog hash — their bound
            prompt shows as withheld · not_bound in the run detail below.
          </p>
        </div>
        <dl className="eval-proto-definition-meta">
          <div>
            <dt>Expected tool</dt>
            <dd>
              <code>{definition.expectedTool ?? "—"}</code>
            </dd>
          </div>
          <div>
            <dt>Routing</dt>
            <dd>{definition.routingKind}</dd>
          </div>
          <div>
            <dt>Required arguments</dt>
            <dd>
              {definition.requiredArguments ? (
                <code>{JSON.stringify(definition.requiredArguments)}</code>
              ) : (
                "no case-specific constraint"
              )}
            </dd>
          </div>
          <div>
            <dt>Forbidden tools</dt>
            <dd>
              {definition.forbiddenTools.length > 0
                ? definition.forbiddenTools.map((tool) => <code key={tool}>{tool}</code>)
                : "none declared"}
            </dd>
          </div>
          <div>
            <dt>Forbidden scopes</dt>
            <dd>
              {definition.forbiddenScopes.map((scope) => (
                <code key={scope}>{scope}</code>
              ))}
            </dd>
          </div>
        </dl>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Outcome matrix
// ---------------------------------------------------------------------------

function RunCaseDetail({
  run,
  definition,
}: {
  run: CanonicalRun;
  definition: CanonicalCaseDefinition;
}) {
  const attempts = caseAttempts(run, definition.caseId);
  return (
    <div className="eval-proto-detail">
      <div className="eval-proto-detail-meta">
        <span>
          bound prompt:{" "}
          {run.caseBinding === "bound_by_suite" ? (
            <EvidenceValue evidence={definition.prompt} renderValue={(prompt) => <q>{prompt}</q>} />
          ) : (
            <AvailabilityMark availability="withheld" reason="not_bound" />
          )}
        </span>
        <span>{caseBindingLabel(run)}</span>
        <span>{checkSourceLabel(run)}</span>
        {run.notes.map((note) => (
          <span className="eval-muted" key={note}>
            {note}
          </span>
        ))}
      </div>
      {attempts.length === 0 ? (
        <p className="eval-muted">No retained attempts for this case in this run.</p>
      ) : (
        <div className="eval-proto-scroll">
          <table className="eval-table eval-proto-attempt-table">
            <thead>
              <tr>
                <th scope="col">Rep</th>
                <th scope="col">Execution</th>
                <th scope="col">Verdict</th>
                <th scope="col">Checks · {run.checkSource}</th>
                <th scope="col">Duration</th>
                <th scope="col">Wall duration</th>
                <th scope="col">Tokens</th>
                <th scope="col">Failure categories</th>
                <th scope="col">Answer</th>
                <th scope="col">Tool calls</th>
              </tr>
            </thead>
            <tbody>
              {attempts.map((attempt) => (
                <tr key={`${run.runId}-${attempt.caseId}-rep${attempt.repetition}`}>
                  <th scope="row">{attempt.repetition}</th>
                  <td>
                    <ExecutionChip
                      execution={attempt.execution}
                      failureAttribution={attempt.failureAttribution}
                    />
                  </td>
                  <td>
                    <VerdictChip verdict={attempt.verdict} />
                  </td>
                  <td>
                    <EvidenceValue
                      evidence={attempt.checks}
                      renderValue={(checks) => (
                        <span className="eval-proto-checks">
                          {CHECK_NAMES.map((name) => (
                            <span className="eval-proto-check" key={name}>
                              <span className="eval-proto-check-name">{name}</span>
                              <CheckMark outcome={checks[name]} />
                            </span>
                          ))}
                        </span>
                      )}
                    />
                  </td>
                  <td>
                    <EvidenceValue evidence={attempt.durationMs} renderValue={formatMs} />
                  </td>
                  <td>
                    <EvidenceValue evidence={attempt.wallDurationMs} renderValue={formatMs} />
                  </td>
                  <td>
                    <EvidenceValue
                      evidence={attempt.tokenUsage}
                      renderValue={(usage) =>
                        `${usage.totalTokens.toLocaleString("en-US")} (${usage.inputTokens.toLocaleString("en-US")} in · ${usage.outputTokens.toLocaleString("en-US")} out)`
                      }
                    />
                  </td>
                  <td>
                    {attempt.failureCategories.length > 0
                      ? attempt.failureCategories.join(", ")
                      : "—"}
                  </td>
                  <td>
                    <EvidenceValue
                      evidence={attempt.answer}
                      renderValue={(answer) => <q>{answer}</q>}
                    />
                  </td>
                  <td>
                    <EvidenceValue
                      evidence={attempt.toolCalls}
                      renderValue={(calls) =>
                        calls.length === 0
                          ? "no tool calls"
                          : calls
                              .map((call) => `${call.name}${call.error ? " (error)" : ""}`)
                              .join(", ")
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RunMatrixRow({
  run,
  caseId,
  repetitions,
  totalColumns,
  open,
  onToggle,
  definition,
}: {
  run: CanonicalRun;
  caseId: string;
  repetitions: readonly number[];
  totalColumns: number;
  open: boolean;
  onToggle: () => void;
  definition: CanonicalCaseDefinition;
}) {
  const model = getModel(run.modelId);
  const attempts = caseAttempts(run, caseId);
  const outcome = caseOutcome(attempts);
  return (
    <Fragment>
      <tr>
        <th scope="row">
          <div className="eval-proto-run">
            {model ? <ModelAvatar model={model} /> : null}
            <div className="eval-proto-run-name">
              <a href={`#/prototype/models/${run.modelId}?run=${run.runId}`}>
                {model?.name ?? run.modelId}
              </a>
              <small>
                <code>{run.runId}</code>
                {` · ${run.startedAt.slice(0, 10)} · `}
                <code>{run.cohort.target}</code>
              </small>
              <span className="eval-proto-run-meta">
                <OriginTag origin={run.origin} />
                <HeadlineValue headline={headlineFor(run)} />
                <span className="eval-demo-label">{checkSourceLabel(run)}</span>
                <span className="eval-demo-label">{caseBindingLabel(run)}</span>
                {run.configuration.availability === "labels_only" && (
                  <span className="eval-demo-label">
                    {eligibilityText("labels_only_configuration")}
                  </span>
                )}
                {run.cohort.evidenceCategory !== "conformance" && (
                  <span className="eval-demo-label">{run.cohort.evidenceCategory}</span>
                )}
              </span>
            </div>
          </div>
        </th>
        {repetitions.map((repetition) => (
          <OutcomeMatrixCell
            key={repetition}
            attempt={attempts.find((attempt) => attempt.repetition === repetition)}
          />
        ))}
        <td className="eval-proto-case-result">
          <span className="lb-count">
            {outcome.passed}/{outcome.started}
          </span>
          {outcome.gaps.length > 0 && (
            <span className="eval-muted"> · {outcome.gaps.join(" · ")}</span>
          )}
        </td>
        <td>
          <button
            type="button"
            className="eval-proto-detail-toggle"
            aria-expanded={open}
            onClick={onToggle}
          >
            {open ? "hide" : "detail"}
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td className="eval-proto-detail-cell" colSpan={totalColumns}>
            <RunCaseDetail run={run} definition={definition} />
          </td>
        </tr>
      )}
    </Fragment>
  );
}

function WithdrawnMatrixRow({
  ref: withdrawn,
  totalColumns,
}: {
  ref: WithdrawnRunRef;
  totalColumns: number;
}) {
  const model = getModel(withdrawn.modelId);
  return (
    <tr>
      <th scope="row">
        <div className="eval-proto-run">
          {model ? <ModelAvatar model={model} /> : null}
          <div className="eval-proto-run-name">
            <span>{model?.name ?? withdrawn.modelId}</span>
            <small>
              <code>{withdrawn.runId}</code>
              {` · ${withdrawn.startedAt.slice(0, 10)}`}
            </small>
            <span className="eval-proto-run-meta">
              <OriginTag origin={withdrawn.origin} />
              <span className="eval-demo-label">withdrawn · {withdrawn.withdrawal.reason}</span>
            </span>
          </div>
        </div>
      </th>
      <td className="eval-proto-withdrawn" colSpan={totalColumns - 1}>
        {withdrawn.withdrawal.notice} Result bytes removed; the publication stays visible in history
        only.
      </td>
    </tr>
  );
}

function OutcomeMatrix({
  rows,
  definition,
}: {
  rows: readonly ExplorerRow[];
  definition: CanonicalCaseDefinition;
}) {
  const [openRuns, setOpenRuns] = useState<ReadonlySet<string>>(new Set());
  const maxRepetition = Math.max(
    1,
    ...rows.flatMap((row) =>
      row.kind === "run" ? caseAttempts(row.run, definition.caseId).map((a) => a.repetition) : [],
    ),
  );
  const repetitions = Array.from({ length: maxRepetition }, (_, index) => index + 1);
  const totalColumns = repetitions.length + 3;

  function toggleRun(runId: string) {
    setOpenRuns((current) => {
      const next = new Set(current);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  }

  if (rows.length === 0) {
    return (
      <div className="eval-proto-empty" role="status">
        <AvailabilityMark availability="not_retained" reason="no retained runs for this family" />
        <h3>No runs retained</h3>
        <p>No retained runs cover this family.</p>
      </div>
    );
  }

  return (
    <div className="eval-proto-scroll">
      <table className="eval-table eval-proto-matrix">
        <thead>
          <tr>
            <th scope="col">Run</th>
            {repetitions.map((repetition) => (
              <th scope="col" key={repetition}>
                Rep {repetition}
              </th>
            ))}
            <th scope="col">pass/started</th>
            <th scope="col">Evidence</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) =>
            row.kind === "run" ? (
              <RunMatrixRow
                key={row.run.runId}
                run={row.run}
                caseId={definition.caseId}
                repetitions={repetitions}
                totalColumns={totalColumns}
                open={openRuns.has(row.run.runId)}
                onToggle={() => toggleRun(row.run.runId)}
                definition={definition}
              />
            ) : (
              <WithdrawnMatrixRow key={row.ref.runId} ref={row.ref} totalColumns={totalColumns} />
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function PrototypeTaskExplorerPage({ family }: { family?: string }) {
  const [activeFamily, setActiveFamily] = useState<PrototypeFamily>(() => resolveFamily(family));
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);

  const definitions = caseDefinitionsForFamily(activeFamily);
  const selected =
    definitions.find((definition) => definition.caseId === selectedCaseId) ?? definitions[0];
  const rows = rowsForFamily(activeFamily);
  const measuredRuns = rows.filter(
    (row): row is ExplorerRow & { kind: "run" } =>
      row.kind === "run" && row.run.origin === "measured",
  );
  const syntheticRuns = rows.filter(
    (row): row is ExplorerRow & { kind: "run" } =>
      row.kind === "run" && row.run.origin === "synthetic",
  );
  const withdrawnCount = rows.length - measuredRuns.length - syntheticRuns.length;

  function changeFamily(next: PrototypeFamily) {
    setActiveFamily(next);
    setSelectedCaseId(null);
    window.location.hash = `#/prototype/tasks?family=${next}`;
  }

  return (
    <PageShell
      active="canary"
      footerNote="Prototype page. Counts come from the bundled artifacts; synthetic rows are labelled."
    >
      <div className="eval-container eval-proto-tasks">
        <PrototypeBanner />
        <section className="eval-hero eval-proto-hero" aria-labelledby="eval-proto-tasks-title">
          <p className="eval-eyebrow">Task evidence · {activeFamily}</p>
          <h1 className="eval-title" id="eval-proto-tasks-title">
            Tasks<span className="eval-dot">.</span>
          </h1>
          <p className="eval-description">
            Versioned case definitions and a model-by-repetition outcome matrix for every retained
            run. Each unavailable state keeps its own reason code — withheld, not retained, not
            recorded — and missing measurements are never zero-filled.
          </p>
        </section>

        <div className="eval-proto-toolbar">
          <FamilyTabs value={activeFamily} onChange={changeFamily} options={PROTOTYPE_FAMILIES} />
          <p className="eval-muted">
            {definitions.length} case definitions · {measuredRuns.length} measured runs
            {syntheticRuns.length > 0 ? ` · ${syntheticRuns.length} synthetic` : ""}
            {withdrawnCount > 0 ? ` · ${withdrawnCount} withdrawn` : ""}
          </p>
        </div>

        <Panel
          className="eval-proto-panel"
          title={`Case definitions · ${activeFamily}`}
          description={`${definitions.length} versioned definitions · ${definitions[0]?.suiteId ?? ""} v${definitions[0]?.suiteVersion ?? ""} · choose a case to inspect its outcomes`}
        >
          <CaseIndex
            definitions={definitions}
            selectedCaseId={selected?.caseId}
            onSelect={setSelectedCaseId}
          />
        </Panel>

        {selected ? <CaseDefinition definition={selected} /> : null}

        {activeFamily === "Portfolio" ? (
          <Panel className="eval-proto-panel" title="Measured evidence · Portfolio">
            <div className="eval-proto-empty" role="status">
              <AvailabilityMark
                availability="not_retained"
                reason="no measured Portfolio runs in the bundled artifacts"
              />
              <h3>No measured evidence</h3>
              <p>
                No retained Portfolio runs exist in the bundled artifacts — the suite is versioned
                but unmeasured. Only the case definitions above are shown; no runs are fabricated.
              </p>
            </div>
          </Panel>
        ) : selected ? (
          <Panel
            className="eval-proto-panel"
            title={`Outcome matrix · ${selected.caseId}`}
            description="Model × repetition — one cell per dispatched attempt. Expand a run for its per-attempt evidence; detail depth follows what the run retained."
          >
            <OutcomeMatrix rows={rows} definition={selected} />
          </Panel>
        ) : null}
      </div>
    </PageShell>
  );
}
