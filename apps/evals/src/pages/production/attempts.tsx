import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowUpRight, BookOpen, Search, X } from "lucide-react";
import type {
  PublicEvalAttemptSummary,
  PublicEvalCheckVerdict,
  PublicEvalEvidenceAvailability,
  PublicEvalFailureCategory,
} from "@askgina/contracts";
import { Panel } from "../../components/eval-ui";
import { MetricValue } from "../../components/public-comparison-ui";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  PUBLIC_DIMENSION_DEFINITIONS,
  type PublicComparisonCatalog,
  type PublicComparisonCohort,
  type PublicComparisonRow,
} from "../../lib/public-comparison";
import type { PublicComparisonState } from "../../lib/use-public-comparison";
import {
  attemptsHref,
  CandidateIdentity,
  CoverageBadge,
  findProductionRun,
  formatProductionDate,
  ProductionHero,
  ProductionLoadState,
  ProductionNotice,
  ProductionShell,
  runHref,
} from "./shared";
import "./attempts.css";

export type AttemptVerdictFilter = "all" | "pass" | "fail";

const INTEGER = new Intl.NumberFormat("en-US");
const SECONDS = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const CASE_ORDER = new Intl.Collator("en-US", { numeric: true, sensitivity: "base" });

const VERDICT_FILTERS: readonly { id: AttemptVerdictFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "pass", label: "Pass" },
  { id: "fail", label: "Fail" },
];

const CHECK_VERDICT_LABELS: Record<PublicEvalCheckVerdict, string> = {
  pass: "Pass",
  fail: "Fail",
  not_applicable: "Not applicable",
};

const FAILURE_CATEGORY_LABELS: Record<PublicEvalFailureCategory, string> = {
  routing_mismatch: "Routing mismatch",
  argument_mismatch: "Argument mismatch",
  safety_violation: "Safety violation",
  trial_or_tool_failure: "Trial or tool failure",
  skill_activation_mismatch: "Skill activation mismatch",
};

const UNAVAILABLE_EVIDENCE: Record<
  Exclude<PublicEvalEvidenceAvailability, "available">,
  { title: string; description: string }
> = {
  aggregate_only: {
    title: "Aggregate only",
    description:
      "This publication contains aggregate summaries only. Individual attempts and case-level verdicts cannot be reconstructed from those totals.",
  },
  not_retained: {
    title: "Attempt detail not retained",
    description:
      "Individual attempt summaries were not retained in this public record. The run summary shows which aggregate measurements remain available.",
  },
  withheld: {
    title: "Attempt detail withheld",
    description:
      "Attempt details are withheld from the public record. This explorer does not retrieve private evidence. The run summary shows the approved aggregate measurements.",
  },
  not_evaluated: {
    title: "Attempt detail not evaluated",
    description:
      "This publication marks attempt detail as not evaluated. There are no public attempt summaries to inspect.",
  },
  not_applicable: {
    title: "Attempt detail not applicable",
    description:
      "Attempt-level detail does not apply to this publication, so there are no per-attempt records to show.",
  },
};

function formatDuration(durationMs: number): string {
  return durationMs >= 1000
    ? `${SECONDS.format(durationMs / 1000)}s`
    : `${INTEGER.format(durationMs)}ms`;
}

