import { useMemo } from "react";
import { ArrowUpRight } from "lucide-react";
import type { CanonicalModel } from "../canonical/canonical";
import {
  configurationLeaderboardRows,
  modelProfileRows,
  modelsByReleaseDate,
  recordedOutcomes,
  type LeaderboardModelRow,
} from "../canonical/selectors";
import { ModelAvatar, PageShell } from "../components/eval-ui";
import { rowKey } from "../components/leaderboard-results";
import { percent } from "../components/results-ui";
import { Button } from "../components/ui/button";
import "./model-index.css";

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function ModelCard({
  model,
  rows,
}: {
  model: CanonicalModel;
  rows: readonly LeaderboardModelRow[];
}) {
  const scored = rows.filter((row) => row.overall !== null).length;
  return (
    <article className="model-index-card" aria-labelledby={`model-card-title-${model.id}`}>
      <header className="model-index-card-header">
        <ModelAvatar model={model} size="lg" />
        <div className="model-index-card-title-wrap">
          <h2 id={`model-card-title-${model.id}`}>
            <a href={`#/models/${model.id}`}>{model.name}</a>
          </h2>
          <p className="model-index-card-provider">{model.provider}</p>
          {model.release && (
            <p className="model-index-card-provider">
              <a href={model.release.source} target="_blank" rel="noreferrer">
                Released{" "}
                <time dateTime={model.release.date}>
                  {dateFormat.format(Date.parse(model.release.date))}
                </time>
              </a>
            </p>
          )}
        </div>
      </header>

      <div className="model-index-results">
        <p className="model-index-summary">
          {rows.length} recorded setting{rows.length === 1 ? "" : "s"} · {scored} with Overall
          scores
        </p>
        <table className="model-index-settings" aria-label={`${model.name} recorded results`}>
          <thead>
            <tr>
              <th scope="col">Recorded setting</th>
              <th scope="col">Overall</th>
              <th scope="col">Graded</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const runs = Object.values(row.runs);
              const counts = recordedOutcomes(runs);
              const first = runs[0]!;
              const reason = row.coverageLabel
                ? row.coverageLabel
                : counts.graded < counts.planned
                  ? "Grading incomplete"
                  : (row.overallReason ?? "Insufficient evidence");
              return (
                <tr key={rowKey(row)} data-setting={first.configuration.reasoning}>
                  <th scope="row">
                    <span>{row.configurationLabel}</span>
                    <time dateTime={first.startedAt}>
                      {dateFormat.format(Date.parse(first.startedAt))}
                    </time>
                    {row.overall === null && (
                      <small className="model-index-incomplete">{reason}</small>
                    )}
                  </th>
                  <td className={row.overall === null ? "model-index-unranked" : undefined}>
                    {row.overall === null ? "Unranked" : percent(row.overall)}
                  </td>
                  <td>
                    {counts.graded}/{counts.planned}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <footer className="model-index-card-footer">
        <Button asChild variant="secondary" size="sm">
          <a
            href={`#/models/${model.id}`}
            aria-label={`View ${model.name} results and transcripts`}
          >
            Results &amp; transcripts <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        </Button>
      </footer>
    </article>
  );
}

export function ModelIndexPage() {
  const models = useMemo(() => modelsByReleaseDate(), []);
  const rows = useMemo(() => configurationLeaderboardRows(), []);

  return (
    <PageShell
      active="models"
      footerNote="Recorded results across Spot, Perps, and Predictions. Full run history and evidence are available in each model profile."
    >
      <div className="eval-container model-index-page">
        <section className="eval-hero model-index-hero" aria-labelledby="model-index-title">
          <img className="eval-hero-art" src="/images/hero-watercolor-landscape.webp" alt="" />
          <nav className="model-profile-breadcrumbs" aria-label="Breadcrumb">
            <a href="#/leaderboard">Leaderboard</a>
            <span aria-hidden="true">/</span>
            <span aria-current="page">Models</span>
          </nav>
          <p className="eval-eyebrow">Model directory</p>
          <h1 className="eval-title" id="model-index-title">
            Models<span>.</span>
          </h1>
          <p className="eval-description">
            Browse tested reasoning levels, grading progress, and full results for every model. Open
            a profile for category scores, costs, run history, and chat transcripts.
          </p>
        </section>

        <div className="model-index-guide">
          <div className="model-index-order">
            <p>{models.length} models · Newest releases first</p>
            <a href="#/leaderboard">
              Compare scores <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          </div>
          <p>
            Latest results for each recorded configuration. Repeated reasoning levels have separate
            configurations, dated below. Overall requires complete grading in Spot, Perps, and
            Predictions; graded counts include passes and failures.
          </p>
        </div>
        <section className="model-index-grid" aria-label="Evaluated models">
          {models.map((model) => (
            <ModelCard key={model.id} model={model} rows={modelProfileRows(model.id, rows)} />
          ))}
        </section>
      </div>
    </PageShell>
  );
}
