import { useMemo, useState } from "react";
import { BookOpen, BriefcaseBusiness, Search, ShieldCheck, X } from "lucide-react";
import {
  ComparisonConditions,
  DimensionValue,
  MetricValue,
  ResultState,
} from "../components/public-comparison-ui";
import { ComparisonScatterPlot } from "../components/public-comparison-charts";
import { PageShell, Panel } from "../components/eval-ui";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  PUBLIC_DIMENSION_DEFINITIONS,
  PUBLIC_METRIC_DEFINITIONS,
  SUMMARY_METRIC_IDS,
  type PublicComparisonCatalog,
  type PublicMetricId,
} from "../lib/public-comparison";
import { usePublicComparisonCatalog } from "../lib/use-public-comparison";
import "./leaderboard.css";

const metricDefinition = (id: PublicMetricId) => {
  const definition = PUBLIC_METRIC_DEFINITIONS.find((item) => item.id === id);
  if (definition === undefined) throw new Error(`Missing public metric definition: ${id}`);
  return definition;
};

const principles = [
  {
    title: "Open evals",
    description: "Prompts, fixtures, and scoring you can inspect.",
    icon: BookOpen,
  },
  {
    title: "Comparable runs",
    description: "Only matching benchmark conditions share a view.",
    icon: BriefcaseBusiness,
  },
  {
    title: "Evidence first",
    description: "Missing metrics stay unavailable, never invented.",
    icon: ShieldCheck,
  },
] as const;

export interface LeaderboardPageProps {
  catalog?: PublicComparisonCatalog;
  initialSearch?: string;
}