function compareAttempts(left: PublicEvalAttemptSummary, right: PublicEvalAttemptSummary): number {
  return (
    CASE_ORDER.compare(left.caseId, right.caseId) ||
    (left.caseId < right.caseId ? -1 : left.caseId > right.caseId ? 1 : 0) ||
    left.repetition - right.repetition ||
    (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
  );
}

function matchesSearch(attempt: PublicEvalAttemptSummary, needle: string): boolean {
  if (needle === "") return true;
  if (attempt.caseId.toLowerCase().includes(needle) || attempt.id.toLowerCase().includes(needle)) {
    return true;
  }
  return attempt.failureCategories.some(
    (category) =>
      category.includes(needle) || FAILURE_CATEGORY_LABELS[category].toLowerCase().includes(needle),
  );
}

function cohortLabel(cohort: PublicComparisonCohort): string {
  const { suiteId, suiteVersion, fixtureVersion, target, accountClass, repetitions } =
    cohort.conditions;
  return `${suiteId} v${suiteVersion} · fixtures v${fixtureVersion} · ${target} · ${accountClass} · ${repetitions} repetitions`;
}

function VerdictBadge({ verdict }: { verdict: PublicEvalAttemptSummary["verdict"] }) {
  return (
    <span
      className={`prod-badge ${verdict === "pass" ? "prod-badge--success" : "prod-badge--warning"} prod-attempts-verdict prod-attempts-verdict--${verdict}`}
    >
      {verdict === "pass" ? "Pass" : "Fail"}
    </span>
  );
}

function TokenCell({ usage }: { usage: PublicEvalAttemptSummary["tokenUsage"] }) {
  if (usage === null) {
    return (
      <span className="eval-metric-unavailable" title="This attempt has no retained token usage">
        Not retained
      </span>
    );
  }
  return (
    <span className="eval-metric-value">
      <strong>{INTEGER.format(usage.totalTokens)}</strong>
      <small>
        {INTEGER.format(usage.inputTokens)} in · {INTEGER.format(usage.outputTokens)} out
      </small>
    </span>
  );
}

function FailureCategories({
  categories,
  emptyLabel,
}: {
  categories: readonly PublicEvalFailureCategory[];
  emptyLabel: string;
}) {
  if (categories.length === 0) return <span className="prod-muted">{emptyLabel}</span>;
  return (
    <ul className="prod-attempts-categories" aria-label="Failure categories">
      {categories.map((category) => (
        <li key={category} className="prod-badge prod-badge--warning">
          {FAILURE_CATEGORY_LABELS[category]}
        </li>
      ))}
    </ul>
  );
}

function RunSelector({
  catalog,
  value,
  onChange,
}: {
  catalog: PublicComparisonCatalog;
  value: string;
  onChange: (publicationId: string) => void;
}) {
  const id = useId();
  return (
    <label className="prod-select-field prod-attempts-field prod-attempts-field--run" htmlFor={id}>
      <span>Run</span>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        {catalog.cohorts.map((cohort) => (
          <optgroup key={cohort.id} label={cohortLabel(cohort)}>
            {cohort.rows.map((row) => (
              <option key={row.publicationId} value={row.publicationId}>
                {row.model} · {row.candidate}
                {row.reasoning === null ? "" : ` · ${row.reasoning}`} · {row.publicationId}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

function RunContext({ cohort, row }: { cohort: PublicComparisonCohort; row: PublicComparisonRow }) {
  return (
    <div className="prod-attempts-context">
      <CandidateIdentity row={row} />
      <dl className="prod-attempts-context-facts">
        <div>
          <dt>Benchmark</dt>
          <dd>{cohortLabel(cohort)}</dd>
        </div>
        <div>
          <dt>Coverage</dt>
          <dd>
            <CoverageBadge row={row} />{" "}
            <span className="prod-muted">
              {INTEGER.format(row.counts.attempts.total)} of{" "}
              {INTEGER.format(row.coverage.plannedAttempts)} planned attempts observed
            </span>
          </dd>
        </div>
        <div>
          <dt>Published</dt>
          <dd>
            {formatProductionDate(row.publishedAt)} UTC · current revision{" "}
            <code className="prod-attempts-mono">{row.revisionId}</code>
          </dd>
        </div>
        <div>
          <dt>Publication</dt>
          <dd>
            <code className="prod-attempts-mono">{row.publicationId}</code>
          </dd>
        </div>
        <div>
          <dt>Configuration</dt>
          <dd>
            {row.configuration.availability === "pinned" ? (
              <>
                Pinned ·{" "}
                <code className="prod-attempts-mono">{row.configuration.pinnedSha256}</code>
              </>
            ) : (
              <span className="prod-muted">Labels only. No configuration pin was retained.</span>
            )}
          </dd>
        </div>
      </dl>
      <div className="prod-attempts-context-actions">
        <a className="prod-inline-link" href={runHref(row.publicationId)}>
          Open run summary <ArrowUpRight size={14} aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}

function RunSummary({ row, retained }: { row: PublicComparisonRow; retained: number | null }) {
  return (
    <dl className="prod-attempts-summary" aria-label="Run summary">
      <div>
        <dt>Public attempt summaries</dt>
        <dd>
          {retained === null ? (
            <span className="eval-metric-unavailable">Unavailable</span>
          ) : (
            <span className="eval-metric-value">
              <strong>{INTEGER.format(retained)}</strong>
              <small>of {INTEGER.format(row.counts.attempts.total)} observed</small>
            </span>
          )}
        </dd>
      </div>
      <div>
        <dt>Verdicts</dt>
        <dd>
          <span className="eval-metric-value">
            <strong>
              <span className="prod-attempts-verdict--pass">
                {INTEGER.format(row.counts.attempts.passed)}
              </span>
              {" / "}
              <span className="prod-attempts-verdict--fail">
                {INTEGER.format(row.counts.attempts.failed)}
              </span>
            </strong>
            <small>passed / failed · {INTEGER.format(row.counts.cases.total)} observed cases</small>
          </span>
        </dd>
      </div>
      <div>
        <dt>Pass rate</dt>
        <dd>
          <MetricValue metric={row.metrics.passRate} />
        </dd>
      </div>
      <div>
        <dt>Latency p50</dt>
        <dd>
          <MetricValue metric={row.metrics.latencyP50} />
        </dd>
      </div>
      <div>
        <dt>Token usage</dt>
        <dd>
          <MetricValue metric={row.metrics.tokenUsage} />
          {row.metrics.tokenUsage.availability === "available" && (
            <small className="prod-muted">
              {INTEGER.format(row.metrics.tokenUsage.sampleCount)} of{" "}
              {INTEGER.format(row.counts.attempts.total)} observed attempts have retained usage.
              Missing usage is excluded.
            </small>
          )}
        </dd>
      </div>
    </dl>
  );
}

function AttemptDetail({
  attempt,
  row,
  detailId,
  headingRef,
  onClose,
}: {
  attempt: PublicEvalAttemptSummary;
  row: PublicComparisonRow;
  detailId: string;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  onClose: () => void;
}) {
  const headingId = useId();
  return (
    <aside id={detailId} className="prod-attempts-detail" aria-labelledby={headingId}>
      <div className="prod-attempts-detail-heading">
        <div>
          <p className="prod-kicker">Selected attempt</p>
          <h2 id={headingId} ref={headingRef} tabIndex={-1}>
            Case {attempt.caseId} · repetition {INTEGER.format(attempt.repetition)}
          </h2>
        </div>
        <Button variant="ghost" size="icon" aria-label="Close attempt detail" onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </Button>
      </div>

      <div className="prod-attempts-detail-verdict">
        <VerdictBadge verdict={attempt.verdict} />
        <span className="prod-muted">
          {formatDuration(attempt.durationMs)} · {INTEGER.format(attempt.durationMs)} ms recorded
        </span>
      </div>

      <section className="prod-attempts-detail-section" aria-label="Check verdicts">
        <h3>Checks</h3>
        <ul className="prod-attempts-checks">
          {PUBLIC_DIMENSION_DEFINITIONS.map((dimension) => {
            const verdict = attempt.checks[dimension.id];
            return (
              <li
                key={dimension.id}
                className={`prod-attempts-check prod-attempts-check--${verdict}`}
              >
                <span>{dimension.label}</span>
                <strong>{CHECK_VERDICT_LABELS[verdict]}</strong>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="prod-attempts-detail-section" aria-label="Failure categories">
        <h3>Failure categories</h3>
        <FailureCategories
          categories={attempt.failureCategories}
          emptyLabel="None recorded. Every evaluated check passed."
        />
      </section>

      <section className="prod-attempts-detail-section" aria-label="Measurements">
        <h3>Measurements</h3>
        <dl className="prod-attempts-facts">
          <div>
            <dt>Duration</dt>
            <dd>{formatDuration(attempt.durationMs)}</dd>
          </div>
          {attempt.tokenUsage === null ? (
            <div>
              <dt>Token usage</dt>
              <dd>
                <span className="eval-metric-unavailable">Not retained</span>
                <small className="prod-muted">
                  No token usage was retained for this attempt. It does not contribute to the run
                  token totals.
                </small>
              </dd>
            </div>
          ) : (
            <>
              <div>
                <dt>Input tokens</dt>
                <dd>{INTEGER.format(attempt.tokenUsage.inputTokens)}</dd>
              </div>
              <div>
                <dt>Output tokens</dt>
                <dd>{INTEGER.format(attempt.tokenUsage.outputTokens)}</dd>
              </div>
              <div>
                <dt>Total tokens</dt>
                <dd>{INTEGER.format(attempt.tokenUsage.totalTokens)}</dd>
              </div>
            </>
          )}
        </dl>
      </section>

      <section className="prod-attempts-detail-section" aria-label="Identity">
        <h3>Identity</h3>
        <dl className="prod-attempts-facts">
          <div>
            <dt>Attempt</dt>
            <dd>
              <code className="prod-attempts-mono">{attempt.id}</code>
            </dd>
          </div>
          <div>
            <dt>Run</dt>
            <dd>
              <code className="prod-attempts-mono">{attempt.runId}</code>
            </dd>
          </div>
          <div>
            <dt>Publication</dt>
            <dd>
              <code className="prod-attempts-mono">{row.publicationId}</code>
            </dd>
          </div>
          <div>
            <dt>Validity</dt>
            <dd>
              {attempt.validity === "valid" ? "Valid" : attempt.validity} · no replacement recorded
            </dd>
          </div>
        </dl>
      </section>

      <p className="prod-attempts-detail-note prod-muted">
        Retained evidence is limited to identities, numeric measurements and grader verdicts.
        Prompts, answers, tool arguments and raw traces are not published.
      </p>
      <a className="prod-inline-link" href={runHref(row.publicationId)}>
        Open run summary <ArrowUpRight size={14} aria-hidden="true" />
      </a>
    </aside>
  );
}

function AttemptTable({
  attempts,
  detailId,
  selectedAttemptId,
  onSelect,
}: {
  attempts: readonly PublicEvalAttemptSummary[];
  detailId: string;
  selectedAttemptId: string | null;
  onSelect: (attemptId: string, source: HTMLButtonElement) => void;
}) {
  return (
    <div
      className="prod-table-scroll prod-attempts-table-scroll"
      role="region"
      aria-label="Retained attempts, scroll horizontally for all columns"
      tabIndex={0}
    >
      <table className="eval-table prod-attempts-table">
        <caption className="prod-sr-only">
          Retained public attempt summaries, sorted by case, repetition and attempt identity
        </caption>
        <thead>
          <tr>
            <th scope="col">Case</th>
            <th scope="col">Repetition</th>
            <th scope="col">Verdict</th>
            <th scope="col">Duration</th>
            <th scope="col">Tokens</th>
            <th scope="col">Failure categories</th>
            <th scope="col">
              <span className="prod-sr-only">Detail</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {attempts.map((attempt) => {
            const selected = attempt.id === selectedAttemptId;
            return (
              <tr key={attempt.id} className={selected ? "is-selected" : undefined}>
                <td>
                  <code className="prod-attempts-mono">{attempt.caseId}</code>
                </td>
                <td className="prod-attempts-number">{INTEGER.format(attempt.repetition)}</td>
                <td>
                  <VerdictBadge verdict={attempt.verdict} />
                </td>
                <td className="prod-attempts-number">{formatDuration(attempt.durationMs)}</td>
                <td>
                  <TokenCell usage={attempt.tokenUsage} />
                </td>
                <td>
                  <FailureCategories categories={attempt.failureCategories} emptyLabel="None" />
                </td>
                <td className="prod-attempts-row-action">
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-expanded={selected}
                    aria-controls={selected ? detailId : undefined}
                    aria-label={`${selected ? "Selected" : "Inspect"} attempt for case ${attempt.caseId}, repetition ${attempt.repetition}`}
                    onClick={(event) => onSelect(attempt.id, event.currentTarget)}
                  >
                    {selected ? "Selected" : "Inspect"}
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function NotFound({
  publicationId,
  catalog,
}: {
  publicationId: string;
  catalog: PublicComparisonCatalog;
}) {
  return (
    <ProductionShell active="attempts" catalog={catalog}>
      <div className="eval-container prod-attempts">
        <ProductionHero
          eyebrow="Attempt explorer"
          title="Run not found"
          description="The requested publication is not part of the current public index, so no attempts can be shown for it."
        />
        <ProductionNotice
          title="No current publication matches this address"
          description={`Publication "${publicationId}" is absent from the current catalog. No other run has been selected.`}
          tone="error"
          role="alert"
        >
          <a className="prod-inline-link" href={attemptsHref()}>
            Browse published runs <ArrowUpRight size={14} aria-hidden="true" />
          </a>
          <a className="prod-inline-link" href="#/results">
            Back to results <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        </ProductionNotice>
      </div>
    </ProductionShell>
  );
}

type AttemptExplorerProps = {
  state: PublicComparisonState;
  publicationId?: string;
  initialVerdict?: AttemptVerdictFilter;
  initialCaseId?: string;
  initialAttemptId?: string;
};

export function AttemptExplorerPage({ state, ...initial }: AttemptExplorerProps) {
  if (state.status !== "ready") {
    return (
      <ProductionShell active="attempts">
        <div className="eval-container prod-attempts">
          <ProductionHero
            eyebrow="Attempt explorer"
            title="Retained attempts"
            description="Public attempt summaries contain verdicts, durations and available token usage."
          />
          <ProductionLoadState state={state} />
        </div>
      </ProductionShell>
    );
  }
  return <ReadyAttempts catalog={state.catalog} {...initial} />;
}

/** Route and story props that determine which run is shown and how its controls start. */
type RunSource = {
  publicationId: string | undefined;
  initialVerdict: AttemptVerdictFilter;
  initialCaseId: string | undefined;
  initialAttemptId: string | undefined;
};

type ExplorerControls = {
  /** Props these controls were initialised from; when they change, the controls re-initialise. */
  source: RunSource;
  /** Run chosen by the picker; `undefined` means the catalog's first row. */
  selectedPublicationId: string | undefined;
  verdict: AttemptVerdictFilter;
  caseId: string;
  search: string;
  /** Tagged with the run and revision it was made in so it can never resolve against other data. */
  selection: { publicationId: string; revisionId: string; attemptId: string } | null;
};

const CLEARED_FILTERS: Pick<ExplorerControls, "verdict" | "caseId" | "search" | "selection"> = {
  verdict: "all",
  caseId: "",
  search: "",
  selection: null,
};

function initialControls(catalog: PublicComparisonCatalog, source: RunSource): ExplorerControls {
  const row = findProductionRun(catalog, source.publicationId)?.row;
  return {
    source,
    selectedPublicationId: source.publicationId,
    verdict: source.initialVerdict,
    caseId: source.initialCaseId ?? "",
    search: "",
    selection:
      row !== undefined && source.initialAttemptId !== undefined
        ? {
            publicationId: row.publicationId,
            revisionId: row.revisionId,
            attemptId: source.initialAttemptId,
          }
        : null,
  };
}

function ReadyAttempts({
  catalog,
  publicationId,
  initialVerdict = "all",
  initialCaseId,
  initialAttemptId,
}: Omit<AttemptExplorerProps, "state"> & { catalog: PublicComparisonCatalog }) {
  const [controls, setControls] = useState(() =>
    initialControls(catalog, { publicationId, initialVerdict, initialCaseId, initialAttemptId }),
  );
  // Props are the external source of the run and its initial controls; the run picker is a
  // controlled selection layered on top. When the props change, re-initialise the controls
  // during render instead of remounting, so the run select keeps its DOM node and focus.
  // A publication change that only confirms the run the picker already selected (the hash
  // echo of selectRun) records the new source and keeps the user's filters.
  const initialChanged =
    controls.source.initialVerdict !== initialVerdict ||
    controls.source.initialCaseId !== initialCaseId ||
    controls.source.initialAttemptId !== initialAttemptId;
  if (initialChanged || controls.source.publicationId !== publicationId) {
    const source: RunSource = { publicationId, initialVerdict, initialCaseId, initialAttemptId };
    setControls(
      !initialChanged && publicationId === controls.selectedPublicationId
        ? { ...controls, source }
        : initialControls(catalog, source),
    );
  }
  const { selectedPublicationId, verdict, caseId, search, selection } = controls;
  const patch = (changes: Partial<Omit<ExplorerControls, "source">>) =>
    setControls((current) => ({ ...current, ...changes }));
  const [focusRequest, setFocusRequest] = useState(0);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const selectionSource = useRef<HTMLButtonElement | null>(null);
  const detailId = useId();
  const searchId = useId();
  const caseFieldId = useId();

  useEffect(() => {
    if (focusRequest > 0) headingRef.current?.focus();
  }, [focusRequest]);

  const run = findProductionRun(catalog, selectedPublicationId);
  const attempts =
    run?.row.result.evidence.attemptDetail === "available" ? run.row.result.attempts : null;

  const sorted = useMemo(
    () => (attempts === null ? [] : [...attempts].sort(compareAttempts)),
    [attempts],
  );
  const caseIds = useMemo(() => {
    const ids = new Set<string>();
    for (const attempt of sorted) ids.add(attempt.caseId);
    return [...ids];
  }, [sorted]);
  const needle = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (verdict === "all" && caseId === "" && needle === "") return sorted;
    return sorted.filter(
      (attempt) =>
        (verdict === "all" || attempt.verdict === verdict) &&
        (caseId === "" || attempt.caseId === caseId) &&
        matchesSearch(attempt, needle),
    );
  }, [sorted, verdict, caseId, needle]);
  // Resolve selection from this publication's visible retained records only.
  const selectedAttempt =
    selection !== null &&
    selection.publicationId === run?.row.publicationId &&
    selection.revisionId === run?.row.revisionId
      ? filtered.find((attempt) => attempt.id === selection.attemptId)
      : undefined;

  useEffect(() => {
    if (selection !== null && selectedAttempt === undefined) {
      setControls((current) =>
        current.selection === selection ? { ...current, selection: null } : current,
      );
    }
  }, [selection, selectedAttempt]);

  if (run === undefined) {
    if (selectedPublicationId !== undefined) {
      return <NotFound publicationId={selectedPublicationId} catalog={catalog} />;
    }
    return (
      <ProductionShell active="attempts" catalog={catalog}>
        <div className="eval-container prod-attempts">
          <ProductionHero
            eyebrow="Attempt explorer"
            title="Retained attempts"
            description="Per-attempt verdicts, durations and token usage for one published run, exactly as retained in its public snapshot."
          />
          <ProductionNotice
            title="No published runs"
            description={
              catalog.withdrawnCount > 0
                ? `There are no current results. The index excludes ${INTEGER.format(catalog.withdrawnCount)} withdrawn publication${catalog.withdrawnCount === 1 ? "" : "s"}. Their identities are not shown.`
                : "The public index currently lists no current results, so there are no attempts to explore."
            }
            role="status"
          >
            <a className="prod-inline-link" href="#/methodology">
              <BookOpen size={15} aria-hidden="true" /> Read the publication rules
            </a>
          </ProductionNotice>
        </div>
      </ProductionShell>
    );
  }

  const { cohort, row } = run;
  const filtersActive = verdict !== "all" || caseId !== "" || needle !== "";
  const unknownCaseFilter = caseId !== "" && !caseIds.includes(caseId);

  const resetFilters = () => patch(CLEARED_FILTERS);
  const selectRun = (nextPublicationId: string) => {
    if (nextPublicationId === row.publicationId) return;
    patch({ ...CLEARED_FILTERS, selectedPublicationId: nextPublicationId });
    if (
      typeof window !== "undefined" &&
      (window.location.hash === "#/attempts" || window.location.hash.startsWith("#/attempts/"))
    ) {
      window.location.hash = attemptsHref(nextPublicationId);
    }
  };
  const selectAttempt = (attemptId: string, source: HTMLButtonElement) => {
    selectionSource.current = source;
    patch({
      selection: { publicationId: row.publicationId, revisionId: row.revisionId, attemptId },
    });
    setFocusRequest((count) => count + 1);
  };

  return (
    <ProductionShell active="attempts" catalog={catalog}>
      <div className="eval-container prod-attempts">
        <ProductionHero
          eyebrow="Attempt explorer"
          title="Retained attempts"
          description="Inspect the public summaries retained for a run. Verdicts measure benchmark conformance, not answer accuracy. Missing token usage is never counted as zero."
        >
          <div className="prod-toolbar prod-attempts-toolbar prod-attempts-toolbar--run">
            <RunSelector catalog={catalog} value={row.publicationId} onChange={selectRun} />
          </div>
        </ProductionHero>

        <RunContext cohort={cohort} row={row} />
        <RunSummary row={row} retained={attempts === null ? null : attempts.length} />

        {catalog.withdrawnCount > 0 && (
          <ProductionNotice
            title="Withdrawn publications excluded"
            description={`${INTEGER.format(catalog.withdrawnCount)} withdrawn publication${catalog.withdrawnCount === 1 ? " is" : "s are"} excluded from this catalog. Their identities and attempts are not displayed.`}
          />
        )}

        {attempts === null ? (
          <UnavailableEvidence row={row} />
        ) : attempts.length === 0 ? (
          <ProductionNotice
            title="No attempts were observed"
            description="This publication retains attempt detail, but the run recorded no attempts. There are no case-level verdicts to explore."
            tone="warning"
            role="status"
          >
            <a className="prod-inline-link" href={runHref(row.publicationId)}>
              Open run summary <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          </ProductionNotice>
        ) : (
          <div
            className={`prod-attempts-layout${selectedAttempt === undefined ? "" : " prod-attempts-layout--detail"}`}
          >
            <Panel
              title="Attempts"
              description={`${INTEGER.format(filtered.length)} of ${INTEGER.format(sorted.length)} retained attempts shown, ordered by case and repetition.`}
              className="prod-attempts-panel"
            >
              <div
                className="prod-toolbar prod-attempts-toolbar"
                role="group"
                aria-label="Attempt filters"
              >
                <div className="prod-search prod-attempts-search">
                  <label className="prod-sr-only" htmlFor={searchId}>
                    Search attempts by case, attempt id or failure category
                  </label>
                  <Search size={15} aria-hidden="true" />
                  <Input
                    id={searchId}
                    type="search"
                    placeholder="Search case, attempt id or category"
                    value={search}
                    onChange={(event) => patch({ search: event.target.value, selection: null })}
                  />
                </div>
                <label className="prod-select-field prod-attempts-field" htmlFor={caseFieldId}>
                  <span>Case</span>
                  <select
                    id={caseFieldId}
                    value={caseId}
                    onChange={(event) => patch({ caseId: event.target.value, selection: null })}
                  >
                    <option value="">All cases ({INTEGER.format(caseIds.length)})</option>
                    {unknownCaseFilter && (
                      <option value={caseId}>{caseId} (not in this run)</option>
                    )}
                    {caseIds.map((id) => (
                      <option key={id} value={id}>
                        {id}
                      </option>
                    ))}
                  </select>
                </label>
                <div
                  className="prod-segmented prod-attempts-segmented"
                  role="group"
                  aria-label="Verdict"
                >
                  {VERDICT_FILTERS.map((option) => (
                    <Button
                      key={option.id}
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-pressed={verdict === option.id}
                      onClick={() => patch({ verdict: option.id, selection: null })}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              </div>

              {filtered.length === 0 ? (
                <div className="prod-attempts-empty" role="status">
                  <strong>No attempts match the current filters</strong>
                  <p>
                    {unknownCaseFilter ? `Case "${caseId}" is not part of this run. ` : ""}
                    {INTEGER.format(sorted.length)} retained attempt
                    {sorted.length === 1 ? " is" : "s are"} available for this run; clear the
                    filters to see them.
                  </p>
                  <Button className="prod-button" onClick={resetFilters}>
                    Clear filters
                  </Button>
                </div>
              ) : (
                <AttemptTable
                  attempts={filtered}
                  detailId={detailId}
                  selectedAttemptId={selectedAttempt?.id ?? null}
                  onSelect={selectAttempt}
                />
              )}
            </Panel>

            {selectedAttempt === undefined ? (
              <aside
                className="prod-attempts-detail prod-attempts-detail--empty"
                aria-label="Attempt detail"
              >
                <p className="prod-kicker">Attempt detail</p>
                <p className="prod-muted">
                  {filtered.length === 0
                    ? "Adjust the filters, then inspect an attempt to see its check verdicts, failure categories and measurements."
                    : "Inspect an attempt to see its five check verdicts, approved failure categories, duration, token usage and identity."}
                </p>
                {filtersActive && (
                  <Button variant="secondary" size="sm" onClick={resetFilters}>
                    Clear filters
                  </Button>
                )}
              </aside>
            ) : (
              <AttemptDetail
                attempt={selectedAttempt}
                row={row}
                detailId={detailId}
                headingRef={headingRef}
                onClose={() => {
                  patch({ selection: null });
                  selectionSource.current?.focus();
                }}
              />
            )}
          </div>
        )}

        <section className="prod-attempts-privacy" aria-label="Public evidence limits">
          <h2 className="prod-kicker">Public summaries only</h2>
          <p className="prod-muted">
            Prompts, answers, tool arguments and raw traces are not published here. Conformance
            verdicts do not establish answer accuracy, cost or uncertainty.
          </p>
          <dl>
            <div>
              <dt>Answer accuracy</dt>
              <dd>
                <MetricValue metric={row.metrics.answerAccuracy} />
              </dd>
            </div>
            <div>
              <dt>USD cost</dt>
              <dd>
                <MetricValue metric={row.metrics.usdCost} />
              </dd>
            </div>
            <div>
              <dt>Uncertainty</dt>
              <dd>
                <MetricValue metric={row.metrics.uncertainty} />
              </dd>
            </div>
          </dl>
        </section>
      </div>
    </ProductionShell>
  );
}

function UnavailableEvidence({ row }: { row: PublicComparisonRow }) {
  const copy =
    row.evidence === "available"
      ? {
          title: "Attempt detail unavailable",
          description:
            "This publication declares attempt detail as available but its snapshot carries no attempt records, so nothing can be shown.",
        }
      : UNAVAILABLE_EVIDENCE[row.evidence];
  return (
    <ProductionNotice
      title={copy.title}
      description={copy.description}
      tone={row.evidence === "withheld" ? "warning" : "neutral"}
      role="status"
    >
      <a className="prod-inline-link" href={runHref(row.publicationId)}>
        Open run summary <ArrowUpRight size={14} aria-hidden="true" />
      </a>
      <a className="prod-inline-link" href="#/methodology">
        <BookOpen size={15} aria-hidden="true" /> How evidence retention works
      </a>
    </ProductionNotice>
  );
}
