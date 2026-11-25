import type { CSSProperties } from "react";
import { ArrowUpRight } from "lucide-react";
import {
  SCORED_FAMILIES,
  recordedBudgetLabel,
  recordedOutcomes,
  type LeaderboardModelRow,
} from "../canonical/selectors";
import { clientDisplayName } from "../lib/client-labels";
import { CompactScore, columns } from "./leaderboard-results";
import { InfoPopover, percent } from "./results-ui";

export function ModelProfileOverview({
  row,
  onInspectRun,
}: {
  row: LeaderboardModelRow;
  onInspectRun: (runId: string) => void;
}) {
  const runs = Object.values(row.runs);
  const first = row.runs.Spot ?? runs[0];
  const counts = recordedOutcomes(runs);
  const clients = [...new Set(runs.map((run) => clientDisplayName(run.cohort.target)))];
  return (
    <section
      className="mp-overview"
      aria-labelledby="mp-overview-title"
      data-profile-setting={row.rowId}
    >
      <div className="mp-section-heading">
        <h2 id="mp-overview-title">Performance overview</h2>
        <InfoPopover label="About Overall">
          <p>{columns[0]?.explanation}</p>
        </InfoPopover>
      </div>
      <dl className="mp-stat-strip">
        <div>
          <dt>Overall success</dt>
          <dd>
            <CompactScore row={row} />
          </dd>
          <dd className="mp-stat-note">Equal-weight category mean</dd>
        </div>
        <div>
          <dt>Average time</dt>
          <dd>
            <CompactScore row={row} metric="time" />
          </dd>
          <dd className="mp-stat-note">Completed attempts only</dd>
        </div>
        <div>
          <dt>Est. cost / task</dt>
          <dd>
            <CompactScore row={row} metric="cost" />
          </dd>
          <dd className="mp-stat-note">Token estimate, not billed spend</dd>
        </div>
        <div>
          <dt>Grading coverage</dt>
          <dd>
            {counts.graded}
            <span className="mp-stat-denominator"> / {counts.planned}</span>
          </dd>
          <dd className="mp-stat-note">
            {counts.passed} passed · {counts.failed} failed
          </dd>
        </div>
      </dl>
      <div className="mp-overview-body">
        <section className="mp-categories" aria-labelledby="mp-categories-title">
          <h3 id="mp-categories-title">Success by category</h3>
          {SCORED_FAMILIES.map((family) => {
            const run = row.runs[family];
            const score = row.scores[family];
            return (
              <div className="mp-category-row" key={family}>
                <div className="mp-category-heading">
                  <strong>{family}</strong>
                  <span>
                    {score === null ? (run ? "Incomplete" : "Not evaluated") : percent(score)}
                  </span>
                </div>
                <div
                  className="mp-category-track"
                  data-available={score !== null}
                  aria-hidden="true"
                  style={{ "--mp-score": `${(score ?? 0) * 100}%` } as CSSProperties}
                >
                  <span />
                </div>
                <div className="mp-category-detail">
                  <span>
                    {run
                      ? `${run.counts.passed}/${run.counts.planned} passed · ${run.counts.graded} graded`
                      : "No recorded category run"}
                  </span>
                  {run && (
                    <a
                      href={`#/tasks?category=${family}&model=${row.model.id}&run=${encodeURIComponent(run.runId)}&view=conversation`}
                    >
                      Tasks &amp; chats <ArrowUpRight size={12} aria-hidden="true" />
                    </a>
                  )}
                </div>
              </div>
            );
          })}
          {row.overallReason && (
            <p className="mp-scope-note" role="note">
              {row.overallReason}
            </p>
          )}
          {counts.planned > counts.graded && (
            <p className="mp-scope-note">
              {counts.planned - counts.graded} ungraded · {counts.timedOut} timed out ·{" "}
              {counts.runtimeFailure} run errors. Terminal non-passes receive zero success credit;
              unfinished processing keeps scores unavailable.
            </p>
          )}
        </section>
        <aside className="mp-record-facts" aria-label="Recorded setting details">
          <h3>Recorded setting</h3>
          <dl>
            <div>
              <dt>Reasoning / route</dt>
              <dd>{row.configurationLabel}</dd>
            </div>
            <div>
              <dt>Client</dt>
              <dd>{clients.join(" / ")}</dd>
            </div>
            <div>
              <dt>Recorded</dt>
              <dd>{first?.startedAt.slice(0, 10) ?? "Not recorded"}</dd>
            </div>
            <div>
              <dt>Time budget</dt>
              <dd>{recordedBudgetLabel(runs)}</dd>
            </div>
            <div>
              <dt>Repetitions</dt>
              <dd>{first?.cohort.repetitions ?? "Not recorded"} per task</dd>
            </div>
          </dl>
          {first && (
            <button
              className="mp-inline-link"
              type="button"
              onClick={() => onInspectRun(first.runId)}
            >
              Inspect run evidence <ArrowUpRight size={13} aria-hidden="true" />
            </button>
          )}
        </aside>
      </div>
    </section>
  );
}