export function LeaderboardPage({ catalog, initialSearch = "" }: LeaderboardPageProps) {
  const state = usePublicComparisonCatalog(catalog);
  const [search, setSearch] = useState(initialSearch);

  const cohort = state.catalog?.cohorts[0];
  const rows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return (cohort?.rows ?? []).filter(
      (row) =>
        query.length === 0 ||
        `${row.candidate} ${row.model} ${row.reasoning ?? ""}`.toLocaleLowerCase().includes(query),
    );
  }, [cohort, search]);

  return (
    <PageShell active="leaderboard">
      <div className="eval-container leaderboard-page">
        <section className="eval-hero lb-hero" aria-labelledby="leaderboard-title">
          <img className="eval-hero-art" src="/images/hero-watercolor-landscape.webp" alt="" />
          <h1 className="eval-title" id="leaderboard-title">
            Benchmarking financial fluency<span>.</span>
          </h1>
          <p className="eval-description">
            Public evaluations of how AI models research, reason, and use financial tools.
          </p>
          <ul className="lb-benefits" aria-label="Evaluation principles">
            {principles.map(({ title, description, icon: Icon }) => (
              <li key={title}>
                <span className="lb-benefit-icon">
                  <Icon size={16} strokeWidth={1.7} aria-hidden="true" />
                </span>
                <span>
                  <strong>{title}</strong>
                  <small>{description}</small>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="lb-results" aria-labelledby="leaderboard-results-title">
          <div className="lb-section-heading">
            <div>
              <p className="lb-section-kicker">The field</p>
              <h2 id="leaderboard-results-title">Current results</h2>
              <p>Compare verified runs from the same evaluation conditions.</p>
            </div>
            {state.catalog !== null && (
              <span className="lb-dataset-indicator">
                {state.catalog.dataOrigin === "synthetic" ? "Synthetic preview" : "Measured"} ·
                generated {state.catalog.generatedAt.slice(0, 10)}
              </span>
            )}
          </div>

          {state.status === "loading" && (
            <div className="lb-load-state" role="status">
              <strong>Verifying public results…</strong>
              <span>Checking the publication bytes against the bundled index.</span>
            </div>
          )}

          {state.status === "error" && (
            <div className="lb-load-state lb-load-state-error" role="alert">
              <strong>Public results could not be verified.</strong>
              <span>{state.message}</span>
            </div>
          )}

          {state.status === "ready" && cohort === undefined && (
            <div className="lb-load-state" role="status">
              <strong>No current result publications.</strong>
              <span>The index contains no viewable conformance cohort.</span>
            </div>
          )}

          {state.status === "ready" && cohort !== undefined && (
            <>
              <div className="lb-toolbar">
                <p className="lb-cohort-label">
                  <strong>{cohort.rows.length}</strong> candidate
                  {cohort.rows.length === 1 ? "" : "s"}
                  <span aria-hidden="true"> · </span>
                  <code>{cohort.conditions.suiteId}</code>
                </p>
                <label className="lb-search-field">
                  <span className="lb-visually-hidden">Search candidates and models</span>
                  <Search size={15} aria-hidden="true" />
                  <Input
                    className="lb-search-input"
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.currentTarget.value)}
                    placeholder="Search candidates"
                  />
                  {search.length > 0 && (
                    <Button
                      className="lb-search-clear"
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Clear candidate search"
                      onClick={() => setSearch("")}
                    >
                      <X size={14} aria-hidden="true" />
                    </Button>
                  )}
                </label>
              </div>

              {rows.length > 1 ? (
                <section className="eval-two-column lb-charts" aria-label="Candidate trade-offs">
                  <Panel
                    title="Quality and latency"
                    description="Pass rate plotted against median response time."
                  >
                    <ComparisonScatterPlot
                      rows={rows}
                      metric="latencyP50"
                      title="Quality and latency"
                    />
                  </Panel>
                  <Panel
                    title="Quality and token use"
                    description="Pass rate plotted against retained token usage."
                  >
                    <ComparisonScatterPlot
                      rows={rows}
                      metric="tokenUsage"
                      title="Quality and token use"
                    />
                  </Panel>
                </section>
              ) : null}

              {rows.length > 0 ? (
                <ol className="lb-result-list" aria-label="Unranked public conformance results">
                  {rows.map((row) => (
                    <li className="lb-result" key={row.revisionId}>
                      <div className="lb-result-main">
                        <div className="lb-result-identity">
                          <span className="lb-unranked-mark" aria-label="Unranked result">
                            •
                          </span>
                          <span className="lb-model-copy">
                            <a href={`#/models/${row.id}`}>{row.candidate}</a>
                            <small>
                              <code>{row.model}</code>
                              {row.reasoning === null ? "" : ` · ${row.reasoning}`}
                            </small>
                          </span>
                        </div>

                        <dl className="lb-primary-metrics">
                          {SUMMARY_METRIC_IDS.map((id) => (
                            <div key={id} title={metricDefinition(id).description}>
                              <dt>{metricDefinition(id).label}</dt>
                              <dd>
                                <MetricValue metric={row.metrics[id]} compact />
                              </dd>
                            </div>
                          ))}
                          <div>
                            <dt>Attempts</dt>
                            <dd>
                              <span className="lb-attempt-count">
                                <strong>{row.counts.attempts.total}</strong>
                                <small>
                                  {row.counts.attempts.passed} passed, {row.counts.attempts.failed}{" "}
                                  failed
                                </small>
                              </span>
                            </dd>
                          </div>
                        </dl>

                        <div className="lb-result-action">
                          <ResultState row={row} />
                          <a href={`#/models/${row.id}`}>View evidence →</a>
                        </div>
                      </div>

                      <dl className="lb-dimension-strip">
                        {PUBLIC_DIMENSION_DEFINITIONS.map((dimension) => (
                          <div key={dimension.id}>
                            <dt>{dimension.label}</dt>
                            <dd>
                              <DimensionValue row={row} dimension={dimension.id} compact />
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="lb-empty-state" role="status">
                  <h3>No candidates found</h3>
                  <p>No candidate or model matches “{search.trim()}”.</p>
                  <Button type="button" variant="secondary" size="sm" onClick={() => setSearch("")}>
                    Clear search
                  </Button>
                </div>
              )}

              <details className="lb-method-details">
                <summary>Method and publication details</summary>
                <div className="eval-two-column lb-contract-grid">
                  <section>
                    <h3>Comparison conditions</h3>
                    <p>Every result above matches these fields.</p>
                    <ComparisonConditions conditions={cohort.conditions} />
                  </section>
                  <section>
                    <h3>Publication state</h3>
                    <p>Lifecycle and evidence stay separate from the verdict.</p>
                    <dl className="lb-publication-state">
                      <div>
                        <dt>Current</dt>
                        <dd>{cohort.rows.length}</dd>
                      </div>
                      <div>
                        <dt>Withdrawn</dt>
                        <dd>{state.catalog.withdrawnCount}</dd>
                      </div>
                      <div>
                        <dt>Other cohorts</dt>
                        <dd>{Math.max(0, state.catalog.cohorts.length - 1)}</dd>
                      </div>
                    </dl>
                    <p className="lb-contract-note">
                      Accuracy, USD cost, uncertainty, task families, and ranks need a versioned
                      public method before they can appear.
                    </p>
                  </section>
                </div>
              </details>
            </>
          )}
        </section>
      </div>
    </PageShell>
  );
}
