import { useMemo } from "react";
import { ArrowUpRight } from "lucide-react";
import { MEASURED_FAMILIES, type CanonicalModel, type CanonicalRun } from "../canonical/canonical";
import {
  configurationGroupKey,
  headlineFor,
  modelsByReleaseDate,
  runHistoryFor,
  runsForModel,
} from "../canonical/selectors";
import { AvailabilityMark, CoverageChip, HeadlineValue } from "../canonical/components";
import { ModelAvatar, PageShell } from "../components/eval-ui";
import { Button } from "../components/ui/button";
import "./model-index.css";

function shortSha(sha: string | null | undefined): string | null {
  return sha === null || sha === undefined ? null : `${sha.slice(0, 12)}…`;
}

interface ConfigGroupSummary {
  readonly key: string;
  readonly isPinned: boolean;
  readonly pinnedSha256: string | null;
  readonly candidate: string;
  readonly reasoning: string | null;
  readonly runCount: number;
}

function ModelCard({ model }: { model: CanonicalModel }) {
  const modelRuns = useMemo(() => {
    return runsForModel(model.id).filter((r) => r.origin === "measured");
  }, [model.id]);

  const configGroups: readonly ConfigGroupSummary[] = useMemo(() => {
    const map = new Map<string, CanonicalRun[]>();
    for (const run of modelRuns) {
      const key = configurationGroupKey(run);
      const list = map.get(key) ?? [];
      list.push(run);
      map.set(key, list);
    }
    return [...map.entries()].map(([key, runs]) => {
      const first = runs[0]!;
      return {
        key,
        isPinned: first.configuration.availability === "pinned",
        pinnedSha256: first.configuration.pinnedSha256,
        candidate: first.configuration.candidate,
        reasoning: first.configuration.reasoning,
        runCount: runs.length,
      };
    });
  }, [modelRuns]);

  const familySummaries = useMemo(() => {
    return MEASURED_FAMILIES.map((family) => {
      const runs = runHistoryFor(model.id, family).filter((r) => r.origin === "measured");
      const latest = runs[0];
      return { family, latest };
    }).filter((entry) => entry.latest !== undefined);
  }, [model.id]);

  return (
    <article className="model-index-card" aria-labelledby={`model-card-title-${model.id}`}>
      <header className="model-index-card-header">
        <ModelAvatar model={model} size="lg" />
        <div className="model-index-card-title-wrap">
          <h2 id={`model-card-title-${model.id}`}>
            <a href={`#/models/${model.id}`}>{model.name}</a>
          </h2>
          <p className="model-index-card-provider">
            {model.provider} · <code>{model.providerModel}</code>
          </p>
          {model.release && (
            <p className="model-index-card-provider">
              <a href={model.release.source} target="_blank" rel="noreferrer">
                Released{" "}
                <time dateTime={model.release.date}>
                  {new Intl.DateTimeFormat("en-GB", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    timeZone: "UTC",
                  }).format(Date.parse(model.release.date))}
                </time>
              </a>
            </p>
          )}
        </div>
      </header>

      {/* Configuration groups */}
      <div>
        <h3 className="model-index-section-title">Configuration groups ({configGroups.length})</h3>
        <div className="model-index-configs">
          {configGroups.map((group) => (
            <div className="model-index-config-item" key={group.key}>
              <div className="model-index-config-pin">
                <span>
                  {group.isPinned ? (
                    <>
                      <span>pin </span>
                      <code>{shortSha(group.pinnedSha256)}</code>
                    </>
                  ) : (
                    <AvailabilityMark
                      availability="not_recorded"
                      reason="labels-only configuration"
                    />
                  )}
                </span>
                <span className="eval-muted">
                  {group.runCount} run{group.runCount === 1 ? "" : "s"}
                </span>
              </div>
              <div className="model-index-config-meta">
                candidate <code>{group.candidate}</code>
                {group.reasoning && ` · reasoning ${group.reasoning}`}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Per-family latest runs */}
      <div>
        <h3 className="model-index-section-title">Latest family evaluations</h3>
        <div className="model-index-families">
          {familySummaries.map(({ family, latest }) => {
            if (!latest) return null;
            const headline = headlineFor(latest);
            return (
              <div className="model-index-family-item" key={family}>
                <span className="model-index-family-name">{family}</span>
                <div className="model-index-family-stat">
                  <HeadlineValue headline={headline} />
                  <CoverageChip coverage={latest.dispatchCoverage} />
                  <a
                    className="model-index-family-link"
                    href={`#/models/${model.id}?run=${latest.runId}`}
                    title={`Inspect ${latest.runId}`}
                  >
                    View run <ArrowUpRight size={12} aria-hidden="true" />
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <footer className="model-index-card-footer">
        <Button asChild variant="secondary" size="sm">
          <a href={`#/models/${model.id}`}>
            View full profile <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        </Button>
      </footer>
    </article>
  );
}

export function ModelIndexPage() {
  const models = useMemo(() => modelsByReleaseDate(), []);

  return (
    <PageShell
      active="models"
      footerNote="Evaluated models across Gina financial task families. Conformance results from bundled campaign artifacts."
    >
      <div className="eval-container model-index-page">
        <section className="eval-hero model-index-hero" aria-labelledby="model-index-title">
          <img className="eval-hero-art" src="/images/hero-watercolor-landscape.webp" alt="" />
          <nav className="model-profile-breadcrumbs" aria-label="Breadcrumb">
            <a href="#/leaderboard">Leaderboard</a>
            <span aria-hidden="true">/</span>
            <span aria-current="page">Models</span>
          </nav>
          <p className="eval-eyebrow">Model directory · Canonical evaluation harness</p>
          <h1 className="eval-title" id="model-index-title">
            Models<span>.</span>
          </h1>
          <p className="eval-description">
            Evaluated model configurations across Spot, Perps, and Predictions task families. Each
            card summarizes declared configuration groups and links directly to the latest
            conformance runs. Ordered by release date, newest first.
          </p>
        </section>

        <section className="model-index-grid" aria-label="Evaluated models">
          {models.map((model) => (
            <ModelCard key={model.id} model={model} />
          ))}
        </section>
      </div>
    </PageShell>
  );
}
