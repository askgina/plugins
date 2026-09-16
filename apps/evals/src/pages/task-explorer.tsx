// `#/tasks` — case-definition browser plus outcome matrix (Phase 4, decisions 7/9).
//
// Every figure traces to the canonical dataset: case definitions come from
// `caseDefinitionsForFamily`, matrix cells from `attemptsFor` on measured runs
// only (synthetic rows stay Storybook-only). Drilldown depth follows evidence —
// attempts render checks/durations/tokens where retained and availability marks
// where withheld or missing. The editorial column stays per decision 6.

import { useMemo, useState } from "react";
import { BookOpen, ListTree, Search, Shield } from "lucide-react";
import {
  CHECK_NAMES,
  canonicalCampaigns,
  PROTOTYPE_FAMILIES,
  type CanonicalAttempt,
  type CanonicalCaseDefinition,
  type CanonicalRun,
  type PrototypeFamily,
} from "../canonical/canonical";
import {
  attemptsFor,
  caseDefinitionsForFamily,
  cohortLabel,
  getCaseDefinition,
  getModel,
  runsForFamily,
  scoringCoverageFor,
} from "../canonical/selectors";
import {
  AvailabilityMark,
  CheckMark,
  CoverageChip,
  EvidenceValue,
  ExecutionChip,
  OutcomeMatrixCell,
  VerdictChip,
} from "../canonical/components";
import { FamilyTabs, Modal, ModelAvatar, PageShell } from "../components/eval-ui";
import { Button } from "../components/ui/button";
import { Separator } from "../components/ui/separator";
import "./task-explorer.css";

type EvidenceSection = "definition" | "tools" | "rubric" | "dataset";

