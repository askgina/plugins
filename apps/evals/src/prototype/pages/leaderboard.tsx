import { useMemo, useState } from "react";

import { FamilyTabs, ModelAvatar, PageShell, Panel } from "../../components/eval-ui";
import { Button } from "../../components/ui/button";
import {
  canonicalCohorts,
  MEASURED_FAMILIES,
  SUITE_IDS,
  type CanonicalCohort,
  type CanonicalRun,
} from "../canonical";
import {
  defaultLeaderboardCohort,
  dispatchCoverageText,
  getModel,
  getPublication,
  headlineFor,
  headlineSortKey,
  inCohort,
  leaderboardEligibility,
  representativeRuns,
  runHistoryFor,
  type RepresentativeRow,
} from "../selectors";
import { EligibilityReasonList, HeadlineValue, OriginTag, PrototypeBanner } from "../components";
import "./leaderboard.css";

type LeaderboardFamily = (typeof MEASURED_FAMILIES)[number];

function cohortsForFamily(family: LeaderboardFamily): readonly CanonicalCohort[] {
  return canonicalCohorts.filter((cohort) => cohort.suiteId === SUITE_IDS[family]);
}

function cohortLabel(cohort: CanonicalCohort): string {
  return `${cohort.target} · ${cohort.accountClass} · ${cohort.repetitions} reps · ${cohort.evidenceCategory}`;
}

/** Started/planned disclosure plus every nonzero non-complete state. */
function sampleDisclosure(run: CanonicalRun): string {
  const counts = run.counts;
  const parts = [`${counts.started} of ${counts.planned} started`];
  if (counts.graded !== counts.started) parts.push(`${counts.graded} graded`);
  if (counts.completed > 0 && counts.completed !== counts.started) {
    parts.push(`${counts.completed} completed`);
  }
  if (counts.timedOut > 0) parts.push(`${counts.timedOut} timed out`);
  if (counts.runtimeFailure > 0) {
    parts.push(`${counts.runtimeFailure} runtime failure${counts.runtimeFailure === 1 ? "" : "s"}`);
  }
  if (counts.pending > 0) parts.push(`${counts.pending} pending`);
  if (counts.unstarted > 0) parts.push(`${counts.unstarted} unstarted`);
  if (counts.unknown > 0) parts.push(`${counts.unknown} unknown`);
  return parts.join(" · ");
}

interface LeaderboardRow {
  readonly rep: RepresentativeRow;
  readonly rankable: boolean;
  readonly outsideCohort: boolean;
}

function rowSortValue(row: LeaderboardRow): number {
  return headlineSortKey(row.rep.run);
}