function formatTime(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

/** Repetition slots for one case: the widest of cohort plan and observed attempts. */
function repetitionSlots(
  caseId: string,
  runs: readonly CanonicalRun[],
  attemptsByRun: ReadonlyMap<string, ReadonlyMap<string, readonly CanonicalAttempt[]>>,
): number {
  let slots = 0;
  for (const run of runs) {
    slots = Math.max(slots, run.cohort.repetitions);
    for (const attempt of attemptsByRun.get(run.runId)?.get(caseId) ?? []) {
      slots = Math.max(slots, attempt.repetition);
    }
  }
  return slots;
}

// ---------------------------------------------------------------------------
// Case card — versioned definition + run × repetition outcome matrix
// ---------------------------------------------------------------------------

function CaseCard({
  definition,
  runs,
  attemptsByRun,
  selected,
  onSelect,
  onInspect,
  onEvidence,
}: {
  definition: CanonicalCaseDefinition;
  runs: readonly CanonicalRun[];
  attemptsByRun: ReadonlyMap<string, ReadonlyMap<string, readonly CanonicalAttempt[]>>;
  selected: boolean;
  onSelect: () => void;
  onInspect: () => void;
  onEvidence: () => void;
}) {
  const slots = repetitionSlots(definition.caseId, runs, attemptsByRun);
  return (
    <article className={selected ? "task-case task-case-selected" : "task-case"}>
      <header className="task-case-head">
        <button
          type="button"
          className="task-case-title"
          aria-pressed={selected}
          onClick={onSelect}
        >
          {definition.title}
        </button>
        <div className="task-case-actions">
          <Button type="button" variant="secondary" size="sm" onClick={onInspect}>
            Inspect attempts
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={onEvidence}>
            <BookOpen aria-hidden="true" />
            Evidence
          </Button>
        </div>
      </header>
      <p className="task-case-id">
        <code>{definition.caseId}</code> · {definition.category} · suite{" "}
        <code>{definition.suiteId}</code> v{definition.suiteVersion}
      </p>
      <dl className="task-case-fields">
        <div>
          <dt>Objective</dt>
          <dd>{definition.objective}</dd>
        </div>
        <div>
          <dt>Expected behavior</dt>
          <dd>{definition.expectedBehavior}</dd>
        </div>
        <div>
          <dt>Grading criteria</dt>
          <dd>
            <ul className="task-criteria">
              {definition.gradingCriteria.map((criterion) => (
                <li key={criterion}>{criterion}</li>
              ))}
            </ul>
          </dd>
        </div>
        <div>
          <dt>Prompt</dt>
          <dd>
            <EvidenceValue
              evidence={definition.prompt}
              renderValue={(prompt) => (
                <blockquote className="task-case-prompt">{prompt}</blockquote>
              )}
            />
          </dd>
        </div>
        <div>
          <dt>Routing</dt>
          <dd>
            {definition.routingKind}
            {definition.expectedTool !== null ? (
              <>
                {" "}
                → <code>{definition.expectedTool}</code>
              </>
            ) : null}
            {definition.requiredArguments !== null ? (
              <>
                {" "}
                · args <code>{JSON.stringify(definition.requiredArguments)}</code>
              </>
            ) : null}
          </dd>
        </div>
        {definition.forbiddenTools.length > 0 ? (
          <div>
            <dt>Forbidden tools</dt>
            <dd>
              {definition.forbiddenTools.map((tool) => (
                <code key={tool} className="task-forbidden">
                  {tool}
                </code>
              ))}
            </dd>
          </div>
        ) : null}
        {definition.forbiddenScopes.length > 0 ? (
          <div>
            <dt>Forbidden scopes</dt>
            <dd>
              {definition.forbiddenScopes.map((scope) => (
                <code key={scope} className="task-forbidden">
                  {scope}
                </code>
              ))}
            </dd>
          </div>
        ) : null}
      </dl>
      {runs.length > 0 ? (
        <div className="task-table-scroll">
          <table className="eval-table">
            <thead>
              <tr>
                <th scope="col">Run</th>
                {Array.from({ length: slots }, (_, index) => (
                  <th scope="col" key={index}>
                    rep {index + 1}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <MatrixRunRow
                  key={run.runId}
                  run={run}
                  caseAttempts={attemptsByRun.get(run.runId)?.get(definition.caseId) ?? []}
                  slots={slots}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="eval-muted">
          No measured run has executed this case — the definition is published but unexercised.
        </p>
      )}
    </article>
  );
}

function MatrixRunRow({
  run,
  caseAttempts,
  slots,
}: {
  run: CanonicalRun;
  caseAttempts: readonly CanonicalAttempt[];
  slots: number;
}) {
  const model = getModel(run.modelId);
  return (
    <tr>
      <th scope="row" className="task-run-cell">
        <span className="task-run-name">
          {model ? <ModelAvatar model={model} /> : null}
          {model?.name ?? run.modelId}
        </span>
        <span className="task-run-sub">
          <code>{run.runId}</code> · {run.startedAt.slice(0, 10)}
        </span>
        <span className="task-run-sub">{cohortLabel(run.cohort)}</span>
        <span className="task-run-chips">
          <span className="eval-demo-label">checks {run.checkSource}</span>
          <span className="eval-demo-label">{run.caseBinding}</span>
          {scoringCoverageFor(run) !== "complete" ? <CoverageChip run={run} /> : null}
          {run.attempts.availability !== "available" ? (
            <AvailabilityMark availability={run.attempts.availability} reason="attempt detail" />
          ) : null}
        </span>
      </th>
      {Array.from({ length: slots }, (_, index) => (
        <OutcomeMatrixCell
          key={index}
          attempt={caseAttempts.find((attempt) => attempt.repetition === index + 1)}
        />
      ))}
    </tr>
  );
}

/** Attempts exist for a case id with no bundled definition (catalog-sha binding). */
function UnboundCaseCard({
  caseId,
  runs,
  attemptsByRun,
  onInspect,
}: {
  caseId: string;
  runs: readonly CanonicalRun[];
  attemptsByRun: ReadonlyMap<string, ReadonlyMap<string, readonly CanonicalAttempt[]>>;
  onInspect: () => void;
}) {
  const slots = repetitionSlots(caseId, runs, attemptsByRun);
  return (
    <article className="task-case">
      <header className="task-case-head">
        <span className="task-case-title">
          <code>{caseId}</code>
        </span>
        <div className="task-case-actions">
          <Button type="button" variant="secondary" size="sm" onClick={onInspect}>
            Inspect attempts
          </Button>
        </div>
      </header>
      <p className="eval-muted">
        Attempts reference this case id, but no published definition is bundled — the run was bound
        by catalog hash.
      </p>
      <div className="task-table-scroll">
        <table className="eval-table">
          <thead>
            <tr>
              <th scope="col">Run</th>
              {Array.from({ length: slots }, (_, index) => (
                <th scope="col" key={index}>
                  rep {index + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <MatrixRunRow
                key={run.runId}
                run={run}
                caseAttempts={attemptsByRun.get(run.runId)?.get(caseId) ?? []}
                slots={slots}
              />
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Attempt drilldown — depth follows evidence
// ---------------------------------------------------------------------------

function AttemptDrilldown({
  caseId,
  definition,
  runs,
  attemptsByRun,
}: {
  caseId: string;
  definition: CanonicalCaseDefinition | undefined;
  runs: readonly CanonicalRun[];
  attemptsByRun: ReadonlyMap<string, ReadonlyMap<string, readonly CanonicalAttempt[]>>;
}) {
  return (
    <div className="task-drilldown">
      {definition !== undefined ? (
        <p className="eval-muted">
          {definition.title} · <code>{definition.caseId}</code> · suite{" "}
          <code>{definition.suiteId}</code> v{definition.suiteVersion}
        </p>
      ) : (
        <p className="eval-muted">
          <code>{caseId}</code> has no published case definition in this bundle.
        </p>
      )}
      {runs.map((run) => {
        const model = getModel(run.modelId);
        const attempts = (attemptsByRun.get(run.runId)?.get(caseId) ?? [])
          .slice()
          .sort((left, right) => left.repetition - right.repetition);
        return (
          <section key={run.runId} className="task-drilldown-run">
            <h3>
              {model ? <ModelAvatar model={model} /> : null}
              {model?.name ?? run.modelId} · <code>{run.runId}</code>
            </h3>
            <p className="task-run-sub">
              {run.startedAt.slice(0, 10)} · {cohortLabel(run.cohort)}
              {canonicalCampaigns.find((campaign) => campaign.campaignId === run.campaignId)
                ?.harness !== undefined
                ? ` · ${canonicalCampaigns.find((campaign) => campaign.campaignId === run.campaignId)!.harness}`
                : ""}
            </p>
            <div className="task-run-chips">
              <span className="eval-demo-label">checks {run.checkSource}</span>
              <span className="eval-demo-label">{run.caseBinding}</span>
              <CoverageChip run={run} />
              {run.withheldFields.map((field) => (
                <AvailabilityMark
                  key={field.field}
                  availability="withheld"
                  reason={`${field.field} · ${field.reason}`}
                />
              ))}
            </div>
            {run.attempts.availability !== "available" ? (
              <p>
                <AvailabilityMark
                  availability={run.attempts.availability}
                  reason="attempt detail"
                />
              </p>
            ) : attempts.length === 0 ? (
              <p className="eval-muted">This run did not execute this case.</p>
            ) : (
              attempts.map((attempt) => (
                <AttemptDetail key={attempt.repetition} attempt={attempt} />
              ))
            )}
          </section>
        );
      })}
    </div>
  );
}

function AttemptDetail({ attempt }: { attempt: CanonicalAttempt }) {
  const checks = attempt.checks;
  return (
    <article className="task-attempt">
      <header className="task-attempt-head">
        <span className="task-attempt-rep">rep {attempt.repetition}</span>
        {attempt.execution === "completed" ? (
          <VerdictChip verdict={attempt.verdict} />
        ) : (
          <ExecutionChip
            execution={attempt.execution}
            failureAttribution={attempt.failureAttribution}
          />
        )}
        <span className="eval-demo-label">checks {attempt.checkSource}</span>
      </header>
      {attempt.failureCategories.length > 0 ? (
        <p className="task-attempt-categories">
          failure categories: {attempt.failureCategories.join(", ")}
        </p>
      ) : null}
      <div className="task-attempt-checks">
        {checks.availability === "available" ? (
          CHECK_NAMES.map((name) => (
            <span key={name} className="task-check">
              <span className="task-check-name">{name}</span>
              <CheckMark outcome={checks.value[name]} />
            </span>
          ))
        ) : (
          <AvailabilityMark availability={checks.availability} reason="per-attempt checks" />
        )}
      </div>
      <dl className="task-attempt-metrics">
        <div>
          <dt>Duration</dt>
          <dd>
            <EvidenceValue evidence={attempt.durationMs} renderValue={(ms) => formatTime(ms)} />
          </dd>
        </div>
        <div>
          <dt>Wall duration</dt>
          <dd>
            <EvidenceValue evidence={attempt.wallDurationMs} renderValue={(ms) => formatTime(ms)} />
          </dd>
        </div>
        <div>
          <dt>Tokens</dt>
          <dd>
            <EvidenceValue
              evidence={attempt.tokenUsage}
              renderValue={(tokens) =>
                `in ${tokens.inputTokens.toLocaleString("en-US")} · out ${tokens.outputTokens.toLocaleString("en-US")} · total ${tokens.totalTokens.toLocaleString("en-US")}`
              }
            />
          </dd>
        </div>
      </dl>
      <div className="task-attempt-field">
        <h4>Answer</h4>
        <EvidenceValue
          evidence={attempt.answer}
          renderValue={(answer) => <blockquote className="task-case-prompt">{answer}</blockquote>}
        />
      </div>
      <div className="task-attempt-field">
        <h4>Tool calls</h4>
        <EvidenceValue
          evidence={attempt.toolCalls}
          renderValue={(calls) => (
            <ul className="task-criteria">
              {calls.map((call, index) => (
                <li key={index}>
                  <code>{call.name}</code>
                  {call.error ? <span className="eval-demo-label">error</span> : null}
                </li>
              ))}
            </ul>
          )}
        />
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Evidence modal — CanonicalCaseDefinition fields
// ---------------------------------------------------------------------------

const evidenceLabels: Record<EvidenceSection, string> = {
  definition: "Case definition",
  tools: "Expected tool set",
  rubric: "Grading criteria",
  dataset: "Prompt & expected call",
};

function EvidenceBody({
  definition,
  section,
}: {
  definition: CanonicalCaseDefinition;
  section: EvidenceSection;
}) {
  return (
    <div className="task-evidence-body">
      <h3>{evidenceLabels[section]}</h3>
      <p className="eval-muted">
        {definition.family} · <code>{definition.caseId}</code> · suite{" "}
        <code>{definition.suiteId}</code> v{definition.suiteVersion}
      </p>
      {section === "definition" ? (
        <>
          <h4>Objective</h4>
          <p>{definition.objective}</p>
          <h4>Expected behavior</h4>
          <p>{definition.expectedBehavior}</p>
          <h4>Category</h4>
          <p>{definition.category}</p>
        </>
      ) : null}
      {section === "tools" ? (
        <>
          <h4>Expected tool</h4>
          <p>
            {definition.expectedTool !== null ? (
              <code>{definition.expectedTool}</code>
            ) : (
              "none declared"
            )}{" "}
            · routing {definition.routingKind}
          </p>
          {definition.requiredArguments !== null ? (
            <>
              <h4>Required arguments</h4>
              <pre className="eval-code" role="region" aria-label="Required arguments" tabIndex={0}>
                <code>{JSON.stringify(definition.requiredArguments, null, 2)}</code>
              </pre>
            </>
          ) : null}
          <h4>Forbidden tools</h4>
          {definition.forbiddenTools.length > 0 ? (
            <ul>
              {definition.forbiddenTools.map((tool) => (
                <li key={tool}>
                  <code>{tool}</code>
                </li>
              ))}
            </ul>
          ) : (
            <p>none</p>
          )}
          <h4>Forbidden scopes</h4>
          <ul>
            {definition.forbiddenScopes.map((scope) => (
              <li key={scope}>
                <code>{scope}</code>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {section === "rubric" ? (
        <ul>
          {definition.gradingCriteria.map((criterion) => (
            <li key={criterion}>{criterion}</li>
          ))}
        </ul>
      ) : null}
      {section === "dataset" ? (
        <>
          <h4>Prompt</h4>
          <EvidenceValue
            evidence={definition.prompt}
            renderValue={(prompt) => <blockquote>{prompt}</blockquote>}
          />
          <h4>Expected call</h4>
          <p>
            {definition.expectedTool !== null ? (
              <code>{definition.expectedTool}</code>
            ) : (
              "none declared"
            )}
            {definition.requiredArguments !== null ? (
              <>
                {" "}
                with <code>{JSON.stringify(definition.requiredArguments)}</code>
              </>
            ) : null}
          </p>
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editorial column + evidence sidebar (decision 6)
// ---------------------------------------------------------------------------

function EditorialColumn() {
  return (
    <aside className="task-editorial">
      <h1 className="task-editorial-title">
        <span>Every score,</span>
        <span>
          backed by evidence
          <span className="task-red-dot" aria-hidden="true" />
        </span>
      </h1>
      <p className="eval-description task-editorial-copy">
        Explore the case definitions, outcomes, and grading criteria behind every task.
      </p>
      <figure className="task-watercolor" aria-hidden="true">
        <img
          className="task-watercolor-image"
          src="/images/hero-watercolor-landscape.webp"
          alt=""
        />
      </figure>
      <blockquote className="eval-quote task-editorial-quote">
        "A benchmark should show the work, not just crown a winner."
      </blockquote>
    </aside>
  );
}

function EvidenceSidebar({
  selectedCase,
  onOpen,
}: {
  selectedCase: CanonicalCaseDefinition | undefined;
  onOpen: (section: EvidenceSection) => void;
}) {
  return (
    <aside className="task-evidence" aria-labelledby="task-evidence-heading">
      <h2 id="task-evidence-heading">What this task measures</h2>
      <ul className="task-evidence-points">
        <li>
          <Search size={16} aria-hidden="true" />
          <div>
            <strong>Tools.</strong> The agent may call the listed read tools and nothing else.
          </div>
        </li>
        <li>
          <ListTree size={16} aria-hidden="true" />
          <div>
            <strong>Grounded.</strong> The answer has to cite fields that came back. Missing quotes
            stay missing.
          </div>
        </li>
        <li>
          <Shield size={16} aria-hidden="true" />
          <div>
            <strong>Strict read-only.</strong> No orders, swaps, transfers, or schedule writes. A
            blank price is a limitation, not a trade.
          </div>
        </li>
      </ul>
      <Separator className="task-evidence-rule" />
      <div className="task-evidence-links">
        <p className="task-evidence-lead">
          Evidence &amp; provenance
          {selectedCase !== undefined ? (
            <>
              {" "}
              — <code>{selectedCase.caseId}</code>
            </>
          ) : null}
        </p>
        <nav className="task-provenance" aria-label="Case evidence">
          <Button
            type="button"
            variant="link"
            disabled={selectedCase === undefined}
            onClick={() => onOpen("definition")}
          >
            Case definition
          </Button>
          <Button
            type="button"
            variant="link"
            disabled={selectedCase === undefined}
            onClick={() => onOpen("tools")}
          >
            Expected tool set
          </Button>
          <Button
            type="button"
            variant="link"
            disabled={selectedCase === undefined}
            onClick={() => onOpen("rubric")}
          >
            Grading criteria
          </Button>
          <Button
            type="button"
            variant="link"
            disabled={selectedCase === undefined}
            onClick={() => onOpen("dataset")}
          >
            Prompt &amp; expected call
          </Button>
        </nav>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function TaskExplorerPage({
  initialFamily = "Spot",
  initialCaseId,
  initialInspectCaseId,
  initialEvidenceSection,
}: {
  initialFamily?: PrototypeFamily;
  initialCaseId?: string;
  initialInspectCaseId?: string;
  initialEvidenceSection?: EvidenceSection;
}) {
  const [family, setFamily] = useState<PrototypeFamily>(initialFamily);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(initialCaseId ?? null);
  const [inspectCaseId, setInspectCaseId] = useState<string | null>(initialInspectCaseId ?? null);
  const [evidenceSection, setEvidenceSection] = useState<EvidenceSection | null>(
    initialEvidenceSection ?? null,
  );

  const definitions = useMemo(() => caseDefinitionsForFamily(family), [family]);
  // Measured runs only — synthetic rows never render on app pages (decision 9).
  const runs = useMemo(
    () => runsForFamily(family).filter((run) => run.origin === "measured"),
    [family],
  );

  // Attempts indexed run → case for matrix cells and drilldown.
  const attemptsByRun = useMemo(() => {
    const byRun = new Map<string, Map<string, CanonicalAttempt[]>>();
    for (const run of runs) {
      const byCase = new Map<string, CanonicalAttempt[]>();
      for (const attempt of attemptsFor(run)) {
        const list = byCase.get(attempt.caseId) ?? [];
        list.push(attempt);
        byCase.set(attempt.caseId, list);
      }
      byRun.set(run.runId, byCase);
    }
    return byRun;
  }, [runs]);

  // Attempts on case ids with no published definition still surface.
  const unboundCaseIds = useMemo(() => {
    const defined = new Set(definitions.map((definition) => definition.caseId));
    const ids = new Set<string>();
    for (const byCase of attemptsByRun.values()) {
      for (const caseId of byCase.keys()) {
        if (!defined.has(caseId)) ids.add(caseId);
      }
    }
    return [...ids].sort();
  }, [definitions, attemptsByRun]);

  const selectedCase =
    definitions.find((definition) => definition.caseId === selectedCaseId) ?? definitions[0];
  const inspectDefinition =
    inspectCaseId === null
      ? undefined
      : (definitions.find((definition) => definition.caseId === inspectCaseId) ??
        getCaseDefinition(inspectCaseId));

  function changeFamily(next: PrototypeFamily) {
    setFamily(next);
    setSelectedCaseId(null);
    setInspectCaseId(null);
    setEvidenceSection(null);
  }

  function openEvidence(caseId: string, section: EvidenceSection) {
    setSelectedCaseId(caseId);
    setEvidenceSection(section);
  }

  return (
    <PageShell active="tasks">
      <div className="task-explorer">
        <EditorialColumn />
        <section className="task-main" aria-labelledby="task-main-heading">
          <div className="task-toolbar">
            <FamilyTabs value={family} onChange={changeFamily} options={PROTOTYPE_FAMILIES} />
            <p className="task-toolbar-note">
              {definitions.length} case definition{definitions.length === 1 ? "" : "s"} ·{" "}
              {runs.length} measured run{runs.length === 1 ? "" : "s"}
            </p>
          </div>
          <p className="eval-eyebrow">
            {family} · case definitions and measured outcomes — unranked, evidence-first
          </p>
          <h2 id="task-main-heading" className="task-prompt-title">
            {family} cases
          </h2>
          {runs.length === 0 ? (
            <div className="task-empty">
              <p className="task-empty-title">No measured evidence for {family}</p>
              <p className="eval-muted">
                The {family} suite is published —{" "}
                {definitions.length > 0
                  ? `${definitions.length} case definition${definitions.length === 1 ? "" : "s"} below —`
                  : "but no case definitions are bundled yet —"}{" "}
                and no measured run has executed it. Outcome cells appear once a measured run
                exists.
              </p>
            </div>
          ) : null}
          {definitions.length === 0 ? (
            <div className="task-empty">
              <p className="task-empty-title">No case definitions for {family}</p>
              <p className="eval-muted">
                No versioned case definitions are bundled for this family.
              </p>
            </div>
          ) : (
            definitions.map((definition) => (
              <CaseCard
                key={definition.caseId}
                definition={definition}
                runs={runs}
                attemptsByRun={attemptsByRun}
                selected={selectedCase?.caseId === definition.caseId}
                onSelect={() => setSelectedCaseId(definition.caseId)}
                onInspect={() => setInspectCaseId(definition.caseId)}
                onEvidence={() => openEvidence(definition.caseId, "definition")}
              />
            ))
          )}
          {unboundCaseIds.map((caseId) => (
            <UnboundCaseCard
              key={caseId}
              caseId={caseId}
              runs={runs}
              attemptsByRun={attemptsByRun}
              onInspect={() => setInspectCaseId(caseId)}
            />
          ))}
        </section>
        <EvidenceSidebar
          selectedCase={selectedCase}
          onOpen={(section) => {
            if (selectedCase !== undefined) openEvidence(selectedCase.caseId, section);
          }}
        />
      </div>
      <Modal
        title={inspectCaseId !== null ? `Inspect attempts · ${inspectCaseId}` : "Inspect attempts"}
        description="Measured attempts only. Missing checks, durations, and tokens render as their availability state."
        open={inspectCaseId !== null}
        onClose={() => setInspectCaseId(null)}
      >
        {inspectCaseId !== null ? (
          <AttemptDrilldown
            caseId={inspectCaseId}
            definition={inspectDefinition}
            runs={runs}
            attemptsByRun={attemptsByRun}
          />
        ) : null}
      </Modal>
      <Modal
        title="Case evidence"
        description="Versioned case definition from the canonical suite — not a measured result."
        open={evidenceSection !== null && selectedCase !== undefined}
        onClose={() => setEvidenceSection(null)}
      >
        {evidenceSection !== null && selectedCase !== undefined ? (
          <EvidenceBody definition={selectedCase} section={evidenceSection} />
        ) : null}
      </Modal>
    </PageShell>
  );
}