export function PrototypeLeaderboardPage({
  initialFamily = "Spot",
  initialCohortId,
}: {
  initialFamily?: LeaderboardFamily;
  initialCohortId?: string;
}) {
  const [family, setFamily] = useState<LeaderboardFamily>(initialFamily);
  const [cohortId, setCohortId] = useState<string | undefined>(initialCohortId);

  const familyCohorts = cohortsForFamily(family);
  const defaultCohort = defaultLeaderboardCohort(family);
  const cohort =
    familyCohorts.find((candidate) => candidate.cohortId === cohortId) ?? defaultCohort;

  const rows = useMemo<LeaderboardRow[]>(() => {
    const nextRows = representativeRuns(family).map((rep): LeaderboardRow => {
      const run = rep.run;
      const inside = inCohort(run, cohort);
      const headline = headlineFor(run);
      const pinned = run.configuration.availability === "pinned";
      return {
        rep,
        outsideCohort: !inside,
        rankable: inside && headline.kind === "rate" && pinned,
      };
    });
    const rankable = nextRows
      .filter((row) => row.rankable)
      .sort(
        (a, b) => rowSortValue(b) - rowSortValue(a) || a.rep.modelId.localeCompare(b.rep.modelId),
      );
    const unrankable = nextRows
      .filter((row) => !row.rankable && !row.outsideCohort)
      .sort((a, b) => a.rep.modelId.localeCompare(b.rep.modelId));
    const outside = nextRows
      .filter((row) => row.outsideCohort)
      .sort(
        (a, b) => rowSortValue(b) - rowSortValue(a) || a.rep.modelId.localeCompare(b.rep.modelId),
      );
    return [...rankable, ...unrankable, ...outside];
  }, [family, cohort]);

  const rankedCount = rows.filter((row) => row.rankable).length;

  const selectFamily = (next: LeaderboardFamily) => {
    setFamily(next);
    setCohortId(undefined);
  };

  const resetFilters = () => {
    setFamily("Spot");
    setCohortId(undefined);
  };

  return (
    <PageShell active="canary">
      <div className="eval-container leaderboard-page">
        <section className="eval-hero" aria-labelledby="prototype-leaderboard-title">
          <p className="eval-eyebrow">Canary · canonical eval browsing</p>
          <h1 className="eval-title" id="prototype-leaderboard-title">
            Leaderboard<span className="eval-dot">.</span>
          </h1>
          <p className="eval-description">
            Model-first rows over the canonical dataset. The headline is passes/started — the only
            sort key — shown only when dispatch coverage is complete.
          </p>
        </section>

        <PrototypeBanner />

        <section className="lb-results" aria-labelledby="prototype-standings-title">
          <div className="lb-section-heading">
            <div>
              <p className="lb-section-kicker">The field</p>
              <h2 id="prototype-standings-title">Canonical standings</h2>
              <p>
                One row per model with its identified representative run. Outside-cohort rows are
                dimmed, never pooled, and never averaged.
              </p>
            </div>
            <span className="lb-dataset-indicator">
              <span>Cohort: {cohortLabel(cohort)}</span>
              <span className="lb-measured-indicator">
                suite v{cohort.suiteVersion} · fixture v{cohort.fixtureVersion} · catalog{" "}
                <code>{cohort.catalogSha.slice(0, 12)}</code>
              </span>
            </span>
          </div>

          <div className="eval-proto-toolbar">
            <div className="eval-proto-toolbar-left">
              <FamilyTabs value={family} onChange={selectFamily} options={MEASURED_FAMILIES} />
              <span className="eval-proto-cohort-field">
                <label htmlFor="eval-proto-cohort">Cohort</label>
                <select
                  id="eval-proto-cohort"
                  className="eval-proto-cohort-select"
                  value={cohort.cohortId}
                  onChange={(event) => setCohortId(event.currentTarget.value)}
                >
                  {familyCohorts.map((option) => (
                    <option key={option.cohortId} value={option.cohortId}>
                      {cohortLabel(option)}
                      {option.cohortId === defaultCohort.cohortId ? " (default)" : ""}
                    </option>
                  ))}
                </select>
              </span>
            </div>
            <Button
              className="lb-reset-button"
              type="button"
              variant="secondary"
              size="sm"
              onClick={resetFilters}
            >
              Reset filters
            </Button>
          </div>

          <Panel
            className="lb-table-panel"
            title="Ranked results"
            description={`${rankedCount} of ${rows.length} models ranked by passes/started — the only sort key · cohort ${cohort.cohortId}`}
          >
            <div className="lb-table-scroll">
              <table className="eval-table lb-table">
                <caption className="lb-visually-hidden">
                  Model results for the {family} family in cohort {cohort.cohortId}. Ranked rows are
                  sorted by passes over started attempts only.
                </caption>
                <thead>
                  <tr>
                    <th className="lb-rank-column" scope="col">
                      Rank
                    </th>
                    <th className="lb-model-column" scope="col">
                      Model
                    </th>
                    <th scope="col" aria-sort="descending">
                      Passes / started
                    </th>
                    <th scope="col">Representative run</th>
                    <th scope="col">Evidence &amp; configuration</th>
                    <th scope="col">Eligibility</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => {
                    const { rep } = row;
                    const run = rep.run;
                    const model = getModel(rep.modelId);
                    const headline = headlineFor(run);
                    const reasons = leaderboardEligibility(run, cohort);
                    const publication = getPublication(run.runId);
                    const currentRevision = publication?.revisions.find(
                      (revision) => revision.revisionId === publication.currentRevisionId,
                    );
                    const runCount = runHistoryFor(rep.modelId, family).length;
                    return (
                      <tr
                        key={`${rep.modelId}-${run.runId}`}
                        className={row.outsideCohort ? "eval-proto-dimmed" : ""}
                      >
                        <td className="lb-rank-cell">
                          {row.rankable ? (
                            <span
                              className="lb-rank-medal"
                              data-rank={index + 1 <= 3 ? index + 1 : undefined}
                            >
                              {index + 1}
                            </span>
                          ) : (
                            <span className="lb-rank-unranked" aria-label="Not ranked">
                              —
                            </span>
                          )}
                        </td>
                        <th scope="row">
                          <div className="lb-model-cell">
                            {model && <ModelAvatar model={model} />}
                            <span className="lb-model-copy">
                              <a href={`#/prototype/models/${rep.modelId}`}>
                                {model?.name ?? rep.modelId}
                              </a>
                              <small>
                                <span>{model?.provider ?? "unknown provider"}</span>
                                <span aria-hidden="true"> · </span>
                                <span>
                                  {rep.configurationGroups} configuration
                                  {rep.configurationGroups === 1 ? "" : "s"} · {runCount} run
                                  {runCount === 1 ? "" : "s"}
                                </span>
                                <OriginTag origin={run.origin} />
                              </small>
                            </span>
                          </div>
                        </th>
                        <td>
                          <div className="eval-proto-stack">
                            <HeadlineValue headline={headline} />
                            <span className="eval-proto-note">{sampleDisclosure(run)}</span>
                          </div>
                        </td>
                        <td>
                          <div className="eval-proto-stack">
                            <a
                              className="eval-proto-run-id"
                              href={`#/prototype/models/${rep.modelId}?run=${run.runId}`}
                            >
                              {run.runId}
                            </a>
                            <span className="eval-proto-note">
                              {run.startedAt.slice(0, 10)} ·{" "}
                              {dispatchCoverageText(run.dispatchCoverage)}
                              {run.gradingCoverage === "partial" ? " · grading partial" : ""}
                              {currentRevision && currentRevision.revision > 1
                                ? ` · rev ${currentRevision.revision}`
                                : ""}
                            </span>
                          </div>
                        </td>
                        <td>
                          <span className="eval-proto-chip-row">
                            <span className="eval-demo-label">{run.cohort.target}</span>
                            <span className="eval-demo-label">{run.cohort.evidenceCategory}</span>
                            <span className="eval-demo-label">
                              {run.configuration.availability === "pinned"
                                ? `pinned ${run.configuration.configurationId}`
                                : "labels only"}
                            </span>
                            <span className="eval-demo-label">
                              {run.checkSource === "native" ? "native checks" : "derived checks"}
                            </span>
                          </span>
                        </td>
                        <td>
                          {reasons.length > 0 ? (
                            <EligibilityReasonList reasons={reasons} />
                          ) : (
                            <span className="eval-muted">in cohort · ranked</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="eval-proto-note eval-proto-table-note">
              Sorted by passes/started only — the sole sort key. Rows without a headline keep their
              counts and coverage reason; rows outside the selected cohort are dimmed and carry
              their reason codes. Percentages are never pooled or averaged across runs or families.
            </p>
          </Panel>
        </section>
      </div>
    </PageShell>
  );
}
